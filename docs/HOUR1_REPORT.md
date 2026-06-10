# Hour 1 — Security + Infrastructure Report
**Date:** 2026-06-10
**Time:** 16:11 PDT

> No code was modified this hour (per instructions). Deliverables are this report
> plus `ENV_CHECKLIST.md`, `MIGRATIONS_CHECK.sql`, `ADMIN_USER_CHECK.sql`.
> All findings below are from live curl tests against production + reading
> `apps/api/src/config.ts` and `index.ts`. Items marked **(Jake)** require manual
> action that the session cannot perform (Railway dashboard / DB SQL editor).

## Lookback checklist
| Check | Result |
|---|---|
| API health | ✅ `status: ok` — database ok, redis ok, stripe ok (v1.2.0) |
| git log | ✅ HEAD `ca8271c docs: environment variable checklist` |
| git status | ✅ clean working tree |
| apps/api tsc | ✅ 0 errors |
| apps/web tsc | ✅ 0 errors |

⚠️ **Doc gap:** the reading list referenced `docs/HANDOFF_2026-06-09.md`, which **does
not exist** (it was drafted in chat last session but never written to a file). Not a
blocker; this report + `CLAUDE.md` cover the same ground.

---

## Environment Variables
**Status:** Cannot read Railway's Variables tab from the session. Verified the
**definitive list from code** (`config.ts` + `index.ts`) in `docs/ENV_CHECKLIST.md`,
and confirmed the following are set + valid by live runtime behavior:

| Var | Evidence |
|---|---|
| DATABASE_URL | health → database: ok |
| REDIS_URL | health → redis: ok |
| STRIPE_SECRET_KEY | health → stripe: ok |
| JWT_SECRET | org + admin logins return tokens |
| MFA_TOKEN_SECRET, MFA_ENCRYPTION_KEY | app booted (these are required — boot crashes without them) |
| ANTHROPIC_API_KEY | helpdesk AI returns spec-grounded answers |
| NODE_ENV=production | live prod behavior on Railway |

**Template corrections found (documented in ENV_CHECKLIST.md):**
- `JWT_REFRESH_SECRET` — **does not exist** in this codebase; refresh tokens use `JWT_SECRET`.
- `MFA_TOKEN_SECRET` + `MFA_ENCRYPTION_KEY` — **actually required** (app crashes without
  them); were missing from the original template.
- `CORS_ORIGINS` — optional; prod domains hardcoded in `index.ts`.
- `ADMIN_JWT_SECRET` — admin portal does **not** break without it (falls back to
  `${JWT_SECRET}_admin`).

**Action needed (Jake):**
- Confirm `ADMIN_JWT_SECRET` is set **explicitly** and rotate it (leaked context).
- Confirm `JWT_SECRET` is ≥ 64 chars (prod requirement).
- Confirm `STRIPE_SECRET_KEY` is `sk_live_` before accepting real payments (currently
  unverified — health "stripe: ok" passes with test keys too).

## Migrations
- **Local files:** 22 (`001_initial_schema` … `022_admin_users`).
- **Applied:** **(Jake must verify)** via `docs/MIGRATIONS_CHECK.sql`. Strong indirect
  evidence that all 22 are applied: migration 022 created the admin/helpdesk schema, and
  the admin login + metrics + helpdesk endpoints all work against real tables.
- **Missing:** none known.
- **Action needed (Jake):** run `MIGRATIONS_CHECK.sql` in Railway → Database → Data; expect
  `COUNT(*) = 22`. If short, run `npx node-pg-migrate up --migrations-dir migrations` in the
  service Console tab.

## Admin User
- **Status:** ✅ exists. `admin@taproot-pos.com`, role `super_admin`.
- **Last login:** recent (login tested successfully this hour).
- **Account locked:** No (login succeeds → `locked_until` is null).
- **Password:** rotated off the seeded default. New password → HTTP 200; old
  `TaprootAdmin2026!` → HTTP 401 (correctly dead).
- **Action needed (Jake):** none required. Optional: run `ADMIN_USER_CHECK.sql` to confirm
  `failed_login_attempts = 0` / `locked_until = null`. Future password changes should use the
  portal **Account tab** (self-service `POST /api/v1/admin/auth/change-password`), not raw SQL.

## Redis
- **Status:** ✅ ok (health check).
- **Timing test:** cold ~2.50s, warm ~2.58s / ~2.58s — **no cache delta, as expected.**
  `/api/health` is an uncached liveness probe that actively pings DB + Redis + Stripe on
  every call, so it is **not** a representative cache benchmark; the ~2.5s is network + 3
  backing-service round-trips. Cache benefit would show on data endpoints, not health.
- **Action needed:** none.

## Demo Data
- **Products:** 50 returned on page 1 (≈84 total across categories); **0 at $0**, all 50
  sampled have prices (resolved via nested `prices[]`). No BUG-IMP-002 zero-price issue in
  demo data. *(Caveat: only page 1 sampled; pagination not exhaustively walked.)*
- **Categories:** 16, all populated (Food 11, Smoothies 10, Brunch Cocktails 8, Pastries 7,
  Mains 7, Toasts 6, Salads 6, Beverages 5, Breakfast Classics 5, Smoothie Bowls 4, etc.).
- **Action needed:** none.

## Admin Portal
- **Login API:** ✅ working (current password → token). Old seeded password correctly 401.
- **Metrics API:** ✅ working — 11 orgs total, 0 active, 11 trialing.
- **Helpdesk AI:** ✅ working — spec-grounded answer ("PINs are hashed with bcrypt (cost 10)…").
- **Action needed:** none. Note: any docs/scripts still citing `TaprootAdmin2026!` are stale —
  that credential is dead.

## Observations (not blockers)
- Subscriptions: **0 active / 11 trialing** — every org is in trial. Expected for demo/early
  state, but worth knowing before reading "revenue" metrics.
- Security follow-ups carried from last session: the admin password **and** the Postgres
  `DATABASE_PUBLIC_URL` were exposed in chat. Admin password already rotated; **(Jake)** rotate
  the Postgres password in Railway (cascades `DATABASE_URL` to the API automatically).

## Summary
- ✅ **Ready for Hour 2: YES**
- ❌ **P0 blockers: none** — API healthy, both apps typecheck, all portals verified live.
- ⚠️ **Jake must do manually:**
  1. Run the 3 SQL checks (`MIGRATIONS_CHECK.sql`, `ADMIN_USER_CHECK.sql`) to confirm
     migrations = 22 and admin user is healthy.
  2. In Railway Variables: set/rotate `ADMIN_JWT_SECRET` explicitly; confirm `JWT_SECRET` ≥ 64;
     confirm `STRIPE_SECRET_KEY` is `sk_live_` before real payments.
  3. Rotate the Postgres password (leaked in chat).
