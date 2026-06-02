# Taproot POS — Operations Runbook

## Quick Reference

| Environment | Web URL | API URL | AWS Region |
|-------------|---------|---------|------------|
| Staging | staging.taprootpos.com | api.taprootpos.com (staging) | us-east-1 |
| Production | app.taprootpos.com | api.taprootpos.com | us-east-1 |

---

## First Deploy (One-Time Setup)

### Prerequisites

- AWS CLI installed and configured (`aws configure`)
- AWS account with AdministratorAccess (or scoped CDK role)
- Node.js 20, npm 10
- Domain `taprootpos.com` registered and nameservers pointing to Route53

### Steps

```bash
# 1. Install CDK globally
npm install -g aws-cdk

# 2. Install infra dependencies
cd infra && npm install

# 3. Bootstrap CDK (one time per account/region)
cdk bootstrap aws://ACCOUNT_ID/us-east-1

# 4. Create Route53 hosted zone (if not already created)
aws route53 create-hosted-zone \
  --name taprootpos.com \
  --caller-reference $(date +%s)
# → Note the NS records and update your domain registrar

# 5. Deploy staging first
cdk deploy TaprootStaging \
  --context alertEmail=ops@yourcompany.com \
  --require-approval never

# 6. Note CDK outputs
# AlbUrl, CloudFrontUrl, WebBucketName, CloudFrontDistributionId, EcrRepoUri

# 7. Populate secrets in AWS Secrets Manager
# (CDK creates the secret containers; you fill the values)
aws secretsmanager put-secret-value \
  --secret-id taproot/staging/jwt-secret \
  --secret-string "$(openssl rand -base64 64 | tr -d '\n')"

# Repeat for all secrets:
# jwt-refresh-secret, mfa-encryption-key, offline-encryption-key,
# anthropic-api-key, stripe-secret-key, stripe-webhook-secrets

# 8. Add GitHub secrets (see docs/DEPLOYMENT.md for full list)
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ECR_REGISTRY, etc.

# 9. Push to main → CI/CD auto-deploys to staging
git push origin main

# 10. Deploy production
cdk deploy TaprootProduction \
  --context alertEmail=ops@yourcompany.com
# Production requires manual confirmation in terminal
```

---

## Routine Deploy

### Auto-deploy (Staging)

Every push to `main` automatically:
1. Runs CI (typecheck + tests + lint)
2. Builds Docker image → pushes to ECR
3. Updates ECS service → rolling deployment
4. Syncs web assets to S3 → invalidates CloudFront
5. Runs health check (5 retries)
6. Posts result to Slack

**Monitor**: GitHub Actions → CI/CD Deploy workflow

### Manual Production Deploy

```
GitHub → Actions → CI/CD Deploy → Run workflow
  environment: production
  → Requires approval in "production" environment
  → Reviewer clicks Approve
  → Same steps as staging
```

### Post-Deploy Verification (15 minutes)

```bash
# 1. API health check
curl -s https://api.taprootpos.com/api/health | jq

# 2. Check ECS service stability
aws ecs describe-services \
  --cluster taproot-production-cluster \
  --services taproot-production-api \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}'

# 3. Check CloudWatch dashboard
# https://console.aws.amazon.com/cloudwatch → Taproot Production

# 4. Check error rate (should be <1%)
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_ELB_5XX_Count \
  --dimensions Name=LoadBalancer,Value=$(aws elbv2 describe-load-balancers \
    --query 'LoadBalancers[?contains(LoadBalancerName,`taproot-production`)].LoadBalancerArn' \
    --output text) \
  --start-time $(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                date -u -v-30M +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 1800 \
  --statistics Sum
```

---

## Rollback

### Code Rollback (No DB Migration)

```bash
# Option A: Re-run last successful deployment in GitHub Actions
# GitHub → Actions → CI/CD Deploy → find last green run → Re-run jobs

# Option B: Force ECS to use previous image
# 1. Find previous task definition revision
aws ecs list-task-definitions \
  --family-prefix taproot-production-api \
  --sort DESC \
  --query 'taskDefinitionArns[0:3]'

# 2. Update service to use previous revision
aws ecs update-service \
  --cluster taproot-production-cluster \
  --service taproot-production-api \
  --task-definition taproot-production-api:PREVIOUS_REVISION

# 3. Wait for stability
aws ecs wait services-stable \
  --cluster taproot-production-cluster \
  --services taproot-production-api
```

### DB Migration Rollback

```bash
# ALWAYS create a snapshot before migrations (handled by deploy.yml)

# 1. Run the down migration
npm run db:migrate:down

# 2. If down migration is not available (destructive change):
# Restore from the pre-deploy RDS snapshot
# See docs/BACKUP.md → "Restore RDS from Snapshot"

# 3. Update ECS to previous image (code rollback above)
```

### Frontend Rollback

```bash
# Re-sync a previous build from S3 version history
# or re-run the previous successful GitHub Actions web build
aws s3 sync s3://taproot-web-prod-backup/ s3://taproot-web-prod/
aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*"
```

