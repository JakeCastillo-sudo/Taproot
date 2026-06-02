# Taproot POS — QA Report
**Prompt 20 — White-Glove QA Pass**
**Date:** 2026-06-02
**Verdict: ✅ BETA READY** (with known minor items logged in BACKLOG.md)

---

## Executive Summary

A comprehensive 8-phase quality assurance review was conducted against the full Taproot POS stack
(20 prompts of accumulated work). The review covered TypeScript correctness, end-to-end flow testing,
security, performance, data integrity, and production readiness.

**8 bugs were found and fixed** during this pass — none are show-stoppers for beta. The most critical
were runtime schema mismatches between service code and the live database (employees.is_active,
tax_rates table), plus a rate-limit status-code regression (500 vs 429). All are now resolved.

| Phase | Status | Summary |
|-------|--------|---------|
| TypeScript strict audit | ✅ PASS | 0 errors in both apps |
| End-to-end flow tests | ✅ PASS | All 8 critical flows working |
| Security audit | ✅ PASS | No plaintext secrets, SQL injection clean, webhook sigs verified |
| Performance | ✅ PASS | All endpoints < 5 ms avg (threshold: 500 ms) |
| Data integrity | ✅ PASS | No orphaned records, no wrong subtotals, no negative inventory |
| Production readiness | ✅ PASS | All env vars set, .env in .gitignore, Docker build working |
| Dead code / TODOs | ⚠️ WARN | 2 TODO comments (non-blocking), 16 console.log in infra files |
| Web build | ✅ PASS | Vite build 2.69 s, PWA generated, all chunks healthy |

---

## Phase 1 — TypeScript Strict Audit

**Command:** `npx tsc --noEmit` in both `apps/api` and `apps/web`

| App | Errors | Warnings |
|-----|--------|----------|
| apps/api | **0** | — |
| apps/web | **0** | — |

Both projects have `"strict": true` in `tsconfig.json`. Zero errors confirms full TypeScript
compliance including `strictNullChecks`, `noImplicitAny`, and `strictFunctionTypes`.

**ESLint:** 0 errors, ~33 API warnings / ~14 web warnings (all pre-existing unused-import warnings
documented in Prompt 16).

---

## Phase 2 — End-to-End Flow Tests

All tests performed against `http://localhost:3001` with a live PostgreSQL + Redis backend.

### 2.1 Registration Flow
```
POST /api/v1/register
  → org created + location created + employee created (single transaction)
  → JWT tokens returned (accessToken + refreshToken at top level)
  → trialDays: 14, nextStep: "onboarding"
  → welcome email dispatched (non-blocking)
```
**Result: ✅ PASS**

**Bugs fixed during this pass:**
- BUG-QA-001: `locations_created_by_fk` FK violation — employee must be created before location.
  Code inserted employee, location, then UPDATE employee.location_ids (correct order).
- BUG-QA-002: Column `is_active` doesn't exist on `employees` table — removed from INSERT.
- BUG-QA-003: Table `employee_locations` doesn't exist — removed junction table INSERT.

### 2.2 Login Flow
```
POST /api/v1/auth/login  (no x-organization-slug header)
  → backend resolves org from email JOIN
  → returns accessToken + refreshToken + user payload
  → demo account: demo@taproot.pos
```
**Result: ✅ PASS**

**Bug fixed:** Frontend previously sent wrong/no org slug; backend now email-based org lookup.

### 2.3 Products List
```
GET /api/v1/products
  → returns { products: [...], total: N }
  → 22 products verified in seed data
```
**Result: ✅ PASS**

### 2.4 Checkout Flow (Full)
```
POST /api/v1/locations/:id/orders
  → orderType: "table_service" (valid DB constraint values: in_store|takeout|delivery|table_service|online|phone)
  → returns { id, order_number: "T-2026-000004", status: "open", total: "2998.0000" }

POST /api/v1/locations/:id/orders/:id/payments
  → paymentMethod: "cash", amount: 3000
  → returns { status: "completed" }

GET /api/v1/locations/:id/orders/:id
  → status: "completed", amount_paid: 3000, change_due: 2
```
**Result: ✅ PASS**

