# Taproot POS — Claude Project State

> 📚 Full history: docs/SESSION_HISTORY.md
> 🔍 Quick reference: docs/QUICK_REFERENCE.md
>
> This file is the lean, always-loaded project state. Every dated session/sprint
> report, bug-fix history, and audit log lives in **docs/SESSION_HISTORY.md**.
> All API/schema/env/migration/curl reference lives in **docs/QUICK_REFERENCE.md**.

---

## 🌿 Current State (v1.6.0 — last updated 2026-06-16)

Production certified and launch-ready. Sprints 1–11 + V1.0–V1.6 complete.
- **Web** https://taproot-pos.com (Vercel) · **API** Railway · tsc 0 errors both apps.
- Latest tags: `v1.6.0` (final state, 2026-06-13), `psr-2026-06-12` (security certified;
  OWASP Top 10 + PCI DSS 4.0, 0 crit / 0 high — `docs/SECURITY_AUDIT_2026.md`).
- Apps: web (`apps/web`), api (`apps/api`), mobile (`apps/mobile`, Expo/React Native),
  desktop (`apps/desktop`, Tauri v2 — `desktop-v1.0.0` draft release), print-server
  (`apps/print-server`).
- Latest feature: **CAN-SPAM unsubscribe** (HMAC tokens, compliant footers) — clears the
  "add unsubscribe before enabling campaigns" blocker. Full 2026-06-16 entry in SESSION_HISTORY.

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
- [ ] Change default admin password (`admin@taproot-pos.com`).
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
