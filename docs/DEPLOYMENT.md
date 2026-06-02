# Taproot POS — Deployment Guide

## Table of Contents
1. [Local Development](#local-development)
2. [Architecture Overview](#architecture-overview)
3. [GitHub Secrets](#github-secrets)
4. [Branch Protection](#branch-protection)
5. [Staging Deployment](#staging-deployment)
6. [Production Deployment](#production-deployment)
7. [Rollback Procedure](#rollback-procedure)
8. [Environment Variables](#environment-variables)
9. [Database Migrations](#database-migrations)
10. [Monitoring & Metrics](#monitoring--metrics)
11. [Common Issues](#common-issues)

---

## Local Development

### Prerequisites
- Node.js 20.x (`node -v` to verify)
- PostgreSQL 15+ (`psql --version`)
- Redis 8+ (`redis-cli --version`)
- npm 10+

### First-time setup
```bash
git clone https://github.com/JakeCastillo-sudo/Taproot.git
cd Taproot

# Install all workspace dependencies
npm install

# Copy and fill in the environment file
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your local DB/Redis credentials

# Create local database
createdb taproot_dev
createuser taproot_app

# Run all migrations (creates schema + seed data)
npm run db:migrate

# Start API + web in parallel (kills conflicting ports first)
npm run dev:clean
```

### Access
- **Web app**: http://localhost:5173
- **API**: http://localhost:3001
- **Health check**: http://localhost:3001/api/health

### Useful scripts
```bash
npm run dev:clean       # Kill port conflicts, then start dev servers
npm run db:migrate      # Apply pending migrations
npm run db:migrate:down # Roll back one migration
npm run db:reseed       # Wipe and re-seed demo data
npm run typecheck       # TypeScript check (API)
npm run test            # Jest tests (API)
npm run lint            # ESLint (API + web)
node scripts/generate-icons.js  # Regenerate PWA icons
```

---

## Architecture Overview

```
GitHub → CI (quality gates) → merge to main
                                    ↓
                          GitHub Actions deploy.yml
                          ┌─────────┴──────────┐
                      staging               production
                     (auto)            (manual approval)
                          ↓                   ↓
                   SSH → git pull      SSH → git pull
                   → npm build         → npm build
                   → db:migrate:safe   → db:migrate:safe
                   → pm2 restart       → pm2 restart
                          ↓                   ↓
                   S3 sync             S3 sync
                   CloudFront inval.   CloudFront inval.
                          ↓                   ↓
                   Health check        Smoke tests
                   Slack notify        Slack notify
```

---

## GitHub Secrets

Add all secrets at: **Settings → Secrets and variables → Actions → New repository secret**

### Staging secrets
| Secret | Description |
|--------|-------------|
| `STAGING_HOST` | IP or hostname of staging server |
| `STAGING_SSH_KEY` | Private SSH key for staging `deploy` user |
| `STAGING_DB_URL` | `postgresql://...@staging-db:5432/taproot_staging?sslmode=require` |
| `STAGING_REDIS_URL` | `redis://staging-redis:6379` |
| `STAGING_JWT_SECRET` | 64+ random hex characters |
| `STAGING_ANTHROPIC_KEY` | `sk-ant-...` |
| `STAGING_STRIPE_KEY` | `sk_test_...` (Stripe TEST key) |
| `STAGING_WEBHOOK_SECRET` | `whsec_...` (Stripe webhook secret) |

### Production secrets
| Secret | Description |
|--------|-------------|
| `PROD_HOST` | Production server IP |
| `PROD_SSH_KEY` | Private SSH key for production `deploy` user |
| `PROD_DB_URL` | `postgresql://...@prod-db:5432/taproot_prod?sslmode=require` |
| `PROD_REDIS_URL` | `redis://prod-redis:6379` |
| `PROD_JWT_SECRET` | 64+ random hex characters (DIFFERENT from staging) |
| `PROD_ANTHROPIC_KEY` | `sk-ant-...` |
| `PROD_STRIPE_KEY` | **`sk_live_...`** (Stripe LIVE key — processes real payments) |
| `PROD_WEBHOOK_SECRET` | `whsec_...` (Stripe live webhook secret) |

### AWS / CDN
| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM access key (S3 + CloudFront write permissions) |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_REGION` | e.g. `us-east-1` |
| `S3_STAGING_BUCKET` | `taproot-web-staging` |
| `S3_PROD_BUCKET` | `taproot-web-prod` |
| `CLOUDFRONT_STAGING_ID` | CloudFront distribution ID (staging) |
| `CLOUDFRONT_PROD_ID` | CloudFront distribution ID (production) |

### Notifications (optional)
| Secret | Description |
|--------|-------------|
| `SLACK_WEBHOOK_URL` | Incoming webhook URL for deploy notifications |

---

## Branch Protection

Apply these rules at: **Settings → Branches → Add rule → `main`**

```
✅ Require a pull request before merging
✅ Require approvals: 1
✅ Dismiss stale pull request approvals when new commits are pushed
✅ Require status checks to pass before merging
   Required checks:
   - API — typecheck + tests
   - Web — typecheck + build
   - ESLint
   - Security scan
✅ Require branches to be up to date before merging
✅ Do not allow bypassing the above settings
```

**Environment protection** (Settings → Environments → production):
```
✅ Required reviewers: [add your username]
✅ Allow only protected branches to deploy
```

---

## Staging Deployment

Staging deploys automatically on every push to `main` that passes CI.

### What happens
1. GitHub Actions runs `ci.yml` — all 4 jobs must pass
2. On success, `deploy.yml` triggers the `staging-deploy` job
3. API is deployed via SSH + PM2
4. Web build is synced to S3 and CloudFront cache is invalidated
5. Health check confirms the deploy is healthy
6. Slack notification sent (if configured)

### Server setup (one-time)
```bash
# On Ubuntu 22.04 staging server as root:

# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2
sudo pm2 startup  # Follow output instructions

# Install Nginx + Certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Create deploy user
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /opt/taproot
sudo chown deploy:deploy /opt/taproot

# Add your SSH public key for the deploy user
sudo -u deploy mkdir -p ~/.ssh
echo "ssh-rsa YOUR_PUBLIC_KEY..." | sudo -u deploy tee -a ~/.ssh/authorized_keys
sudo chmod 700 /opt/taproot/.ssh && sudo chmod 600 /opt/taproot/.ssh/authorized_keys

# Clone repo
sudo -u deploy git clone https://github.com/JakeCastillo-sudo/Taproot.git /opt/taproot
sudo -u deploy cp /opt/taproot/apps/api/.env.staging.example /opt/taproot/apps/api/.env
# Fill in the .env file with real staging values
```

---

## Production Deployment

Production requires **manual approval** in the GitHub Actions UI.

### Trigger
1. Go to: **Actions → Deploy → Run workflow**
2. Select environment: `production`
3. Click **Run workflow**
4. A reviewer must approve in the **Environments → production** approval gate

### Or via release tag
```bash
# Uses scripts/release.js to bump version, commit, tag, and push
node scripts/release.js patch    # 1.0.0 → 1.0.1
node scripts/release.js minor    # 1.0.0 → 1.1.0
node scripts/release.js major    # 1.0.0 → 2.0.0
```

Pushing a `v*.*.*` tag triggers `release.yml`, creates a GitHub Release,
and dispatches `deploy.yml` targeting production.

### Post-deploy verification
The deploy pipeline runs automatic smoke tests:
- `GET /api/health` → 200
- `POST /api/v1/auth/login {}` → 400 (validates route is alive)

Verify manually:
```bash
curl https://app.taprootpos.com/api/health | jq
```

---

## Rollback Procedure

### Code rollback (no DB migrations ran)
```bash
# Find the last good commit
git log --oneline -10

# Revert and push (triggers a new deploy)
git revert <bad-commit-sha>
git push
```

### Emergency rollback (DB migrations ran)
```bash
# 1. Immediately roll back the code deploy
#    On the production server:
cd /opt/taproot
git checkout <previous-good-tag>
npm ci --omit=dev
npm run build --workspace=@taproot/api
pm2 restart taproot-api --env production

# 2. Roll back the database (requires backup!)
#    Replace the snapshot date:
pg_restore -d taproot_prod /opt/backups/taproot_prod_YYYY-MM-DD.dump

# 3. Alert: Check if any data was written between migration and rollback.
#    Reconcile manually if necessary.
```

---

## Environment Variables

Full reference for both environments. See the example files for current values:
- `apps/api/.env.staging.example`
- `apps/api/.env.production.example`

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_SECRET` | ✅ | ≥64 chars for access token signing |
| `JWT_REFRESH_SECRET` | ✅ | ≥64 chars for refresh token signing |
| `MFA_TOKEN_SECRET` | ✅ | ≥64 chars for TOTP signing |
| `MFA_ENCRYPTION_KEY` | ✅ | 64 hex chars (32 bytes) AES-256 key |
| `OFFLINE_ENCRYPTION_KEY` | ✅ | 64 hex chars (32 bytes) AES-256 key |
| `ANTHROPIC_API_KEY` | ✅ | `sk-ant-...` for AI document parsing |
| `STRIPE_SECRET_KEY` | ✅ | `sk_live_...` (prod) or `sk_test_...` (staging) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | ✅ | Stripe Connect webhook signing secret |
| `STRIPE_TERMINAL_WEBHOOK_SECRET` | ✅ | Stripe Terminal webhook signing secret |
| `NODE_ENV` | ✅ | `production` or `staging` |
| `PORT` | ✅ | API listen port (default 3001) |
| `APP_URL` | ✅ | Public URL (for CORS + redirects) |
| `CORS_ORIGINS` | ✅ | Allowed CORS origins (comma-separated) |
| `METRICS_SECRET` | Optional | Protects `GET /metrics` endpoint |
| `SMTP_HOST` | Optional | SMTP server for email receipts |

---

## Database Migrations

### Safe migration runner
Use `npm run db:migrate:safe` (not `db:migrate`) in CI/CD pipelines.

It:
1. Shows pending migrations before applying
2. In production: waits 10 seconds for an operator to abort (Ctrl+C)
3. Exits non-zero on failure so the deploy stops immediately

### Naming convention
Migrations are numbered sequentially: `001_`, `002_`, ..., `NNN_`.

### Creating a migration
```bash
# Create a new migration file
touch migrations/009_my_feature.js

# Apply migrations
npm run db:migrate

# Roll back one step
npm run db:migrate:down
```

---

## Monitoring & Metrics

### Health endpoint
```bash
curl https://app.taprootpos.com/api/health
# Response: { status: "ok", version, timestamp, checks: { database, redis, stripe }, uptime }
```

### Prometheus metrics
```bash
curl -H "X-Metrics-Secret: YOUR_METRICS_SECRET" \
  https://app.taprootpos.com/metrics
```

Metrics include:
- `taproot_http_requests_total{method,route,status}` — request counter
- `taproot_http_duration_seconds{method,route}` — latency histogram
- `taproot_db_pool_size/idle/pending` — connection pool state
- `taproot_orders_total` / `taproot_revenue_total_cents` — business KPIs
- `taproot_memory_rss_bytes` / `taproot_memory_heap_bytes` — process memory
- `taproot_redis_connected_clients` — Redis load

### PM2 process management
```bash
pm2 list                        # All running processes
pm2 logs taproot-api            # Live logs
pm2 logs taproot-api --err      # Error logs only
pm2 monit                       # Real-time CPU/memory dashboard
pm2 reload taproot-api          # Zero-downtime reload (cluster mode)
pm2 restart taproot-api         # Hard restart
```

---

## Common Issues

### Port conflicts
```bash
# If ports 3001 or 5173 are in use:
npm run dev:clean   # kills conflicting ports then starts dev servers
# Or manually: kill $(lsof -ti:3001)
```

### Migration errors
```bash
# Check which migrations ran:
npm run db:migrate -- status

# Roll back the last migration:
npm run db:migrate:down

# If production migration fails:
# 1. Restore from backup (see Rollback Procedure above)
# 2. Fix the migration file
# 3. Re-deploy
```

### Redis connection refused
```bash
# macOS dev:
brew services restart redis

# Ubuntu:
sudo systemctl restart redis-server

# Check connection:
redis-cli ping  # → PONG
```

### TypeScript errors after install
```bash
# Clean and reinstall
rm -rf node_modules apps/api/node_modules apps/web/node_modules
npm install
npx tsc --noEmit  # apps/api
```

### PM2 process not starting
```bash
# View PM2 error logs:
pm2 logs taproot-api --err --lines 50

# Common cause: missing .env file or DATABASE_URL not set
ls /opt/taproot/apps/api/.env
cat /opt/taproot/apps/api/.env | grep DATABASE_URL
```

### Stripe webhook failures
```bash
# Verify webhook signature (in logs)
grep "webhook" /opt/taproot/logs/api-error.log | tail -20

# Re-register webhook endpoint in Stripe Dashboard:
# Developers → Webhooks → Add endpoint
# URL: https://app.taprootpos.com/api/v1/webhooks/stripe/connect
# Events: account.updated, account.application.deauthorized,
#          account.external_account.created, capability.updated,
#          terminal.reader.action_failed, terminal.reader.action_succeeded
```
