# Taproot POS — Claude Project State

## 🚀 Live Deployment (Current)

| Service | URL |
|---|---|
| **Frontend** | https://taproot-pos.com (Vercel) |
| **Backend API** | https://taproot-production-3d63.up.railway.app |
| **Health check** | https://taproot-production-3d63.up.railway.app/api/health |

**Demo credentials:** `demo@taproot.pos` / `TaprootDemo2026!`

Auto-deploy: push to `main` → Railway (API) + Vercel (frontend) redeploy automatically.

---

## 🐛 Open Bugs — Fix These First

### P0 — Blocks core usage

| Bug ID | Symptom | File | Status |
|---|---|---|---|
| **BUG-PAY-001** | "Cannot read properties of undefined (reading 'length')" after clicking Charge | `PaymentSheet.tsx` — `buildReceiptSnapshot()`, `item.modifiers ?? []` and `items?.map(...) ?? []` safe fallbacks needed; also check `CartItem.modifiers` defaults in `pos.store.ts` | OPEN |

### P1 — Degrades experience

| Bug ID | Symptom | File | Status |
|---|---|---|---|
| **BUG-IMP-001** | CSV uploads OK but review screen shows empty item list | `importJob.service.ts` — CSV parsing path in `processImportJob` | OPEN |
| **BUG-IMP-002** | PDF menu import gives $0.00 for all prices | `documentParser.service.ts` — `parseMenu` prompt / cents extraction | OPEN |
| **BUG-IMP-003** | Import review screen overflows viewport; must zoom out to reach buttons | `ImportReview.tsx` — layout/height CSS | OPEN |
| **BUG-IMP-004** | Import workflow stops at review; confirm button doesn't push to POS | `ImportReview.tsx` + `importJob.service.ts` — confirm flow end-to-end | OPEN |

### P3 — Low priority (future)

| Bug ID | Symptom | Status |
|---|---|---|
| BUG-QA-011 | MFA enforcement UI step missing (LoginPage.tsx TODO) | OPEN |
| BUG-QA-012 | "+" in CustomerSearch doesn't open create modal | OPEN |
| BUG-QA-013 | No UI to set tax rate (tax_config JSONB exists but no settings page) | OPEN |
| BUG-QA-014 | Top customers report empty (seed orders have customer_id = NULL) | OPEN |

---

## 📋 Pending Migrations (Railway Console)

Migration 011 (`day_parts` column) was committed but **must be run manually on Railway**:
```bash
# In Railway service console:
npx node-pg-migrate up --migrations-dir migrations
```
Migrations 001–010 have already been applied on Railway.

---

## 🗺️ Next Prompts Queue (27–30)

### Prompt 27 — Fix P0/P1 bugs
Fix BUG-PAY-001 first (blocks all payments), then import bugs BUG-IMP-001 through 004.
- BUG-PAY-001: add `item.modifiers ?? []` and `items?.map(...) ?? []` in PaymentSheet.tsx
- BUG-IMP-003: fix ImportReview.tsx height/scroll so buttons are reachable without zoom
- BUG-IMP-004: verify confirm flow end-to-end; test with real CSV/PDF upload
- BUG-IMP-001/002: diagnose CSV parser path and PDF price extraction

### Prompt 28 — Settings page
- Location settings: name, address, phone, timezone, currency
- Tax configuration UI (reads/writes `locations.tax_config JSONB`)
- Printer configuration (receipt footer text, kitchen ticket options)
- `GET /api/v1/locations/:id` and `PATCH /api/v1/locations/:id` endpoints

### Prompt 29 — Employee management
- Employee list with roles and status
- Invite/create employee flow
- Role assignment (owner/manager/cashier/kitchen/readonly)
- PIN management for cashiers

### Prompt 30 — Product management UI
- Full product create/edit form (name, SKU, price, category, day parts)
- Variant management
- Bulk operations (price updates, category assignment)
- Integration with existing import flow

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

## Completed Prompts

### Prompt 01 — Project scaffold + SQLite backend ✅
React + Vite + Tailwind frontend; Express + better-sqlite3 backend.

### Prompt 02 — PostgreSQL schema + seed data ✅
32-table schema (001_initial_schema.js), seed data (002_seed_data.js), DB client, migration runner.

### Prompt 03 — Complete auth system ✅
JWT, bcrypt, TOTP, AES-256-GCM, RBAC (43 permissions, 5 roles), 12 auth routes.

### Prompt 04 — Product/variant/recipe/inventory data layer ✅
Services: product, variant, recipe, inventory, forecast, variance. 53 tests passing.

### Prompt 05 — Order and transaction engine ✅
Services: realtime (Redis pub/sub), loyalty, order, payment, purchaseOrder, receipt.
22 REST endpoints, WebSocket routes. 113 tests passing.

### Prompt 06 — Stripe Terminal + Connect ISV integration ✅
Stripe platform + merchant-scoped clients. Connect onboarding, Terminal flow, offline AES-256-GCM queue.
Bull queues (5 types). 155 tests passing.

### Prompt 07 — Customer management, gift cards, and reporting ✅
Customer CRUD/merge/credit. Gift cards. 7 reporting endpoints. 206 tests passing.

### Prompt 08 — React PWA checkout UI ✅
Full POS frontend. Zustand store (cart, undo, discounts). TanStack Query. Auth/refresh flow.
Product tiles, cart, PaymentSheet, ModifierSheet.

### Prompt 09 — Inventory Management UI ✅
StockLevels, ProductDetailSheet, StockCountSheet, ForecastDashboard, RecipesManager, VarianceReports.

