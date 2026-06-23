# Taproot POS — Claude Project State

> 📚 Full history: docs/SESSION_HISTORY.md
> 🔍 Quick reference: docs/QUICK_REFERENCE.md
>
> This file is the lean, always-loaded project state. Every dated session/sprint
> report, bug-fix history, and audit log lives in **docs/SESSION_HISTORY.md**.
> All API/schema/env/migration/curl reference lives in **docs/QUICK_REFERENCE.md**.

---

## 🌿 Current State (last updated 2026-06-22)

**`main` = v1.9.0, frozen, in production.** Restaurant POS, real-money-safe.
- **Web** https://taproot-pos.com (Vercel) · **API** Railway · tsc 0 errors both apps.
- Latest tags: `v1.9.0` (WG P0/P1 fixes + WG-024), `psr-2026-06-12` (security certified;
  OWASP Top 10 + PCI DSS 4.0, 0 crit / 0 high — `docs/SECURITY_AUDIT_2026.md`).
- Apps: web (`apps/web`), api (`apps/api`), mobile (`apps/mobile`, Expo/React Native),
  desktop (`apps/desktop`, Tauri v2 — `desktop-v1.0.0` draft release), print-server
  (`apps/print-server`).

**`v2` branch = the full studio platform — BUILT + REVIEWED, NOT deployed.**
Four floors, each studio-gated (restaurants byte-identical), `main` untouched:
v2.0 capability spine · v2.1 member + studio catalog + credits · v2.2 scheduling +
check-in + Mindbody/MT importers · v2.3 Counter Bridge (add-on fires to café KDS at
check-in). Per-floor design in `docs/V2_0_…`→`V2_3_SANDBOX_NOTES.md`; sequence in
`docs/ROADMAP.md`.

**Activation is PENDING (supervised).** Branch `activation/v2-prep` (off `v2`) holds the
boot-verified wiring: route registrations + a fixed `/reservations` route collision + the
payment `grantCredits` seam. **Deploy `activation/v2-prep`, not bare `v2`.** The exact
human-run sequence (migrations 032/033/034 → deploy → verify → activate → smoke → rollback)
is in **`docs/V2_ACTIVATION_RUNBOOK.md`**.

---

## ⚠️ Active Pending / Pre-Production Checklist

> 📋 **Full checklist (priority-ordered, with steps) lives in `docs/BACKLOG.md` → "🚀 Pre-Production Checklist".**
> Below is the at-a-glance summary. Last reviewed 2026-06-16 (migrations probed live).

**✅ Migrations — none pending.** 024_employee_invites, 025_email_unsubscribe, 026_delivery_orders,
027_quickbooks all **verified applied** against the live API on 2026-06-16. Migrations 001–023 already applied.

**✅ Done:** `RESEND_API_KEY`, `EMAIL_FROM`, `ONBOARDING_EMAILS_ENABLED=true`, `CAMPAIGNS_ENABLED=true`;
CAN-SPAM unsubscribe shipped; domain + CORS live.

**🔴 BLOCKING before first paying customer:**
- [ ] Confirm Stripe `STRIPE_SECRET_KEY=sk_live_` in Railway.
- [ ] Rotate Postgres password; set `ADMIN_JWT_SECRET` explicitly (`openssl rand -hex 32`).
- [ ] Set the first super-admin password via `INITIAL_ADMIN_PASSWORD` env var in Railway
  (hardcoded default removed — WG-024; admin email `admin@taproot-pos.com`).
- [ ] Run `docs/PSR_CLEANUP.sql` + `docs/HOUR5_CLEANUP.sql`; confirm no test data in prod.

**🟡 Within first week:** QuickBooks dev app (`QB_CLIENT_ID`/`QB_CLIENT_SECRET` + verify `APP_URL`);
delivery help doc; record Loom demo; first-customer outreach; remove demo data/credentials after first customers.

**🟢 When ready:** mobile (`EXPO_PUBLIC_STRIPE_KEY`, EAS project id, Apple $99 / Google Play $25,
`eas build`/`submit`); desktop (DMG/EXE install tests, code signing, `/download/*` redirects).

