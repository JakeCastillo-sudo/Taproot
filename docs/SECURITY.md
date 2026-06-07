# Taproot POS — Security Documentation

> Last verified: 2026-06-07 (Security Hardening pass — financial grade).
> This document describes controls **as implemented and verified in code**, not aspirations.

## Security Architecture

### Authentication (PCI DSS Req 8)
- JWT access tokens: **15 minutes** (`HS256` default, `RS256`-capable via key pair config;
  algorithm allowlist enforced on verify — `none` impossible)
- Refresh tokens: **30 days**, stored **SHA-256-hashed** in `refresh_tokens`
- **Refresh token rotation** on every use (old revoked + new issued in one transaction)
- **Token-reuse theft detection**: presenting a rotated-out token revokes **all** of that
  employee's sessions and raises a critical security alert
- **Concurrent session cap**: max 5 active sessions per employee — oldest revoked first
- Logout revokes the session's refresh token; `logout/all` revokes every session
- Passwords: **bcrypt cost 12** · PINs: **bcrypt cost 10** (4–6 digits)
- MFA: TOTP (otplib) with backup codes; MFA gate before token issuance
- Login enumeration resistance: identical error + dummy-hash timing delay for
  unknown org/email; lockout responses are indistinguishable from bad credentials
- `JWT_SECRET`: ≥64 chars enforced in production (config), ≥32 chars enforced
  everywhere at boot (`assertSecureConfig` — the server refuses to start otherwise)

### Account Lockout (PCI DSS Req 8.3.4)
- Lock after **5** failed password attempts (stricter than the PCI maximum of 10)
- Lockout duration: **30 minutes** (PCI minimum; enforced at boot in production)
- Counter resets on successful login; PIN pad has a separate 3-attempt UI lock
- `auth.account.locked` logged as **critical** + deduped security alert raised

### Authorization (PCI DSS Req 7 / OWASP A01)
- RBAC: Owner > Manager > Cashier > Kitchen > Read-only (43 permissions)
- `authenticate` precedes every non-public route (auth plugin scope); public routes
  are an explicit allowlist (`PUBLIC_ROUTES`)
- Manager/owner role gates on settings, employee management, schedules, API keys,
  webhooks, franchise operations; ORDER_VOID/ORDER_REFUND permissions gate money reversal
- Public API keys (`taproot_live_*`): scoped permissions only, role checks fail closed
- Multi-tenant isolation: org-scoped `WHERE organization_id = $orgId` on primary queries;
  see SEC-ORG-001 (BACKLOG) for the defense-in-depth follow-up on by-UUID child lookups

### Payment Security (PCI DSS Req 3 & 4)
- **Raw card data is never stored, never logged, never transits our servers** —
  Stripe Elements/Terminal tokenize client-side; we store only `last4`, brand, and
  Stripe intent IDs (verified by code grep this pass: zero PAN/CVV references)
- Stripe keys live in environment variables only — never in the database
- Offline order queue encrypts payloads with AES-256-GCM
- Webhook signatures verified (Stripe + outbound HMAC `X-Taproot-Signature`)
- Idempotency keys on all Stripe calls

### Transport Security (PCI DSS Req 4)
- TLS termination by Railway/Vercel; HTTP→HTTPS 301 redirect in production
- HSTS: 1 year, includeSubDomains, preload (production)
- CORS allowlist: prod domains hardcoded + env extras + Vercel previews; never `*`
- CSP on the API: `default-src 'self'`, `frame-src 'none'` (stricter than typical —
  this API serves JSON only), Stripe/Plausible/Anthropic origins allowlisted
- Extra headers on every response: `X-Frame-Options: DENY`, `nosniff`,
  `Permissions-Policy`, `X-Permitted-Cross-Domain-Policies: none`,
  `Referrer-Policy: strict-origin-when-cross-origin`; server fingerprint headers removed
- No secrets in URLs (verified by grep: no `req.query` password/token/secret reads)

### Input Validation (PCI DSS Req 6.2 / OWASP A03)
- Parameterized queries (pg) everywhere — primary SQL-injection defense
- Dynamic identifiers (ORDER BY) via allowlists (`sanitizeSortField`/`sanitizeSortOrder`)
- Global hooks (middleware/validation.ts): HTML/JS-URI/event-handler stripping on all
  JSON strings, 1 MB JSON body cap, UUID validation on `*Id` route params, X-Request-ID
