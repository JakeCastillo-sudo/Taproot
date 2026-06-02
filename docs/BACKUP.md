# Taproot POS — Backup Strategy

## Overview

Taproot is a multi-tenant SaaS — all customer data lives in one PostgreSQL database,
separated by `organization_id`. This document covers backup procedures, retention
policies, and recovery objectives.

---

## Recovery Objectives

| Metric | Beta Target | Growth Target |
|--------|------------|--------------|
| **RTO** (time to restore service) | < 1 hour | < 15 minutes |
| **RPO** (maximum data loss) | < 24 hours | < 1 hour |
| **Restore drill frequency** | Monthly | Weekly |

---

## 1. Database Backups

### Automatic (AWS RDS)

RDS takes automated daily snapshots retained for **7 days**.

- **Staging**: 1-day retention, no Multi-AZ
- **Production**: 7-day retention, Multi-AZ (synchronous standby)
- **Backup window**: 03:00–04:00 UTC (low-traffic window)
- **Maintenance window**: Sunday 05:00–06:00 UTC

RDS snapshots are stored in S3 (AWS-managed) and automatically replicated within
the region. Snapshots are encrypted with the RDS KMS key.

### Manual (Before Every Production Deploy)

Always create a manual snapshot before running migrations:

```bash
# Create a manual RDS snapshot
aws rds create-db-snapshot \
  --db-instance-identifier taproot-production-postgres \
  --db-snapshot-identifier taproot-pre-deploy-$(date +%Y%m%d-%H%M%S)

# Wait for snapshot to complete
aws rds wait db-snapshot-completed \
  --db-snapshot-identifier taproot-pre-deploy-$(date +%Y%m%d-%H%M%S)

echo "Snapshot complete — safe to run migrations"
```

### Manual pg_dump (EC2/On-premise)

```bash
# Full backup
pg_dump $DATABASE_URL \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  > /var/backups/taproot-$(date +%Y%m%d-%H%M%S).pgdump

# Upload to S3
aws s3 cp /var/backups/taproot-$(date +%Y%m%d).pgdump \
  s3://taproot-backups-prod/db/taproot-$(date +%Y%m%d).pgdump

# Cleanup local files older than 7 days
find /var/backups -name "taproot-*.pgdump" -mtime +7 -delete
```

### Automated Daily Cron (EC2)

Add to `/etc/cron.d/taproot-backup`:

```cron
0 3 * * * taproot /home/taproot/app/scripts/backup-db.sh >> /var/log/taproot/backup.log 2>&1
```

---

## 2. Redis Backups

Redis is used for:
- Session cache (JWT tokens — short-lived, regenerable)
- Offline payment queue (AES-256-GCM encrypted, 24h TTL)
- WebSocket pub/sub channels (ephemeral)
- Rate limiter state (ephemeral)

**Redis data is ephemeral by design.** Offline payment queues are the only
operationally critical data — these are processed within 24 hours and
dead-lettered to PostgreSQL if all retries fail.

Redis persistence (AOF) is enabled in production for durability across restarts.
ElastiCache Redis snapshots: 3 retained in production.

---

## 3. Application Backups

### Code — GitHub (primary)

All application code is versioned in Git. Every production deploy is tagged with
a semantic version (`v1.2.3`). To restore any version:

```bash
git checkout v1.2.3
npm ci && npm run build
```

### Environment Variables — AWS Secrets Manager

All production secrets are stored in AWS Secrets Manager under `taproot/production/*`.
Secrets Manager is versioned — previous values are retained for 30 days.

To list all production secrets:
```bash
aws secretsmanager list-secrets \
  --filter Key=name,Values=taproot/production
```

To export a secret value (for emergency use):
```bash
aws secretsmanager get-secret-value \
  --secret-id taproot/production/jwt-secret \
  --query SecretString \
  --output text
```

### Uploaded Documents — S3 Versioning

The `taproot-web-prod` S3 bucket has versioning enabled. Deleted or overwritten
objects can be recovered from S3 version history within 30 days.

---

## 4. Restore Procedures

### Restore RDS from Snapshot

```bash
# List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier taproot-production-postgres \
  --query 'DBSnapshots[*].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' \
  --output table

# Restore to a new instance (non-destructive)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier taproot-production-restored \
  --db-snapshot-identifier <snapshot-id> \
  --db-instance-class db.t3.small \
  --no-multi-az

# Wait for restoration
aws rds wait db-instance-available \
  --db-instance-identifier taproot-production-restored

echo "Restored DB available — update DATABASE_URL in Secrets Manager"
```

### Restore pg_dump

```bash
# Restore from custom-format dump
pg_restore \
  --dbname=$DATABASE_URL \
  --clean \
  --if-exists \
  --no-acl \
  --no-owner \
  --verbose \
  taproot-20240115.pgdump
```

### Point-in-Time Recovery (PITR)

RDS supports PITR to any second within the backup retention window:

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier taproot-production-postgres \
  --target-db-instance-identifier taproot-pitr-restore \
  --restore-time 2024-01-15T14:30:00Z
```

---

## 5. Monthly Restore Drill

Every month, perform a restore drill to verify backups are valid:

1. Pick a recent RDS snapshot
2. Restore to `taproot-staging-restored` instance
3. Run `npm run db:migrate` (should be no-op — already applied)
4. Spot-check 5 random records against production data
5. Delete `taproot-staging-restored` instance
6. Document results in `docs/restore-drill-log.md`

---

## 6. S3 Backup Bucket Policy

The `taproot-backups-prod` S3 bucket should be configured with:

```json
{
  "Rules": [
    {
      "ID": "expire-old-backups",
      "Status": "Enabled",
      "Expiration": { "Days": 90 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    }
  ]
}
```

Enable versioning and MFA delete on the backup bucket for production.

---

## 7. Compliance Notes

- Backups are encrypted at rest (RDS KMS, S3 SSE-S3)
- Backup access is logged in CloudTrail
- PCI DSS: card numbers are never stored — only last4+brand — so backup scope is limited
- GDPR: customer data deletion requests must also purge backup snapshots after retention period