Full per-item detail also in **docs/SESSION_HISTORY.md** (v1.6.0 FINAL STATE + CAN-SPAM).

---

## 🚀 Live Deployment (Current)

| Service | URL |
|---|---|
| **Frontend** | https://taproot-pos.com (Vercel) |
| **Backend API** | https://taproot-production-3d63.up.railway.app |
| **Health check** | https://taproot-production-3d63.up.railway.app/api/health |

**Demo credentials:** `demo@taproot.pos` / `TaprootDemo2026!`

Auto-deploy: push to `main` → Railway (API) + Vercel (frontend) redeploy automatically.

---

## Session Guidelines

- Read CLAUDE.md + BACKLOG.md before every session
- Health check before writing any code
- TypeScript must be 0 errors before any commit
- Never commit on a broken API
- Admin password: never hardcode in prompts
- Order routes: always location-scoped
- Test data: always clean up after testing
- Parallel sessions: document file ownership to avoid conflicts

---

## Next Actions

The product is production certified.
The next action is not a build prompt.

1. Run pending operational items above (Stripe live key, ADMIN_JWT_SECRET,
   Postgres password rotation, `docs/HOUR5_CLEANUP.sql`)
2. Record 60-second demo video (Loom)
3. Walk into first restaurant with phone demo
4. Post to r/restaurantowners
5. Send first cold outreach email

The code is done.
Go get your first customer. 🌿

---

## Lookback Checklist (Run Before Every Session)

```bash
curl https://taproot-production-3d63.up.railway.app/api/health
# → {"status":"ok","checks":{"database":"ok","redis":"ok","stripe":"ok"}}

cd "/Users/jacobcastillo/Claude Space/Taproot"
git log --oneline -5

cd apps/web && npx tsc --noEmit   # → 0 errors
cd apps/api && npx tsc --noEmit   # → 0 errors
```

---

## Stack

- **Frontend**: React + Vite + Tailwind (`apps/web/`, port 5173)
- **Backend**: Fastify v4 + TypeScript strict (`apps/api/`, port 3001)
- **Database**: PostgreSQL via pg Pool (no ORM)
- **Auth**: JWT (HS256/RS256), bcrypt, TOTP (otplib), AES-256-GCM
- **State**: Zustand (pos.store, ui.store, onboarding.store) + TanStack Query v5
- **Testing**: Jest + ts-jest
- **Monorepo**: npm workspaces — apps/api, apps/web, packages/shared
- **Migrations**: node-pg-migrate (`migrations/` — 011 files, 001–010 applied on Railway)
- **AI**: `@anthropic-ai/sdk` — model `claude-sonnet-4-6` (configurable via `CLAUDE_MODEL` env)
- **Infra**: Vercel (frontend) + Railway (API + PostgreSQL + Redis)

---

## 🐛 Open Bugs — Fix These First

### P0 — Blocks core usage

| Bug ID | Symptom | File | Status |
|---|---|---|---|
| **BUG-PAY-001** | "Cannot read properties of undefined (reading 'length')" after clicking Charge | `PaymentSheet.tsx` — `buildReceiptSnapshot()`, `item.modifiers ?? []` and `items?.map(...) ?? []` safe fallbacks needed; also check `CartItem.modifiers` defaults in `pos.store.ts` | ✅ RESOLVED (Prompt 27) |

### P1 — Degrades experience

| Bug ID | Symptom | File | Status |
|---|---|---|---|
| **BUG-IMP-001** | CSV uploads OK but review screen shows empty item list | `importJob.service.ts` — CSV parsing path in `processImportJob` | ✅ RESOLVED (Prompt 30, 2026-06-07) |
| **BUG-IMP-002** | PDF menu import gives $0.00 for all prices | `documentParser.service.ts` — `parseMenu` prompt / cents extraction | ✅ RESOLVED (Prompt 30, 2026-06-07) |
| **BUG-IMP-003** | Import review screen overflows viewport; must zoom out to reach buttons | `ImportReview.tsx` — layout/height CSS | ✅ RESOLVED (Prompt 30, 2026-06-07) |
| **BUG-IMP-004** | Import workflow stops at review; confirm button doesn't push to POS | `ImportReview.tsx` + `importJob.service.ts` — confirm flow end-to-end | ✅ RESOLVED (Prompt 30, 2026-06-07) |