- Zod schemas on auth routes (`auth/schemas.ts`) + shared validator catalog
  (`lib/security.ts`): email, password policy, PIN, money-in-cents bounds, slugs,
  date-range sanity, pagination caps
- Multipart uploads capped at 50 MB (menu PDFs)

### Audit Logging (PCI DSS Req 10)
- `audit_logs`: insert-only; org, actor, action, resource, before/after state, IP, UA
- Logged today: login success/failure/lockout, logout(+all), PIN login, MFA changes,
  password change/reset, payment processed, refunds, order void (with reason +
  before/after), product/category/customer/employee mutations, settings changes,
  token reuse, session-cap enforcement
- Severity taxonomy via `lib/audit.ts` (`info`/`warning`/`critical`); critical events
  mirrored to stderr immediately (Railway log capture)
- Retention: DB-backed; export before any pruning (PCI guidance: 12 months online,
  3 years retained)

### Rate Limiting (PCI DSS Req 8.3.4 / brute force)
- Global: 200/min/IP · Login: **5/15 min** · MFA: 3/5 min · PIN login: 10/15 min ·
  Refresh: 20/min · Password reset: 3/h · Registration: 5/h · AI: 30/h · Imports: 20/h
- Catalog in `lib/rateLimit.ts`; 429s emit a deduped `rate_limit_abuse` signal
- Payment routes intentionally rely on the global limiter + Stripe fraud controls —
  a low per-route cap could block a legitimate dinner rush (POS availability is a
  safety property too)

### Security Monitoring (PCI DSS Req 10.7)
- `raiseSecurityAlert()` — structured stderr + Redis dedupe (1/type/org/hour)
- Wired detectors: brute force (5 org-wide failures/5 min), account lockout,
  refresh-token reuse, rate-limit abuse
- Roadmapped detectors (need a worker/cron): unusual void patterns, large refunds
  (> $500), after-hours access — the void/refund audit events these need already exist

## PCI DSS 4.0 Posture

| Requirement | Status | Notes |
|-------------|--------|-------|
| 1 Network security | ✅ | Railway/Vercel managed edge |
| 2 Secure configuration | ✅ | Helmet, fail-secure boot assertions |
| 3 Protect stored data | ✅ | No card data stored — Stripe tokenization (SAQ-A posture) |
| 4 Encrypt transmission | ✅ | TLS + HSTS + HTTPS redirect |
| 5 Malware protection | ✅ | Managed platform |
| 6 Secure development | ✅ | Validation layers, parameterized SQL, audits |
| 7 Restrict access | ✅ | RBAC + org isolation (SEC-ORG-001 follow-up logged) |
| 8 Authenticate access | ✅ | Lockout 5/30min, bcrypt, MFA, rotation, session cap |
| 9 Physical security | N/A | Cloud-hosted |
| 10 Log & monitor | ✅ | Insert-only audit trail + alerting |
| 11 Test security | 🔄 | npm audit in place; schedule quarterly scans + annual pentest |
| 12 Security policy | ✅ | This document |

## Known Accepted Risks
- **DEP-AUDIT-001**: `tar` (high) via bcrypt's build chain and `uuid` via bull —
  build-time only, not reachable at runtime; remediation requires breaking major
  bumps (bcrypt 6 / bullmq), scheduled as a dedicated dependency sweep
- `esbuild`/`vite` moderates — dev-server only, not in production bundles
- JWT `iss`/`aud` claims not yet set (single-issuer/single-audience deployment;
  algorithm allowlist + secret strength cover the practical attack surface) — add
  when a second token consumer appears

## Vulnerability Response
1. Assess severity immediately; critical → take the affected surface offline
2. Critical fix within 24 hours; high within 72 hours
3. Notify affected customers within 72 hours of confirmed impact
4. Post-mortem within 1 week

Security contact: security@taproot-pos.com

## Recurring Security Tasks
- **Weekly**: failed-login report, `npm audit`
- **Monthly**: review audit logs for anomalies, review API keys/webhooks, access review
- **Quarterly**: dependency sweep, security review of new features, vuln scan
- **Annually**: penetration test, PCI SAQ-A self-assessment