### Prompt 10 — Reporting & Analytics Dashboard ✅
Recharts charts. NL query bar. 5-tab reports page (Dashboard/Sales/Products/Customers/Staff).

### Prompt 11 — AI Document Intelligence Pipeline ✅
Claude-powered PDF/image/CSV parsing. Import jobs queue. ImportPage + ImportReview + ImportHistory.
Model: `claude-sonnet-4-6` (configurable via `CLAUDE_MODEL`).

### Prompt 12 — Migration Wizard ✅
6 POS provider migrations (Square, Shopify, Toast, Lightspeed, Clover, CSV). 5-step wizard UI.

### Prompt 13 — Production Hardening ✅
CSP, HSTS, rate limiting, input validation, error handler, Prometheus metrics, pino serializers.

### Prompt 14 — Beta polish: bug fixes + demo enrichment ✅
22 products, 5 demo customers, 3 modifier groups, 3 completed orders. PWA install banner.

### Prompt 15 — PWA mobile optimization for iPad and iPhone ✅
vite-plugin-pwa, manifest, iOS CSS, useSwipeGesture, useHaptic, BottomSheet, MobileCart, CommandPalette.

### Prompt 16 — CI/CD pipeline: GitHub Actions + monitoring + code quality ✅
4-job CI workflow, deploy workflow, ESLint + Husky pre-commit, Prometheus metrics endpoint.

### Prompt 17 — AWS CDK production infrastructure + Docker ✅
VPC, ECS Fargate, RDS, ElastiCache, CloudFront, CDK stacks. Dockerfile + docker-compose.

### Prompt 18 — Beta: Subscription billing & registration ✅
Stripe subscriptions, trial management, billing portal. Registration flow with email availability check.
LandingPage, BillingPage, UpgradePage, PrivacyPage, TermsPage.

### Prompt 19 — Open for Business: Onboarding Wizard ✅
6-step onboarding wizard (Welcome → Menu Upload → Menu Review → Recipe Setup → Stripe Connect → Complete).
Partner codes (TAPROOT30, EARLYBIRD). Org-scoped onboarding persistence.

### Prompt 20 — White-Glove QA Pass ✅ 🎉 BETA READY
10 bugs found and fixed. All core flows verified end-to-end against live DB.

### Prompt 21 — Ghost Mode Deployment: Vercel + Railway ✅
Zero-cost live demo. Vercel frontend + Railway API + Railway PostgreSQL + Railway Redis.
Auto-deploy on push to main. `railway.json`, `nixpacks.toml`, `docs/RAILWAY_ENV.md`.

### Prompt 22 — Auth Bug Fixes ✅
- **BUG-AUTH-001** RESOLVED: Registration redirect — `apiFetch` PUBLIC_PATHS guard + JWT decode on RegisterPage mount
- **BUG-AUTH-002** RESOLVED: Demo login doom loop — TrialBanner `noRedirect:true`, onboarding store partialize fix, queryClient.clear() on login

### Prompt 23 — Import Review Edit Screen ✅
Inline-editable import review for menu PDFs. `confirmedItems[]` edit chain: UI → POST body → `confirmImportJob` → synthetic `ParsedMenu` → `applyMenuImport`. All items shown (not just preview 10). Zero-price warning dialog. Success screen with counts.

### Prompt 24 — Customer Receipt and Kitchen Ticket Printing ✅
`LastCompletedOrder` in pos.store (NOT persisted). PaymentSheet navigates to `/receipt` on success.
`ReceiptPage`: renders from store data instantly, enriches from `GET /orders/:id/receipt` in background.
`printReceipt()` uses `window.print()`. `printKitchenTicket()` opens thermal-style popup.
`@media print` CSS hides everything except `.receipt-content`.

### Prompt 25 — Collapsible Sidebar and Category Tile Navigation ✅
- `ui.store.ts`: `sidebarCollapsed` (persisted), `posViewMode`/`selectedCategory*` (NOT persisted — always 'categories' on load)
- `CategoryTileGrid.tsx`: large colorful tiles; "All Items" always first; product counts per category
- `categoryColors.ts`: deterministic hash → color from 10-color palette
- `POSLayout.tsx` rewrite: collapsible sidebar (`w-48`↔`w-14`, `transition-all`); category tile → item view with breadcrumb; search auto-switches to item view
- Backend: `GET /api/v1/categories` now includes `product_count` via LEFT JOIN

### Prompt 26 — Day-Part Toggle (Breakfast / Brunch / Lunch / Dinner) ✅
**Additive filtering**: products with no `day_parts` are ALWAYS visible.
- `migrations/011_day_parts.js`: `day_parts varchar(50)[]` + GIN index (⚠️ needs `npx node-pg-migrate up` on Railway)
- `DayPartToggle.tsx`: compact emoji pill toggle in POS search bar
- `ui.store.ts`: `activeDayPart` (NOT persisted — always 'all' on page load)
- `ProductDetailSheet.tsx`: "When to show on register" checkboxes (Inventory → product → edit)
- **Demo**: Inventory → Classic Burger → check Lunch+Dinner → POS Breakfast mode → burger disappears

---

## Security Constraints (Preserved)

- All Stripe keys from environment only
- Offline card data encrypted AES-256-GCM — never plaintext in Redis
- Webhook signature verification — reject unsigned with 400
- Idempotency keys on all Stripe API calls: `taproot-{orgId}-{orderId}-{timestamp}`
- Card numbers never logged, never in DB — only last4 + brand stored
- Migration wizard UI: "Your credentials are used only for this import and are never stored"