### P3 — Low priority (future)

| Bug ID | Symptom | Status |
|---|---|---|
| BUG-QA-011 | MFA enforcement UI step missing (LoginPage.tsx TODO) | OPEN |
| BUG-QA-012 | "+" in CustomerSearch doesn't open create modal | ✅ RESOLVED (S4-06) |
| BUG-QA-013 | No UI to set tax rate (tax_config JSONB exists but no settings page) | ✅ RESOLVED (S1-04) |
| BUG-QA-014 | Top customers report empty (seed orders have customer_id = NULL) | OPEN |

---

## 📂 Project Documents — Recall Map

> Read these when the task calls for it. Don't read all of them every session.

### Always available (loaded at session start)
- `CLAUDE.md` — active project state, open bugs, pre-prod checklist. You're reading it.
- `docs/QUICK_REFERENCE.md` — schema ground-truth, API patterns, env vars, migrations, test cmds.
- `docs/BACKLOG.md` — full pre-prod checklist + all open bugs (priority-ordered).
- `docs/SESSION_HISTORY.md` — full session archive. Read when asked "what happened in session X"
  or "why did we decide Y".

### Strategy / roadmap
- `docs/ROADMAP.md` — v2.x multi-vertical platform roadmap + sequencing. Read before any new
  feature work or platform-direction discussion.
- `docs/STUDIO_MODULE_SPEC.md` — detailed fitness/studio reservation + membership spec.
  Read when building any v2.x Studio feature.
- `docs/ROADMAP_v1_sprints.md` — historical v1 sprint plan (Sprints 1–11). Read for v1 context.
- `docs/LAUNCH.md` — go-to-market copy, pricing ($99/mo flat), and launch messaging.
  Read before marketing/outreach work.

### v2 studio platform (built on the `v2` branch — NOT deployed)
- `docs/V2_0_SANDBOX_NOTES.md` — capability spine (the `capabilities` JSONB gate, default-on).
- `docs/V2_1_SANDBOX_NOTES.md` — members, studio catalog, credit ledger (WG-006 atomic deduct).
- `docs/V2_2_SANDBOX_NOTES.md` — scheduling time-model (template vs session, eager materialization,
  deduct-at-book), check-in, Mindbody/MT importers. **Studio tables are namespaced** (`class_*`,
  `studio_*`) to avoid the restaurant `reservations`/`tables`/`scheduling` domains.
- `docs/V2_3_SANDBOX_NOTES.md` — Counter Bridge (add-on order parked at booking → fired to KDS at
  check-in via order.service public calls; cores untouched).
- `docs/V2_ACTIVATION_RUNBOOK.md` — **read before activating v2.** The supervised human sequence:
  migrations 032/033/034 → deploy `activation/v2-prep` → boot/restaurant-regression verify →
  activate studio on a throwaway org → e2e smoke → rollback. Notes the route-collision fix +
  payment seam that live ONLY on `activation/v2-prep`.

### Security & audit
- `docs/WHITE_GLOVE_AUDIT.md` — 9-layer comprehensive audit (2026-06-19). WG-001–016 P0/P1
  fixed; P2/P3 open. Read before any security/hardening/triage work or before acting on WG-IDs.
- `docs/SECURITY_AUDIT_2026.md` — formal OWASP Top 10 + PCI DSS 4.0 cert report (0 crit/high).
  Read when discussing security posture or compliance.
- `docs/SECURITY.md` — security controls as implemented + verified in code. Read before
  touching auth, encryption, or session handling.