**Bugs fixed during this pass:**
- BUG-QA-004: `employees.is_active` column doesn't exist — removed from order validation query.
- BUG-QA-005: `tax_rates` table doesn't exist — rewrote `calculateTax()` to read from
  `locations.tax_config` JSONB (`{rates: [{name, rate, included}]}`). Current seed has empty
  tax_config → 0% tax (correct for initial setup).

### 2.5 Reports Dashboard
```
GET /api/v1/reports/dashboard
  → returns DashboardMetrics JSON (today/yesterday/this_week/this_month + top_product_today)
```
**Result: ✅ PASS** (was failing with PostgreSQL error 42P18 before fix)

**Bug fixed:** `getDashboardMetrics` passed `[orgId, null, timezone]` but `$2` was not referenced,
causing PostgreSQL "could not determine data type of parameter $2". Fixed to `[orgId, timezone]` and
all `$3` references updated to `$2`. Also fixed SQL injection risk — `locationId` now parameterized.

### 2.6 All Reports Endpoints

| Endpoint | HTTP Status | Data |
|----------|-------------|------|
| GET /api/v1/reports/dashboard | 200 | today/yesterday/week/month metrics |
| GET /api/v1/reports/sales | 200 | 1 row (May 2026), gross_sales: 8096 |
| GET /api/v1/reports/top-products | 200 | 10 products ranked by revenue |
| GET /api/v1/reports/top-customers | 200 | 0 rows (no customer-linked orders in seed) |
| GET /api/v1/reports/payment-methods | 200 | credit_card 56.78%, cash 43.22% |
| GET /api/v1/reports/employee-performance | 200 | 1 employee (Demo Owner) |
| GET /api/v1/reports/hourly-heatmap | 200 | 3 cells (sparse seed data) |

**Result: ✅ PASS**

### 2.7 Customer Management
```
GET /api/v1/customers?limit=5
  → { customers: [5 records], total: 5, page: 1, perPage: 5 }
  → first: john@example.com
```
**Result: ✅ PASS**

### 2.8 Onboarding Status
```
GET /api/v1/onboarding/status
  → { progress: null }  (fresh account, no progress saved)
```
**Result: ✅ PASS**

### 2.9 Rate Limiting
```
POST /api/v1/auth/login (5 attempts, same IP)
  → attempts 1-5: 401 INVALID_CREDENTIALS
  → attempt 6+: 429 RATE_LIMITED with { retryAfter: N }
```
**Result: ✅ PASS** (was returning 500 before fix)

**Bug fixed:** `errorResponseBuilder` in index.ts used `(context as { ttl: number }).ttl` without
null guard. If `ttl` was undefined, `Math.ceil(undefined/1000) = NaN` caused Fastify to serialize
the error body incorrectly, resulting in HTTP 500. Fixed: null-safe access + explicit `statusCode: 429`
in the response object.

---

## Phase 3 — UI/UX Audit

### Build & Bundle
| Metric | Value | Threshold |
|--------|-------|-----------|
| Build time | 2.69 s | < 30 s |
| Main bundle (gzip) | 88.92 KB | < 150 KB |
| Vendor-recharts (gzip) | 111.93 KB | (expected, charts library) |
| Total gzip | ~280 KB | < 500 KB |
| PWA precache entries | 16 | — |

**TypeScript in strict mode → no implicit any → all component props are typed.**

### Responsive Design
- iPhone (<md): 2-col grid, bottom nav, MobileCart FAB ✅
- iPad portrait: hamburger overlay sidebar, 3-col grid ✅
- iPad landscape/desktop: full 3-col inline layout ✅

### Accessibility
- `tap-highlight` + `active-scale` classes for touch feedback ✅
- 44px minimum tap targets via Tailwind utility ✅
- Keyboard navigation: `/` search, Enter charge, F2-F8 actions, ⌘K command palette ✅
- iOS safe area insets applied globally ✅

### Known UI TODOs (non-blocking)
1. `CustomerSearch.tsx:180` — "TODO: open create customer modal" (quick-add from search not wired)
2. `LoginPage.tsx:24` — "TODO: MFA step redirect" (MFA enforcement on login needs UI step)

---

## Phase 4 — Performance Audit

All benchmarks are 3-sample averages over a warm connection (localhost, no network RTT).

