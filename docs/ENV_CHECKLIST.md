# Railway Environment Variable Checklist

> **Source of truth:** `apps/api/src/config.ts` (`validateConfig()`) + `apps/api/src/index.ts`
> (CORS + admin seed). This list is derived directly from the code, not from memory.
>
> Go to: **railway.app → practical-reverence → production → Taproot service → Variables tab**

## ⚠️ Corrections vs. the original task template
The first-draft checklist had a few items that do **not** match the actual code. Use this
file instead:

| Original template said | Reality (from code) |
|---|---|
| `JWT_REFRESH_SECRET` required | **Does not exist.** Refresh tokens are signed with `JWT_SECRET` (no separate refresh secret in this codebase). Setting it has no effect. |
| `CORS_ORIGINS` required | **Optional.** Prod domains are hardcoded in `index.ts` (`https://taproot-pos.com`, `https://www.taproot-pos.com`). `CORS_ORIGINS` only *adds* extra origins. |
| `ADMIN_JWT_SECRET` "admin portal breaks without this" | Admin portal **works without it** — falls back to `${JWT_SECRET}_admin`. Still set it explicitly (see below). |
| (missing) | `MFA_TOKEN_SECRET` — **REQUIRED, app crashes on boot without it.** |
| (missing) | `MFA_ENCRYPTION_KEY` — **REQUIRED, app crashes on boot; must be exactly 64 hex chars.** |

---

## REQUIRED — app refuses to boot if missing
`validateConfig()` throws on startup if any of these are unset (and the container crash-loops):

```
□ DATABASE_URL        — auto-injected by Railway Postgres plugin. Starts with: postgres://
□ JWT_SECRET          — HMAC secret for access AND refresh JWTs (HS256).
                        PRODUCTION: must be >= 64 chars. Generate: openssl rand -hex 64
□ MFA_TOKEN_SECRET    — secret for the 5-min MFA challenge token.
                        Generate: openssl rand -hex 32
□ MFA_ENCRYPTION_KEY  — AES-256-GCM key for TOTP secrets at rest.
                        MUST be EXACTLY 64 hex chars (32 bytes). Generate: openssl rand -hex 32
```

## REQUIRED IN PRODUCTION — `NODE_ENV=production` adds these hard checks
```
□ NODE_ENV            — must be exactly: production  (default is 'development')
□ JWT_SECRET (>=64)   — production enforces length >= 64 (see above)
□ STRIPE_SECRET_KEY   — hard-required in production. sk_live_ for real charges;
                        sk_test_ boots but logs a WARNING (ghost/beta mode, no real money)
```

## FORMAT-VALIDATED — only if set, but wrong format crashes boot
```
□ OFFLINE_ENCRYPTION_KEY — AES key for offline card data in Redis.
                           If set, MUST be exactly 64 hex chars. Generate: openssl rand -hex 32
□ JWT_RS256_PRIVATE_KEY / JWT_RS256_PUBLIC_KEY — optional RS256 override.
                           Must be set TOGETHER or not at all (public required if private set).
```

## SECURITY-CRITICAL (recommended explicit, has a fallback)
```
□ ADMIN_JWT_SECRET    — admin/executive portal JWT secret.
                        Falls back to `${JWT_SECRET}_admin` if unset (so the portal still
                        works), but SET IT EXPLICITLY. Generate: openssl rand -base64 32
                        ⚠️ The admin password was exposed in a chat transcript — rotating
                        this secret invalidates any tokens minted under the fallback.
```

## OPTIONAL — features degrade gracefully (warn, never crash)
```
□ REDIS_URL           — auto-injected by Railway Redis plugin. Starts with: redis://
                        Defaults to redis://localhost:6379; real-time + offline queue degrade
                        without a real instance. (Prod: confirm it points at the Railway Redis.)
□ ANTHROPIC_API_KEY   — sk-ant-...  AI import + NL analytics + helpdesk AI unavailable if unset
                        (production logs a WARNING, does not crash).
□ CLAUDE_MODEL        — defaults to claude-sonnet-4-6
□ CORS_ORIGINS        — comma-separated extra origins. Prod domains already hardcoded.
□ APP_URL             — used in email links + allowed as a CORS origin. Default localhost:5173
□ STRIPE_WEBHOOK_SECRET / STRIPE_CONNECT_WEBHOOK_SECRET / STRIPE_TERMINAL_WEBHOOK_SECRET
                        — must start with whsec_ ; mismatched values warn (verification fails)
□ STRIPE_BILLING_PRICE_ID — price_... for the subscription plan
□ TAPROOT_APPLICATION_FEE_RATE — defaults to 0.003 (0.3%)
□ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER — SMS ordering
□ SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM — transactional email
□ SENDGRID_API_KEY    — prod transactional email (else jsonTransport/console)
□ S3_BUCKET / S3_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — document upload storage
□ SENTRY_DSN          — error monitoring (silently disabled if absent)
```

## VITE FRONTEND VARS — set in **Vercel**, not Railway
```
□ VITE_API_URL                — https://taproot-production-3d63.up.railway.app
                                (also committed in apps/web/.env.production)
□ VITE_STRIPE_PUBLISHABLE_KEY — pk_live_ or pk_test_
```

---

## What we can INFER is already set (from live runtime behavior)
We cannot read Railway's Variables tab from here, but the running app proves these are set
and valid (otherwise it would crash or the feature would fail):

| Variable | Evidence it's set & working |
|---|---|
| DATABASE_URL | `/api/health` → `database: ok` |
| REDIS_URL | `/api/health` → `redis: ok` |
| STRIPE_SECRET_KEY | `/api/health` → `stripe: ok` |
| JWT_SECRET | org + admin logins return tokens |
| MFA_TOKEN_SECRET, MFA_ENCRYPTION_KEY | app booted at all (required — would crash otherwise) |
| ANTHROPIC_API_KEY | helpdesk AI returns spec-grounded answers |
| NODE_ENV=production | app is live on Railway with prod behavior |
| CORS / prod domains | taproot-pos.com loads the app against the API |

**Jake still must manually confirm in the Variables tab:**
- `ADMIN_JWT_SECRET` is set explicitly (not relying on the fallback) — and rotate it.
- `JWT_SECRET` is >= 64 chars (prod requirement).
- `STRIPE_SECRET_KEY` is `sk_live_` (not `sk_test_`) before taking real payments.
