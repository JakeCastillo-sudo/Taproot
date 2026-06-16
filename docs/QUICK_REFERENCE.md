# Taproot POS — Quick Reference

> Fast lookup for active development. Schema ground-truth, API patterns,
> environment variables, migrations, file-ownership rules, and test commands.
> Current project state is in **CLAUDE.md**; build history in **docs/SESSION_HISTORY.md**.

---

## Key Schema Facts (Ground Truth — Do Not Guess)

### Products table
- `products.is_active boolean NOT NULL DEFAULT true`
- `products.day_parts varchar(50)[] DEFAULT NULL` — null/empty = visible all day; non-empty restricts to those meal periods (additive filter: `IS NULL OR = '{}' OR 'x' = ANY(day_parts)`)
- `products.product_type` CHECK: `standard|recipe|bundle|service|weight`
- `products.unit_of_measure` CHECK: `each|g|kg|ml|l|oz|lb|m|ft`

### Employees table
- **NO `is_active` column** — uses `deleted_at` for soft-delete
- **NO `employee_locations` junction table** — uses `location_ids uuid[]` array directly
- Roles CHECK: `owner|manager|cashier|kitchen|readonly`

### Other key facts
- `employees.name` column does NOT exist — use `first_name || ' ' || last_name`
- `locations.tax_config` JSONB: `{rates: [{name, rate, included}]}` — no `tax_rates` table
- `order_line_items` (not `order_items`), `product_prices` (not `prices`)
- `orders.order_type` CHECK: `in_store|takeout|delivery|table_service|online|phone` (NOT dine_in)
- `recipes` keyed by `product_id` (not variant_id), has `yield_factor`, `version`, `is_active`, `deleted_at`
- `recipe_lines`: `ingredient_product_id` + `ingredient_variant_id`
- `purchase_orders.status` CHECK: `draft|sent|confirmed|partially_received|received|cancelled`
- `inventory_levels` uses two partial unique indexes (variant_id NULL vs NOT NULL)
- Org plan CHECK: `trial|starter|growth|enterprise`

### Verified demo account
- Email: `demo@taproot.pos` | Password: `TaprootDemo2026!`
- Role: owner | 22 products | All product `day_parts` = NULL (always visible)

---

## Key Web Patterns

- `TOKEN_KEY`/`REFRESH_TOKEN_KEY`/`USER_KEY` in localStorage; token decoded for locationId
- `VITE_API_URL=""` → relative URL → Vite proxy → `http://localhost:3001`
- `usePOSStore.getState()` for imperative access outside React
- `useUIStore` for sidebar collapse + POS view mode + activeDayPart (none persisted except sidebarCollapsed)
- `apiFetch` options: `{ noRedirect: true }` for optional calls (e.g. TrialBanner billing check)
- `PUBLIC_PATHS` guard in apiFetch 401 handler — never hard-redirects from `/register` or `/login`
- Receipt state: `lastCompletedOrder` in pos.store — NOT persisted; navigate to `/receipt` on payment success
- Day-part filter: ADDITIVE — `null/empty day_parts` = always visible regardless of toggle

---

## Key API Patterns

### Products
- `GET /api/v1/products?dayPart=lunch` — additive filter; omit or `all` for no filter
- `PATCH /api/v1/products/:id` — accepts `{ dayParts: string[] | null }` to set meal periods
- `GET /api/v1/categories` — returns `{ categories: CategoryWithCount[] }` with `product_count`
- `GET /api/v1/orders/:orderId/receipt` — returns full `Receipt` (org name, location, line items, payments)

### Auth
- Login resolves org from email (no slug needed)
- `POST /api/v1/register` — returns `{ accessToken, refreshToken, employee, org, location, trialDays }`

---

## 🗄️ Migrations — Numbers & What They Do

Run on Railway: `npx node-pg-migrate up --migrations-dir migrations`

| # | Name | What it does | Status |
|---|---|---|---|
| 001 | initial_schema | 32-table base schema | applied |
| 002 | seed_data | seed/demo data | applied |
| 003–010 | (core) | auth/products/orders/inventory foundations | applied |
| 011 | day_parts | `products.day_parts varchar(50)[]` + GIN index | applied |
| 012 | product_archive | `archived_at`, `archive_reason`, `archived_by` + partial GIN | applied |
| 013 | org_settings | `organizations.settings JSONB` (dashboard layout etc.) | applied |
| 014 | employee_hourly_rate | `employees.hourly_rate` | applied |
| 015 | cash_drawer | `cash_drawer_sessions` + `cash_drops` | applied |
| 016 | reservations | reservations/waitlist tables | applied |
| 017 | franchise | `organizations.parent_org_id/org_type/franchise_code`, `products.corporate_source_id` | applied |
| 018 | api_keys | `api_keys` + `webhooks` (HMAC) | applied |
| 019 | allergens | `products.allergens/allergen_notes`, `customers.allergens` (FDA Big 9) | applied |
| 020 | performance_indexes | composite indexes on products/orders/line_items/customers/inventory | applied |
| 021 | time_clock | `time_clock_entries` + `schedules` | applied |
| 022 | admin_users | admin_users/sessions/impersonation_log + helpdesk tickets/messages | applied |
| 023 | (discarded) | orphan `023_email_campaigns.js` discarded; campaign dedup reconciled onto `email_logs` | n/a |
| 024 | employee_invites | `email_logs` + employee invite columns | **PENDING** (BLOCKS invites) |
| 025 | email_unsubscribe | `email_unsubscribes` table (CAN-SPAM) | **PENDING** (before campaigns) |