- `docs/PSR_REPORT.md` — Production Security Review (2026-06-12). Companion to SECURITY_AUDIT.
- `docs/QA_REPORT.md` — white-glove QA pass (2026-06-02). Historical; use BACKLOG for open items.
- `docs/PRODUCTION_CERTIFICATION.md` — production readiness cert (2026-06-10). Historical record.

### Operations & infrastructure
- `docs/RUNBOOK.md` — ops runbook: incident response, rollback, monitoring, on-call.
  Read during any production incident or deploy issue.
- `docs/DEPLOYMENT.md` — full deployment guide: local dev, CI/CD, Railway/Vercel setup.
  Read when setting up infra or debugging deploys.
- `docs/ENV_CHECKLIST.md` — Railway env var checklist (derived from `config.ts`).
  Read before touching environment configuration.
- `docs/RAILWAY_ENV.md` — copy-paste Railway env var values (current known values).
  Read when provisioning a new Railway service.
- `docs/BACKUP.md` — backup strategy for multi-tenant Postgres. Read before DB maintenance.
- `docs/FULL_STACK_DIAGRAM.md` — codebase-derived full-stack architecture diagram (2026-06-09).

### Technical reference
- `docs/API.md` — API reference (endpoints, auth, request/response shapes).
  Read when building or debugging API integrations.
- `docs/TECH_SPEC.md` — complete technical specification (v1.5.0). Deep-reference for internals.
- `docs/ARCHITECTURE.md` — architecture decision records (product state machine, key patterns).
- `docs/PRINT_SERVER.md` — print server docs (ESC-POS / thermal printing). Read for print work.
- `docs/DESKTOP_CODE_SIGNING.md` — macOS code signing + notarization guide for Tauri desktop app.

### Onboarding & UX
- `docs/ONBOARDING.md` — new-customer onboarding guide (sign-up → first sale in ~10 min).
  Read when improving the onboarding flow.
- `docs/SESSION_GUIDELINES.md` — session-start protocol + auth verification rules.

### SQL scripts (run manually in Railway → Data tab — Claude has no DB write access)
- `docs/PSR_CLEANUP.sql` — remove PSR automated-test data. Run before go-live.
- `docs/HOUR5_CLEANUP.sql` — remove Hour-5 automated-test data. Run before go-live.
- `docs/REMOVE_DEMO_DATA.sql` — remove demo org/data permanently. Run when first customers arrive.
- `docs/ADMIN_USER_CHECK.sql` — verify admin user exists and is configured correctly.
- `docs/DEMO_DATA_FIX.sql` — patch demo-org data if corrupted.
- `docs/MIGRATIONS_CHECK.sql` — verify which migrations are applied against live DB.

### Historical one-off reports
- `docs/ACCOUNT_WORKFLOW_TEST.md` — 8/8 E2E account-creation test (2026-06-09, live prod).
- `docs/HOUR1_REPORT.md` — security + infrastructure hour-1 report (2026-06-10).
- `docs/HOUR3_REPORT.md` — DB + Redis + security hour-3 report (2026-06-10).

---

## 🔑 Critical Facts (full ground-truth in docs/QUICK_REFERENCE.md)

- **Money is integer CENTS** everywhere (DB + API); format with `fmtCurrency`.
- **No `employees.is_active`** — soft-delete via `deleted_at`; no `employee_locations` table
  (`location_ids uuid[]`); no `employees.name` (`first_name || ' ' || last_name`).
- Tables: `order_line_items` (not order_items), `product_prices` (not prices).
- `orders.order_type`: `in_store|takeout|delivery|table_service|online|phone` (NOT dine_in).
- Every POS product query filters `deleted_at IS NULL AND archived_at IS NULL`.
- Day-part filter is ADDITIVE — null/empty `day_parts` = always visible.
- AI model `claude-sonnet-4-6` via `config.CLAUDE_MODEL`; graceful deterministic fallback.
- Demo account: `demo@taproot.pos` / `TaprootDemo2026!` (owner).

→ See **docs/QUICK_REFERENCE.md** for full schema facts, API/web patterns, env vars,
the migration list, file-ownership rules, and test commands.