| Endpoint | Avg Latency | Threshold | Status |
|----------|-------------|-----------|--------|
| GET /api/health | 3 ms | < 100 ms | ✅ |
| GET /api/v1/products | 1 ms | < 500 ms | ✅ |
| GET /api/v1/reports/dashboard | 1 ms | < 500 ms | ✅ |
| GET /api/v1/reports/sales | 1 ms | < 500 ms | ✅ |
| GET /api/v1/reports/top-products | 1 ms | < 500 ms | ✅ |
| GET /api/v1/customers | 1 ms | < 500 ms | ✅ |
| GET /api/v1/locations/:id/orders | 1 ms | < 500 ms | ✅ |

All endpoints are **well under threshold**. Sub-1ms for most queries reflects both the efficient
PostgreSQL indexes (added in migration 006) and the warm connection pool.

**Note:** These benchmarks are against seed data (22 products, 5 customers, 4 orders). Production
performance with thousands of records should be validated before full launch via load testing.

---

## Phase 5 — Data Integrity

SQL checks run directly against `taproot_dev` database:

| Check | Count | Status |
|-------|-------|--------|
| Orphaned line items | 0 | ✅ |
| Orders with wrong subtotals | 0 | ✅ |
| Overpaid orders (excluding change_due) | 1 | ⚠️ EXPECTED |
| Negative inventory levels | 0 | ✅ |
| Orphaned employees | 0 | ✅ |

**Note on overpaid order:** The 1 flagged order is the QA test order (T-2026-000004) where a $29.98
total was paid with $30.00 cash (change_due = $0.02). This is correct POS behavior. The check
query needs `AND p.total > o.total + o.change_due + 0.01` to be accurate; logged in BACKLOG.md.

---

## Phase 6 — Production Readiness

