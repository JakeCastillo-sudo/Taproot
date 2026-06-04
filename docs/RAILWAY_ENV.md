# Railway Environment Variables

Copy these into your Railway service:
**Dashboard → Your Service → Variables**

---

## Generating Secure Values

Run these locally before setting up Railway:

```bash
# JWT access token secret (64+ chars required in production)
openssl rand -hex 32

# JWT MFA token secret
openssl rand -hex 32

# MFA (TOTP) encryption key — AES-256-GCM (must be exactly 64 hex chars = 32 bytes)
openssl rand -hex 32

# Offline payment encryption key — AES-256-GCM (must be exactly 64 hex chars = 32 bytes)
openssl rand -hex 32
```

---

## Required Variables

> **Do NOT set `PORT` manually.** Railway injects `$PORT` automatically and configures
> its proxy to forward to that port. Setting a static `PORT=3001` causes the service
> domain to lock to that value on every deploy, overriding Railway's routing config.
> The app reads `process.env.PORT` with a fallback of 3001 — Railway's injected value
> always takes precedence.

| Variable | Value / Source | Notes |
|---|---|---|
| `DATABASE_URL` | Auto-injected by Railway PostgreSQL plugin | Set by Railway — do not override |
| `REDIS_URL` | Auto-injected by Railway Redis plugin | Set by Railway — do not override |
| `NODE_ENV` | `production` | Enables HSTS, strict CORS, live Stripe key check |
| `JWT_SECRET` | `openssl rand -hex 32` | Min 64 chars in production |
| `MFA_TOKEN_SECRET` | `openssl rand -hex 32` | Used for short-lived MFA challenge tokens |
| `MFA_ENCRYPTION_KEY` | `openssl rand -hex 32` | AES-256-GCM key for TOTP secrets at rest |
| `OFFLINE_ENCRYPTION_KEY` | `openssl rand -hex 32` | AES-256-GCM key for offline card queue in Redis |
| `APP_URL` | `https://taproot-pos.vercel.app` | **Frontend** URL — used for CORS allow-origin and email links |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) | Required for AI import + NL queries |
| `STRIPE_SECRET_KEY` | `sk_test_...` from Stripe Dashboard | Use `sk_test_` for demo; `sk_live_` for production revenue |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks | Verifies Connect account webhooks |
| `STRIPE_TERMINAL_WEBHOOK_SECRET` | From Stripe Dashboard → Webhooks | Verifies Terminal payment webhooks |
| `STRIPE_BILLING_PRICE_ID` | `price_...` from Stripe Dashboard | Subscription price ID for the Growth plan |
| `TAPROOT_APPLICATION_FEE_RATE` | `0.003` | 0.3% ISV application fee on all transactions |

---

## Optional Variables (leave unset to use defaults)

| Variable | Default / Notes |
|---|---|
| `METRICS_SECRET` | If set, protects `GET /metrics` with `X-Metrics-Secret` header |
| `SENDGRID_API_KEY` | If unset, emails are logged to console instead of sent |
| `SENTRY_DSN` | If unset, Sentry is disabled (errors still log to Railway console) |
| `UPLOADS_DIR` | Defaults to `uploads/` — Railway ephemeral filesystem is fine for demo |
| `S3_BUCKET` / `S3_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Only needed if you want file imports persisted to S3 |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` (default) — Claude model ID for document parsing and NL analytics. Override to use a different model (e.g. `claude-opus-4-6`) without redeploying. |

---

## Railway PostgreSQL + Redis Plugins

In your Railway project, add two plugins before first deploy:

1. **PostgreSQL** — Click **+ New** → **Database** → **PostgreSQL**
   - Railway auto-sets `DATABASE_URL` in your service
   - The `releaseCommand` (`railway-migrate.js`) runs all migrations on first deploy

2. **Redis** — Click **+ New** → **Database** → **Redis**
   - Railway auto-sets `REDIS_URL` in your service

---

## Stripe Webhook Setup

After your Railway service URL is live (`https://taproot-api.up.railway.app`):

```bash
# Register webhook endpoints and get secrets
DATABASE_URL="..." node scripts/register-webhooks.js
```

Or manually in Stripe Dashboard → Developers → Webhooks:

| Endpoint URL | Events |
|---|---|
| `https://taproot-api.up.railway.app/api/v1/webhooks/stripe/connect` | `account.updated`, `account.application.deauthorized`, `capability.updated` |
| `https://taproot-api.up.railway.app/api/v1/webhooks/stripe/terminal` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `terminal.reader.*` |

Copy the signing secrets into `STRIPE_CONNECT_WEBHOOK_SECRET` and `STRIPE_TERMINAL_WEBHOOK_SECRET`.

---

## Vercel Environment Variables

Set in Vercel Dashboard → Your Project → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://taproot-api.up.railway.app` |

This is already pre-configured in `apps/web/.env.production` for local Vercel CLI deploys.

---

## Full Variable Block (copy-paste into Railway)

```
NODE_ENV=production
APP_URL=https://taproot-pos.vercel.app
TAPROOT_APPLICATION_FEE_RATE=0.003
```

> **PORT is intentionally omitted.** Railway injects it automatically.

Generate and add these individually (do not copy — generate fresh values):
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "MFA_TOKEN_SECRET=$(openssl rand -hex 32)"
echo "MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "OFFLINE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
```
