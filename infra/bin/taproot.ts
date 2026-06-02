#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { TaprootStack } from '../lib/taproot-stack'

const app = new cdk.App()

// ── Staging ────────────────────────────────────────────────────────────────────
new TaprootStack(app, 'TaprootStaging', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  stageName:     'staging',
  domainName:    'staging.taprootpos.com',
  instanceClass: 'db.t3.micro',
  desiredCount:  1,
  multiAz:       false,
})

// ── Production ─────────────────────────────────────────────────────────────────
new TaprootStack(app, 'TaprootProduction', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  stageName:     'production',
  domainName:    'app.taprootpos.com',
  instanceClass: 'db.t3.small',
  desiredCount:  2,
  multiAz:       true,
})