> Most code degrades gracefully (existence guards) until its migration runs.

---

## 🔐 Environment Variables

Source of truth: **docs/ENV_CHECKLIST.md** (corrects older templates).

**Auth / security:** `JWT_SECRET` (prod ≥64 chars), `ADMIN_JWT_SECRET`
(falls back to `${JWT_SECRET}_admin` but set explicitly in prod),
`MFA_TOKEN_SECRET`, `MFA_ENCRYPTION_KEY` (both required).
Note: `JWT_REFRESH_SECRET` does **not** exist.

**Payments:** `STRIPE_SECRET_KEY` (confirm `sk_live_` for real money),
`STRIPE_PUBLISHABLE_KEY` (needed for online card path / Connect).

**Email:** `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_SUPPORT`,
`ONBOARDING_EMAILS_ENABLED`, `CAMPAIGNS_ENABLED`.

**AI:** `ANTHROPIC_API_KEY` (optional — deterministic fallback without it),
`CLAUDE_MODEL` (default `claude-sonnet-4-6`).

**Text ordering (Twilio):** `TWILIO_*` (account SID / auth token / from number).

**Native apps:** `APP_STORE_LIVE`, `PLAY_STORE_LIVE` (flip store links live).

**Web build:** `VITE_API_URL` (`""` → relative URL → Vite proxy → localhost:3001).

---

## 📁 File Ownership / Conventions

- **One domain → one file** for services + routes (e.g. `franchise.service.ts` +
  `franchise.routes.ts`), registered in `index.ts`.
- **Parallel-session no-touch list** (admin/helpdesk work): `admin.routes.ts`,
  `admin.service.ts`, `helpdesk.service.ts`, `adminAuth.ts`, `migrations/022_*`,
  `docs/TECH_SPEC.md`.
- In parallel sessions, `index.ts` and `config.ts` are **append-only** (avoid conflicts).
- Admin auth is fully separate from org auth: separate JWT (`ADMIN_JWT_SECRET`),
  separate localStorage keys (`taproot_admin_token`/`taproot_admin_user`), and
  `/api/v1/admin/*` routes are exempt from the org-auth preHandler.
- Receipt state (`lastCompletedOrder` in pos.store) is **not persisted**.
- Print server runs on port **3333** (API is 3001).
- Document file ownership at the start of any parallel session.

---

## 🧪 Common Test Commands

```bash
# Health (db/redis/stripe liveness probe — uncached, ~pings 3 services)
curl https://taproot-production-3d63.up.railway.app/api/health
# → {"status":"ok","checks":{"database":"ok","redis":"ok","stripe":"ok"}}

# Demo login (org resolved from email — no slug)
curl -X POST https://taproot-production-3d63.up.railway.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@taproot.pos","password":"TaprootDemo2026!"}'

# Register (fields are businessName + businessType — NOT organizationName)
curl -X POST https://taproot-production-3d63.up.railway.app/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"...","businessName":"...","businessType":"..."}'

# Admin login (separate admin JWT)
curl -X POST https://taproot-production-3d63.up.railway.app/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@taproot-pos.com","password":"TaprootAdmin2026!"}'

# Authenticated GET (POST /products needs locationId in body)
curl https://taproot-production-3d63.up.railway.app/api/v1/products \
  -H "Authorization: Bearer $TOKEN"

# TypeScript must be 0 errors before any commit
cd apps/web && npx tsc --noEmit
cd apps/api && npx tsc --noEmit
```

---

## Demo Day Scenario (use for testing)
After completing Sprint 1:
1. Settings → Business → set tax rate to 8.875% (NYC rate)
2. Settings → Products → add "Seasonal Salad" at $16.99
3. Settings → Employees → add "Maria" with cashier role + PIN 2468
4. POS → select Maria → PIN → complete sale → verify Maria tracked in reports

---

## Security Constraints (Preserved)

- All Stripe keys from environment only
- Offline card data encrypted AES-256-GCM — never plaintext in Redis
- Webhook signature verification — reject unsigned with 400
- Idempotency keys on all Stripe API calls: `taproot-{orgId}-{orderId}-{timestamp}`
- Card numbers never logged, never in DB — only last4 + brand stored
- Migration wizard UI: "Your credentials are used only for this import and are never stored"