---

## Scale Up

### API — More Tasks

```bash
# Edit infra/bin/taproot.ts: desiredCount: 2 → 4
# Then redeploy CDK or update directly:
aws ecs update-service \
  --cluster taproot-production-cluster \
  --service taproot-production-api \
  --desired-count 4
```

Auto-scaling handles 1–4 tasks based on CPU > 70%. For sustained load,
increase the range in `taproot-stack.ts`:
```typescript
maxCapacity: 8,  // was 4
```

### Database — Larger Instance

```bash
# Modify instance class (15-minute maintenance window, brief downtime)
aws rds modify-db-instance \
  --db-instance-identifier taproot-production-postgres \
  --db-instance-class db.t3.medium \
  --apply-immediately

# Monitor status
aws rds wait db-instance-available \
  --db-instance-identifier taproot-production-postgres
```

Instance sizing guide:
| Connections | Instance | Monthly Cost |
|-------------|----------|-------------|
| < 100 | db.t3.micro | ~$13 |
| < 500 | db.t3.small | ~$26 |
| < 1000 | db.t3.medium | ~$52 |
| < 5000 | db.m6g.large | ~$130 |

### Redis — Larger Node

```bash
# Modify via console (ElastiCache → Modify → Node type)
# Zero-downtime if cluster mode; brief downtime for single-node
```

---

## On-Call Alerts

### Alert: API error rate > 5%

1. Check CloudWatch Logs: `/taproot/production/api`
2. Look for 500 errors: `fields @message | filter level = "error"`
3. Check recent deploys in GitHub Actions
4. If new deploy: rollback immediately (see above)
5. If no recent deploy: check DB connections, Redis connectivity

```bash
# Check ECS task logs
aws logs tail /taproot/production/api --follow --since 15m
```

### Alert: API P95 latency > 2s

1. Check DB slow query log (log_min_duration_statement = 1000ms)
2. Check Redis CPU in ElastiCache console
3. Check ECS CPU in CloudWatch → may need to scale out
4. Check for N+1 queries in recent code changes

```bash
# Check DB slow queries
aws rds describe-db-log-files \
  --db-instance-identifier taproot-production-postgres
aws rds download-db-log-file-portion \
  --db-instance-identifier taproot-production-postgres \
  --log-file-name error/postgresql.log \
  --starting-token 0
```

### Alert: DB connections > 80

1. Current max_connections = 100 (RDS parameter group)
2. Check for connection leaks (unclosed connections in code)
3. Consider enabling PgBouncer as a connection pooler
4. Short term: restart API service (closes all connections):
```bash
aws ecs update-service \
  --cluster taproot-production-cluster \
  --service taproot-production-api \
  --force-new-deployment
```

### Alert: Monthly budget > $160

1. Open AWS Cost Explorer: identify top cost drivers
2. Check for accidental data transfer costs (large S3 downloads)
3. Check for runaway CloudWatch logs (set retention on all log groups)
4. Check ECS task count (auto-scaling stuck at max?)

---

## Useful Commands

```bash
# SSH into running ECS task (via ECS Exec)
aws ecs execute-command \
  --cluster taproot-production-cluster \
  --task <task-id> \
  --container taproot-api \
  --interactive \
  --command "/bin/sh"

# View live API logs
aws logs tail /taproot/production/api --follow

# Force new ECS deployment (rolling restart)
aws ecs update-service \
  --cluster taproot-production-cluster \
  --service taproot-production-api \
  --force-new-deployment

# List ECR images
aws ecr describe-images \
  --repository-name taproot-api \
  --query 'imageDetails[*].[imageTags[0],imagePushedAt]' \
  --output table \
  | sort -k2 -r | head -10

# Check Secrets Manager secret (last updated time)
aws secretsmanager describe-secret \
  --secret-id taproot/production/jwt-secret \
  --query '[LastChangedDate,LastAccessedDate]'

# Get CloudFront distribution status
aws cloudfront get-distribution \
  --id $CLOUDFRONT_DISTRIBUTION_ID \
  --query 'Distribution.Status'

# Create CloudFront invalidation
aws cloudfront create-invalidation \
  --distribution-id $CLOUDFRONT_DISTRIBUTION_ID \
  --paths "/*"
```

---

## Infrastructure Changes (CDK)

```bash
# Preview changes before deploying
cd infra
cdk diff TaprootProduction

# Deploy with approval prompt for sensitive changes
cdk deploy TaprootProduction

# Never destroy production unless decommissioning
# cdk destroy TaprootProduction  # ← protected by deletionProtection=true on RDS
```

---

## Contact / Escalation

| Severity | Response Time | Action |
|----------|--------------|--------|
| P1 — total outage | 15 min | Page on-call engineer |
| P2 — degraded (>5% errors) | 1 hour | Slack #incidents |
| P3 — slow queries | Next business day | JIRA ticket |
| Cost overrun | 24 hours | Review Cost Explorer |
