import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as elasticache from 'aws-cdk-lib/aws-elasticache'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as applicationautoscaling from 'aws-cdk-lib/aws-applicationautoscaling'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'

// ── Stack Props ───────────────────────────────────────────────────────────────

export interface TaprootStackProps extends cdk.StackProps {
  /** 'staging' | 'production' */
  stageName: 'staging' | 'production'
  /** Primary domain for CloudFront distribution (e.g. app.taprootpos.com) */
  domainName: string
  /** RDS instance class (e.g. 'db.t3.micro', 'db.t3.small') */
  instanceClass: string
  /** Desired ECS task count */
  desiredCount: number
  /** RDS Multi-AZ (false for staging, true for production) */
  multiAz: boolean
}

// ── TaprootStack ──────────────────────────────────────────────────────────────

export class TaprootStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TaprootStackProps) {
    super(scope, id, props)

    const { stageName, domainName, instanceClass, desiredCount, multiAz } = props
    const isProd = stageName === 'production'
    const prefix = `taproot-${stageName}`

    // ── 1. Alerts topic (shared by budget + CloudWatch alarms) ─────────────────
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Taproot ${stageName} alerts`,
    })
    // Add email subscription via CfnSubscription — email address from context
    const alertEmail = this.node.tryGetContext('alertEmail') as string | undefined
    if (alertEmail) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail))
    }

    // ── 2. VPC ─────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${prefix}-vpc`,
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    })

    // ── 3. Security groups ─────────────────────────────────────────────────────

    // ALB: public internet → 80 + 443
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      securityGroupName: `${prefix}-alb-sg`,
      description: 'Allow HTTP/HTTPS from internet',
    })
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP')
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS')

    // ECS: traffic from ALB only
    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      securityGroupName: `${prefix}-ecs-sg`,
      description: 'Allow traffic from ALB',
    })
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(3001), 'From ALB')

    // RDS: ECS only
    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc,
      securityGroupName: `${prefix}-rds-sg`,
      description: 'Allow Postgres from ECS',
    })
    rdsSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), 'From ECS')

    // Redis: ECS only
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      securityGroupName: `${prefix}-redis-sg`,
      description: 'Allow Redis from ECS',
    })
    redisSg.addIngressRule(ecsSg, ec2.Port.tcp(6379), 'From ECS')

    // ── 4. RDS PostgreSQL ──────────────────────────────────────────────────────

    // Parameter group for performance + observability
    const rdsParams = new rds.ParameterGroup(this, 'RdsParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      description: `Taproot ${stageName} Postgres params`,
      parameters: {
        max_connections: '100',
        shared_buffers: '262144',                // 256MB in 8kB pages
        log_min_duration_statement: '1000',       // log queries >1s
        log_connections: '1',
        log_disconnections: '1',
        log_lock_waits: '1',
        idle_in_transaction_session_timeout: '30000', // 30s
      },
    })

    const dbSubnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      vpc,
      description: `${prefix} DB subnet group`,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      subnetGroupName: `${prefix}-db-subnet`,
    })

    const db = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier: `${prefix}-postgres`,
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        instanceClass.includes('small') ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      subnetGroup: dbSubnetGroup,
      securityGroups: [rdsSg],
      parameterGroup: rdsParams,
      multiAz,
      storageType: rds.StorageType.GP3,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,          // auto-scale up to 100GB
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      databaseName: 'taproot',
      credentials: rds.Credentials.fromGeneratedSecret('taproot', {
        secretName: `${prefix}/rds-credentials`,
      }),
      enablePerformanceInsights: isProd,
      performanceInsightRetention: isProd
        ? rds.PerformanceInsightRetention.DEFAULT   // 7 days free tier
        : undefined,
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      monitoringInterval: cdk.Duration.seconds(60),
    })

    // ── 5. ElastiCache Redis ───────────────────────────────────────────────────

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: `${prefix} Redis subnet group`,
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: `${prefix}-redis-subnet`,
    })

    const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
      clusterName: `${prefix}-redis`,
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      autoMinorVersionUpgrade: true,
      snapshotRetentionLimit: isProd ? 3 : 0,
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
    })
    redis.addDependency(redisSubnetGroup)

    // ── 6. Secrets Manager ────────────────────────────────────────────────────

    const secretPrefix = `taproot/${stageName}`

    // Application secrets (values must be populated manually post-deploy)
    const appSecrets: Record<string, secretsmanager.Secret> = {}
    const secretNames = [
      'jwt-secret',
      'jwt-refresh-secret',
      'mfa-encryption-key',
      'offline-encryption-key',
      'anthropic-api-key',
      'stripe-secret-key',
      'stripe-webhook-secrets',
    ]
    for (const name of secretNames) {
      appSecrets[name] = new secretsmanager.Secret(this, `Secret-${name}`, {
        secretName: `${secretPrefix}/${name}`,
        description: `Taproot ${stageName} ${name}`,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      })
    }

    // ── 7. ECR Repository ─────────────────────────────────────────────────────

    const ecrRepo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: 'taproot-api',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep last 10 images',
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    })

    // ── 8. CloudWatch Log Group ────────────────────────────────────────────────

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/taproot/${stageName}/api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // ── 9. ECS Cluster + Task Definition ──────────────────────────────────────

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster`,
      vpc,
      containerInsights: isProd,
    })

    // IAM task execution role — pull images + write logs
    const executionRole = new iam.Role(this, 'EcsExecutionRole', {
      roleName: `${prefix}-ecs-execution`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    })

    // IAM task role — read secrets only (least privilege)
    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      roleName: `${prefix}-ecs-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    })
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:taproot/${stageName}/*`],
      }),
    )
    // Allow ECR pull
    ecrRepo.grantPull(executionRole)
    // Allow log writes
    apiLogGroup.grantWrite(executionRole)

    // Also grant execution role access to RDS secret
    db.secret?.grantRead(executionRole)

    // Task definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      family: `${prefix}-api`,
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole,
      taskRole,
    })

    const container = taskDef.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
      containerName: 'taproot-api',
      logging: ecs.LogDrivers.awsLogs({
        logGroup: apiLogGroup,
        streamPrefix: 'api',
      }),
      environment: {
        NODE_ENV: stageName,
        PORT: '3001',
        LOG_LEVEL: isProd ? 'info' : 'debug',
      },
      secrets: {
        // RDS secret injected as env vars at container start
        DB_SECRET_JSON: ecs.Secret.fromSecretsManager(db.secret!),
        JWT_SECRET: ecs.Secret.fromSecretsManager(appSecrets['jwt-secret']),
        JWT_REFRESH_SECRET: ecs.Secret.fromSecretsManager(appSecrets['jwt-refresh-secret']),
        MFA_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecrets['mfa-encryption-key']),
        OFFLINE_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(appSecrets['offline-encryption-key']),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(appSecrets['anthropic-api-key']),
        STRIPE_SECRET_KEY: ecs.Secret.fromSecretsManager(appSecrets['stripe-secret-key']),
        STRIPE_WEBHOOK_SECRETS: ecs.Secret.fromSecretsManager(appSecrets['stripe-webhook-secrets']),
      },
      portMappings: [{ containerPort: 3001, protocol: ecs.Protocol.TCP }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        startPeriod: cdk.Duration.seconds(15),
        retries: 3,
      },
    })
    void container // used by ECS task def automatically

    // ── 10. ACM Certificate ───────────────────────────────────────────────────

    // Lookup existing hosted zone (must be pre-created)
    let hostedZone: route53.IHostedZone | undefined
    try {
      hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
        domainName: 'taprootpos.com',
      })
    } catch {
      // hostedZone not available in synth without AWS credentials — CDK will error at deploy
    }

    // Certificate in us-east-1 (required for CloudFront)
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'taprootpos.com',
      subjectAlternativeNames: ['*.taprootpos.com'],
      validation: hostedZone
        ? acm.CertificateValidation.fromDns(hostedZone)
        : acm.CertificateValidation.fromDns(),
    })

    // ── 11. ALB + ECS Service ─────────────────────────────────────────────────

    const loadBalancedService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'ApiService',
      {
        serviceName: `${prefix}-api`,
        cluster,
        taskDefinition: taskDef,
        desiredCount,
        securityGroups: [ecsSg],
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        publicLoadBalancer: true,
        loadBalancerName: `${prefix}-alb`,
        certificate,
        redirectHTTP: true,           // HTTP 80 → HTTPS 443
        healthCheckGracePeriod: cdk.Duration.seconds(30),
        deploymentController: { type: ecs.DeploymentControllerType.ECS },
        circuitBreaker: { rollback: true },
      },
    )

    // Override ALB security group
    loadBalancedService.loadBalancer.connections.addSecurityGroup(albSg)

    // Health check path
    loadBalancedService.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    })

    // Auto-scaling: 1–4 tasks based on CPU
    const scaling = loadBalancedService.service.autoScaleTaskCount({
      minCapacity: desiredCount,
      maxCapacity: 4,
    })
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(120),
      scaleOutCooldown: cdk.Duration.seconds(60),
    })
    // Also scale on memory
    scaling.scaleOnMetric('MemoryScaling', {
      metric: loadBalancedService.service.metricMemoryUtilization(),
      scalingSteps: [
        { upper: 50, change: 0 },
        { lower: 70, change: +1 },
        { lower: 85, change: +2 },
      ],
      cooldown: cdk.Duration.seconds(60),
      adjustmentType: applicationautoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
    })

    // Route53 A record: api.taprootpos.com → ALB
    if (hostedZone) {
      new route53.ARecord(this, 'ApiARecord', {
        zone: hostedZone,
        recordName: `api.${isProd ? '' : stageName + '.'}taprootpos.com`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(loadBalancedService.loadBalancer),
        ),
      })
    }

    // ── 12. S3 + CloudFront for Web PWA ───────────────────────────────────────

    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `taproot-web-${stageName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    })

    // Origin Access Control (OAC) — newer, preferred over OAI
    const oac = new cloudfront.CfnOriginAccessControl(this, 'WebOAC', {
      originAccessControlConfig: {
        name: `${prefix}-web-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    })

    // Cache policies
    const htmlCachePolicy = new cloudfront.CachePolicy(this, 'HtmlCachePolicy', {
      cachePolicyName: `${prefix}-html-no-cache`,
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(31536000),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('CloudFront-Viewer-Country'),
    })

    const assetCachePolicy = new cloudfront.CachePolicy(this, 'AssetCachePolicy', {
      cachePolicyName: `${prefix}-assets-1year`,
      defaultTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.days(365),
      maxTtl: cdk.Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    })

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      comment: `Taproot ${stageName} Web PWA`,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      certificate,
      domainNames: [domainName],
      defaultBehavior: {
        // S3 origin with OAC
        origin: new cloudfrontOrigins.S3Origin(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: htmlCachePolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      additionalBehaviors: {
        // Hashed JS/CSS assets — cache 1 year
        '/assets/*': {
          origin: new cloudfrontOrigins.S3Origin(webBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: assetCachePolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    })

    // Grant bucket read to CloudFront via OAC bucket policy
    webBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [webBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    )

    // Attach OAC to distribution (L1 escape hatch)
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.Origins.0.OriginAccessControlId',
      oac.getAtt('Id'),
    )
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity',
      '',
    )

    // Route53 A record: app.taprootpos.com → CloudFront
    if (hostedZone) {
      new route53.ARecord(this, 'WebARecord', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(distribution),
        ),
      })
    }

    // ── 13. CloudWatch Alarms ─────────────────────────────────────────────────

    // API 5xx error rate > 5%
    const errorRateAlarm = new cloudwatch.Alarm(this, 'ApiErrorRateAlarm', {
      alarmName: `${prefix}-api-error-rate`,
      alarmDescription: 'API 5xx error rate exceeded 5%',
      metric: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: loadBalancedService.loadBalancer.metrics.httpCodeElb(
            elbv2.HttpCodeElb.ELB_5XX_COUNT,
            { period: cdk.Duration.minutes(5) },
          ),
          m2: loadBalancedService.loadBalancer.metrics.requestCount({
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    errorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic))

    // API response time P95 > 2s
    const latencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: `${prefix}-api-latency-p95`,
      alarmDescription: 'API P95 response time exceeded 2 seconds',
      metric: loadBalancedService.loadBalancer.metrics.targetResponseTime({
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic))

    // RDS connections > 80
    const dbConnectionsAlarm = new cloudwatch.Alarm(this, 'DbConnectionsAlarm', {
      alarmName: `${prefix}-db-connections`,
      alarmDescription: 'Database connections exceeded 80',
      metric: db.metricDatabaseConnections({ period: cdk.Duration.minutes(5) }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    dbConnectionsAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic))

    // Redis freeable memory < 20% (proxy: engine CPU > 80%)
    const redisMemoryAlarm = new cloudwatch.Alarm(this, 'RedisMemoryAlarm', {
      alarmName: `${prefix}-redis-memory`,
      alarmDescription: 'Redis engine CPU high (proxy for memory pressure)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ElastiCache',
        metricName: 'EngineCPUUtilization',
        dimensionsMap: {
          CacheClusterId: redis.ref,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    redisMemoryAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic))

    // ── 14. AWS Budget ────────────────────────────────────────────────────────

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `taproot-${stageName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: 200,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,    // 80% of $200 = $160
            thresholdType: 'PERCENTAGE',
          },
          subscribers: alertEmail
            ? [{ subscriptionType: 'EMAIL', address: alertEmail }]
            : [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,   // 100% = $200
            thresholdType: 'PERCENTAGE',
          },
          subscribers: alertEmail
            ? [{ subscriptionType: 'EMAIL', address: alertEmail }]
            : [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
      ],
    })

    // ── 15. Stack Outputs ──────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'AlbUrl', {
      value: loadBalancedService.loadBalancer.loadBalancerDnsName,
      description: 'ALB DNS name (use this for api.taprootpos.com CNAME if no Route53)',
      exportName: `${prefix}-alb-url`,
    })
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: distribution.domainName,
      description: 'CloudFront distribution URL',
      exportName: `${prefix}-cf-url`,
    })
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 bucket for web assets',
      exportName: `${prefix}-web-bucket`,
    })
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (for cache invalidation)',
      exportName: `${prefix}-cf-distribution-id`,
    })
    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR repository URI',
      exportName: `${prefix}-ecr-uri`,
    })
    new cdk.CfnOutput(this, 'RdsEndpoint', {
      value: db.dbInstanceEndpointAddress,
      description: 'RDS endpoint (private)',
      exportName: `${prefix}-rds-endpoint`,
    })
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'Redis endpoint (private)',
      exportName: `${prefix}-redis-endpoint`,
    })
    new cdk.CfnOutput(this, 'EcsClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${prefix}-ecs-cluster`,
    })
    new cdk.CfnOutput(this, 'EcsServiceName', {
      value: loadBalancedService.service.serviceName,
      description: 'ECS service name',
      exportName: `${prefix}-ecs-service`,
    })
  }
}