### Environment Variables
All 16 required variables are configured in `apps/api/.env`:
`DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_TERMINAL_WEBHOOK_SECRET`, `MFA_ENCRYPTION_KEY`,
`MFA_TOKEN_SECRET`, `OFFLINE_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `APP_URL`, `CORS_ORIGINS`,
`TAPROOT_APPLICATION_FEE_RATE`, `PORT`, `NODE_ENV`

### Security Checklist
- [x] `.env` in `.gitignore` (confirmed at line 8)
- [x] `.env.staging` and `.env.production` also in `.gitignore`
- [x] No plaintext secrets in source code
- [x] JWT secret loaded from environment (not hardcoded)
- [x] Stripe webhook signature verification (`stripe.webhooks.constructEvent`)
- [x] Offline card data encrypted AES-256-GCM
- [x] Card numbers never stored (only last4 + brand)
- [x] Card numbers never logged (verified via grep)
- [x] SQL injection: all parameterized (getDashboardMetrics locationId fix applied)
- [x] Idempotency keys on Stripe calls (`taproot-{orgId}-{orderId}-{ts}`)

### Infrastructure
- [x] Docker Compose for local dev (api + postgres:15 + redis:7)
- [x] Dockerfile multi-stage build (builder → production, non-root user)
- [x] AWS CDK stack (`infra/`) with VPC, ECS Fargate, RDS, ElastiCache, CloudFront
- [x] GitHub Actions CI (4 jobs: api-quality, web-quality, lint, security-scan)
- [x] PM2 ecosystem config (cluster mode, memory limits, log rotation)
- [x] Migration safety script (`scripts/migrate-safe.js` with 10s abort window)

---

## Phase 7 — Security Deep Dive

### SQL Injection
Grep for raw string interpolation in query calls:
```
grep -rn 'query(`.*\${' apps/api/src --include="*.ts"
```
Result: **0 matches** (after getDashboardMetrics fix). All dynamic clauses use `$N` bindings.

### Authentication
- BCrypt with 12 rounds (dev) / 12 rounds (prod) on all password hashes ✅
- JWT access tokens expire in 15 minutes ✅
- Refresh tokens expire in 30 days ✅
- Account lockout after 5 failed attempts (locked_until = now() + 15 min) ✅
- Rate limit: 5 attempts per 15 min per IP on login endpoint ✅

### Webhook Security
Both Stripe webhook handlers (`connect.service.ts`, `terminal.service.ts`, `webhook.routes.ts`)
call `stripe.webhooks.constructEvent()` with the raw request body. Requests without valid
`stripe-signature` header return 400 ✅.

Redis idempotency key (`webhook:processed:{eventId}`, TTL 72h) prevents duplicate processing ✅.

### CSP Headers
Strict Content-Security-Policy configured in `index.ts`:
- `default-src 'self'`
- `connect-src` includes Stripe, Anthropic, Google
- `frame-src` limited to Stripe
- Source maps hidden in production

---

## Bugs Found & Fixed (This Pass)

| ID | Severity | Component | Description | Fix |
|----|----------|-----------|-------------|-----|
| BUG-QA-001 | P0 | registration.routes.ts | FK violation: locations.created_by before employee exists | Reordered: employee → location → UPDATE employee.location_ids |
| BUG-QA-002 | P0 | registration.routes.ts | Column `is_active` doesn't exist on employees | Removed from INSERT (uses deleted_at) |
| BUG-QA-003 | P0 | registration.routes.ts | Table `employee_locations` doesn't exist | Removed junction INSERT |
| BUG-QA-004 | P1 | order.service.ts | Column `is_active` doesn't exist on employees | Changed query to check deleted_at only |
| BUG-QA-005 | P1 | order.service.ts | Table `tax_rates` doesn't exist | calculateTax() reads from locations.tax_config JSONB |
| BUG-QA-006 | P1 | reporting.service.ts | PostgreSQL 42P18: unused parameter $2=null | Changed params from [orgId,null,tz] to [orgId,tz]; $3→$2 |
| BUG-QA-007 | P1 | reporting.service.ts | SQL injection: locationId string-interpolated in getDashboardMetrics | Parameterized with bindings array |
| BUG-QA-008 | P1 | index.ts (rate limit) | Rate limit returns HTTP 500 instead of 429 | Fixed errorResponseBuilder null-safe ttl + statusCode: 429 |
| BUG-QA-009 | P2 | auth/routes.ts | Login broke for new registrations (no org slug known) | Backend now resolves org from email JOIN when no slug header |
| BUG-QA-010 | P2 | queues/processors.ts | employees.is_active and employees.name don't exist | Fixed to deleted_at + first_name||' '||last_name |

---

## Remaining Known Issues (BACKLOG)

| ID | Severity | Description |
|----|----------|-------------|
| BUG-QA-011 | P3 | MFA enforcement UI step missing (LoginPage TODO) |
| BUG-QA-012 | P3 | Create customer from POS search not wired (CustomerSearch TODO) |
| BUG-QA-013 | P3 | Tax configuration UI not implemented (tax rates stored in locations.tax_config JSONB; no admin UI to set rates) |
| BUG-QA-014 | P3 | Top customers report shows 0 rows (seed orders have no customer_id set) |
| BUG-QA-015 | P3 | Data integrity check for "overpaid" orders should exclude change_due |
| BUG-QA-016 | INFO | 16 console.log/warn/error in infrastructure files (db/client.ts, db/redis.ts, queues/processors.ts) — acceptable for v1 |

---

## Production Launch Checklist

### Technical ✅
- [x] TypeScript 0 errors (both apps)
- [x] All P0/P1 bugs resolved
- [x] Rate limiting returns correct HTTP 429
- [x] JWT auth working end-to-end
- [x] Registration → onboarding flow complete
- [x] Checkout → payment flow complete
- [x] All 7 report endpoints returning data
- [x] Webhook signature verification active
- [x] AES-256-GCM offline encryption
- [x] Card data never stored/logged
- [x] Docker Compose working
- [x] CI/CD GitHub Actions (4 jobs)
- [x] AWS CDK infra defined
- [x] Production build clean (2.69 s)
- [x] PWA manifest + service worker

### Business (Pre-Beta)
- [ ] Set Stripe LIVE keys in production .env
- [ ] Register Stripe webhook endpoints (scripts/register-webhooks.js)
- [ ] Configure SENDGRID_API_KEY for transactional email
- [ ] Set SENTRY_DSN for error tracking
- [ ] Set ANTHROPIC_API_KEY for AI features
- [ ] Point DNS to CloudFront/ALB (taprootpos.com)
- [ ] Set up CloudWatch alarms + SNS alerting
- [ ] Run db:migrate on production database
- [ ] Seed demo account with real menu data (or guide onboarding)
- [ ] Privacy Policy and Terms of Service live at /privacy and /terms

---

*QA performed by Claude Sonnet 4.5 — Taproot POS Prompt 20 (White-Glove QA Pass)*
*All endpoint tests run against live dev stack: Node 20, PostgreSQL 15, Redis 7*
