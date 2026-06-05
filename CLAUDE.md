# Taproot POS — Claude Project State

> ⚠️ **MIGRATION NEEDED** (run in Railway console to enable hourly-rate storage):
> `npx node-pg-migrate up --migrations-dir migrations`
> Pending: **014_employee_hourly_rate** (S1-05) — adds `employees.hourly_rate`.
> Employee management is RESILIENT to this (employee.service detects the column and degrades
> to hourly_rate=null until migrated) — no 500s; only hourly-rate persistence is unavailable.
> Migrations 011/012/013 are CONFIRMED applied on Railway (verified live: product create with
> default variant + price, tax round-trip, and listProducts all succeed on the deployed API).

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
| **BUG-PAY-001** | "Cannot read properties of undefined (reading 'length')" after clicking Charge | `PaymentSheet.tsx` — `buildReceiptSnapshot()`, `item.modifiers ?? []` and `items?.map(...) ?? []` safe fallbacks needed; also check `CartItem.modifiers` defaults in `pos.store.ts` | ✅ RESOLVED (Prompt 27) |

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
| BUG-QA-013 | No UI to set tax rate (tax_config JSONB exists but no settings page) | ✅ RESOLVED (S1-04) |
| BUG-QA-014 | Top customers report empty (seed orders have customer_id = NULL) | OPEN |

---

## 📋 Pending Migrations (Railway Console)

Migrations 001–013 are applied on Railway (011/012/013 confirmed live during S1-08 verification).
**Pending: 014_employee_hourly_rate** — run when convenient:
```bash
# In Railway service console:
npx node-pg-migrate up --migrations-dir migrations
```
Code degrades gracefully until 014 runs (employee.service column-existence guard).

---

## 🗺️ Next Prompts Queue (27–30)

### Prompt 27 — Item modifier sheet ✅ COMPLETE
- **BUG-PAY-001 RESOLVED**: `(c.modifiers ?? []).map(...)` in both receipt snapshot builder and order create body in PaymentSheet.tsx
- Backend: `buildProductWithRelations` in `product.service.ts` now fetches modifier groups + options via single SQL query with `JSON_AGG`; new types `ModifierGroupData`, `ModifierOptionData`, `ProductWithModifiers`
- Frontend `api.ts`: `ProductWithModifiers` type; `products.list()` includes `modifierGroups` from API; `ProductListResponse` updated
- `ModifierSheet.tsx`: added `minSelections`, `maxSelections`, `sortOrder`, `isDefault` to types; pre-selects default modifiers; "Add to Order" label
- `POSLayout.tsx`: `handleProductTap` checks `modifierGroups.length > 0`; if yes → opens ModifierSheet; if no → fast path direct add; `handleProductLongPress` always opens sheet; cart display shows modifiers as indented sub-lines with price deltas
- **Demo**: Tap "Classic Burger" → modifier sheet opens; tap "Draft Beer" → adds instantly

### Prompt 28 — Archive/Seasonal Items ✅ COMPLETE
Three-state product model: Active / Archived / Deleted.
- **PRODUCT STATE RULE**: every POS query must filter `deleted_at IS NULL AND archived_at IS NULL`
- `migrations/012_product_archive.js`: `archived_at TIMESTAMPTZ`, `archive_reason VARCHAR(255)`, `archived_by UUID→employees` + partial GIN index
  ⚠️ Needs `npx node-pg-migrate up --migrations-dir migrations` on Railway
- `product.service.ts`: state rule comment, `archived_at IS NULL` added to `listProducts` + barcode search; new exports `archiveProduct`, `restoreProduct`, `listArchivedProducts`, `ArchivedProductRow`
- `inventory.routes.ts`: `GET /products/archived`, `POST /products/:id/archive`, `POST /products/:id/restore`
- `api.ts`: `products.archive()`, `products.restore()`, `products.listArchived()`, `ArchivedProductRow` type
- `InventoryPage.tsx`: 5th tab "Archived" (Archive icon)
- `ArchivedProducts.tsx` (new): archived items table with name/category/price/date/reason; Restore button; "Delete permanently" stub
- `StockLevels.tsx`: Archive icon per row → confirmation dialog with optional reason; removes row from list on success
- `ModifierSheet.tsx`: `onArchive?` prop + Archive icon in header (amber on hover)
- `POSLayout.tsx`: `handleArchiveFromPOS` → `window.confirm` → archive + invalidate queries + close sheet
- `docs/ARCHITECTURE.md` (new): canonical query pattern, state table, day-part rule, auth/cart patterns

**Demo**: Inventory → Stock Levels → Classic Burger → Archive icon → enter reason → POS no longer shows it → Inventory → Archived → Restore → back on POS

### Prompt 29 — Dashboard Layout Editor ✅ COMPLETE
Fixes BUG-NAV-001 (non-uniform tiles, no color/order control).

- `migrations/013_org_settings.js`: adds `settings JSONB` to organizations table
  ⚠️ Needs `npx node-pg-migrate up --migrations-dir migrations` on Railway
- `settings.routes.ts` (new): `GET /api/v1/settings/dashboard-layout` reads from
  `organizations.settings->'dashboardLayout'`; `PATCH` uses `jsonb_set` to store
- `index.ts`: registers `settingsRoutes`
- `api.ts`: `DashboardLayout`, `CategoryLayoutConfig`, `DEFAULT_DASHBOARD_LAYOUT`
  types; `settings.getDashboardLayout` / `saveDashboardLayout` API methods
- `layout.store.ts` (new): Zustand persist store; `fetchLayout()`, `saveLayout()`,
  `resetLayout()`; persists to `taproot-dashboard-layout` localStorage key
- `CategoryTileGrid.tsx` rewrite: **BUG-NAV-001 fixed** — all tiles now `aspect-square`
  (uniform size); reads `useLayoutStore`; applies color/icon/order/hidden/pinned from
  config; respects `gridColumns` (2/3/4); safe-default rule (null layout → original behavior)
- `DashboardEditorPage.tsx` (new): `/settings/dashboard` — live preview (left 55%) +
  sortable category list (right 45%); drag-to-reorder via `@dnd-kit/sortable` (touch
  + mouse); `ColorPicker` (10 presets + hex input); `IconPicker` (20 food emojis);
  pin/hide per category; grid columns selector; All Items tile toggle + color; Save / Reset
- `App.tsx`: `/settings/dashboard` route (RequireAuth)
- `POSLayout.tsx`: "Customize" nav item → `/settings/dashboard`
- Installed: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**Demo**: POS → sidebar Customize → change Classic Burger to red + 🍔 icon → drag Food to top → Save → POS tiles update immediately

### Prompt 30 — Beta 1.0 Bug Fixes ✅ COMPLETE
All P0 + P1 bugs resolved (commit 2dbace5):
- BUG-PAY-001: already fixed (Prompt 27), BACKLOG.md updated
- BUG-IMP-001: CSV full records stored in mappingConfig.parsed.records; GenericImportReview reads them
- BUG-IMP-002: normalizeMenuPrice() added — values < 100 multiplied × 100; prompt updated with examples
- BUG-IMP-003: ImportPage h-screen overflow-hidden + flex-1 min-h-0 card; GenericImportReview min-h-0
- BUG-IMP-004: case 'generic_csv': added to confirmImportJob switch; applyGenericCsvImport() implemented
- BUG-UX-001/002: InventoryPage h-screen overflow-hidden; <main> overflow-y-auto min-h-0
- BUG-NAV-001: already fixed (Prompt 29), BACKLOG.md updated

## ✅ Sprint 1 COMPLETE — Beta 1.1 (tag v0.2.0-beta-1.1)
All 8 prompts done (S1-01…S1-08). New `/settings` area: Products, Categories, Modifiers,
Employees (+ PIN login lock screen), Business (configurable tax — resolves BUG-QA-013),
Payments, plus the Dashboard editor. New backend: category/modifier/employee services + routes,
business/tax/receipt/payments settings endpoints, `/auth/pin-login`, `/api/v1/locations`.
Live-verified S1-08: product create (default variant+price), tax round-trip, all routes 401-gated,
employees/selectable 200. Only migration 014 (hourly_rate) pending; code degrades gracefully.

## 🚧 Sprint 2 — Beta 1.2: Transaction Management (in progress)

### S2-01 — Order History Screen ✅ COMPLETE
- `order.service.ts`: `listOrderHistory()` — org-wide enriched list (employee + customer name,
  payment methods via STRING_AGG, line-item count); `OrderHistoryFilter`/`OrderHistoryRow`.
- `order.routes.ts`: `GET /api/v1/orders` (ORDER_VIEW; cashiers restricted to own orders).
- `api.ts`: `orders.history()` + `OrderHistoryRow`.
- `OrderHistoryPage.tsx` (new, route `/orders`): date-preset/status/employee/payment/search
  filters, CSV export, table, right detail drawer (line items, payments, totals) via existing
  receipt endpoint; drawer body is `.receipt-content` so Print works.
- `App.tsx`: `/orders` → OrderHistoryPage (replaced placeholder). `POSLayout`: Orders nav item.
- NOTE: void/refund buttons added in S2-02.

### S2-02 — Void & Refund ✅ COMPLETE
- `transaction.service.ts` (new): `voidOrder` (works on completed orders — distributes full
  refund across payments via existing `PaymentSvc.refundPayment` (Stripe + gift-card aware),
  voids line items, sets status='voided'); `refundOrder` (full/partial/by-item; by-item sums
  selected line totals); `listOrderLineItems`.
- `order.routes.ts`: `POST /orders/:id/void` (ORDER_VOID), `POST /orders/:id/refund` (ORDER_REFUND),
  `GET /orders/:id/line-items`.
- `api.ts`: `orders.voidOrder/refund/lineItems`.
- `OrderActions.tsx` (new): Void modal (reason dropdown, "cannot be undone") + Refund modal
  (Full/Partial/By-item tabs, reason, live preview). Wired into OrderHistoryPage drawer.
- NOTE: manager-PIN override for cashiers DEFERRED — access gated by ORDER_VOID/ORDER_REFUND
  permissions instead (cashiers without them get 403).

### S2-03 — Tip Management ✅ COMPLETE
- `payment.service.ts`: `processPayment` now sets `orders.tip_total` and computes change_due /
  fullyPaid from `amount` ONLY (tips no longer counted as change). Fixed double-count bug.
- `PaymentSheet.tsx`: tip UI already existed; now sends `amount: total()` (excl tip) +
  `tipAmount` separately (was sending tip-inclusive amount → double count).
- `transaction.service.ts`: `adjustTip` (manager post-payment tip adjust on latest payment +
  recompute order tip_total/amount_paid). Route `POST /orders/:id/adjust-tip` (ORDER_REFUND).
- `reporting.service.ts`: `getTipsReport` (by day / employee / payment method + avg tip %).
  Route `GET /reports/tips`. `reports.getTips` + `TipsReportData` in api.ts.
- `TipsTab.tsx` (new) added to ReportsPage (6th tab "Tips": summary cards, by-day chart,
  by-employee + by-method tables).

## Sprint 1 Queue — Beta 1.1: Settings & Admin
See full roadmap at docs/ROADMAP.md

### Prompt 31 (S1-01) — Product Management UI ✅ COMPLETE
Full product create/edit/delete at /settings/products.
- `product.service.ts`: `createProduct` now also creates a "Default" variant + active
  `product_prices` row (price in cents) so new products are immediately sellable;
  `CreateProductData.price` + `UpdateProductData.price` added; updateProduct expires/
  re-inserts the default-variant price; createProduct now persists `day_parts`.
- `api.ts`: `products.create()`, `products.remove()`, `CreateProductBody`, `day_parts` on
  `ProductWithModifiers`.
- `session.ts` (new): shared `getLocationId`/`getStoredUser`/`getCurrentRole`/`canAccessSettings`.
- `SettingsLayout.tsx` (new): settings shell (sidebar + mobile tab bar + permission guard + Outlet).
- `ProductsSettingsPage.tsx` (new): search/category/status filters, table w/ stock status from
  inventory levels, create/edit modal (day-part chips, track-inventory/active toggles), archive/
  restore/delete actions.
- `App.tsx`: nested `/settings` → SettingsLayout with `/settings/products` child; index → products.

### Prompt 36 (S1-06) — Settings Shell + Navigation ✅ COMPLETE
/settings/categories — create/edit/delete, drag-to-reorder, color/icon picker, product count.
- `category.service.ts` (new): createCategory, updateCategory, deleteCategory (detaches products
  → category_id NULL, then soft-delete), reorderCategories.
- `inventory.routes.ts`: POST/PATCH/DELETE `/api/v1/categories` + PATCH `/categories/reorder`
  (declared before `:id`); GET /categories now also selects `c.icon`.
- `api.ts`: `categories.create/update/remove/reorder`, `CategoryInput`/`CategoryRow`, `icon` on
  `CategoryWithCount`.
- `CategoriesSettingsPage.tsx` (new): @dnd-kit sortable rows, color palette + hex + Auto, emoji
  icon picker + "use initials", product counts; reorder persists + invalidates layout store.
- `App.tsx`: `/settings/categories` route.

### Prompt 36 (S1-06) — Settings Shell + Navigation ✅ COMPLETE
/settings/modifiers — full CRUD groups + options + product assignment.
- `modifier.service.ts` (new): listModifierGroups (groups + modifiers[] + productIds via JSON_AGG),
  create/update/delete group (soft-delete cascades modifiers + clears assignments), add/update/
  delete modifier, setGroupProducts, setProductGroups.
- `modifier.routes.ts` (new, registered in index.ts): /modifier-groups CRUD, /:id/modifiers,
  /:id/products, /modifiers/:id, /products/:id/modifier-groups.
- `api.ts`: `modifiers.*` client + `ModifierGroupFull`/`ModifierItem`/`ModifierSelectionType`.
- `ModifiersSettingsPage.tsx` (new): accordion groups, inline add/edit/reorder(↑↓)/delete options,
  default toggle, price delta ($, negative ok), product-assignment checkboxes (pre-checked).
- `App.tsx`: `/settings/modifiers` route.
- NOTE: modifier reorder uses ↑/↓ buttons (persists sort_order) rather than drag.

### Prompt 36 (S1-06) — Settings Shell + Navigation ✅ COMPLETE
/settings/business — General | Tax | Receipt | Hours tabs. **Resolves BUG-QA-013.**
- TAX: server-side `calculateTax` already read `locations.tax_config` (BUG-QA-005); the 8.5%
  was only a frontend cart-preview estimate in `pos.store.ts`. Now configurable.
- `settings.routes.ts`: GET/PATCH `/settings/business` (org name + settings.businessProfile
  website/logo + location name/address/phone/timezone/currency), GET/PATCH `/settings/tax`
  (writes `tax_config.rates[{name,rate,included,appliesTo}]`), GET/PATCH `/settings/receipt`
  (locations.receipt_config). `resolveLocationId` helper picks the requested/first org location.
- `pos.store.ts`: module-level `setPosTaxRate`/`getPosTaxRate`; `taxTotal` now uses it on
  (subtotal − discount). Default still 8.5% until settings load.
- `POSLayout.tsx`: loads `/settings/tax`, calls `setPosTaxRate`, label shows live rate.
  `MobileCart.tsx` label uses `getPosTaxRate()`.
- `api.ts`: `settings.getBusiness/saveBusiness/getTax/saveTax/getReceipt/saveReceipt`,
  `auth.changePassword` (→ existing `POST /auth/password/change`).
- `BusinessSettingsPage.tsx` (new): General (org/location/address/tz/currency + change password),
  Tax (rate list + inclusive toggle + live preview + empty warning), Receipt (message/footer +
  show toggles), Hours (placeholder — note below).
- `App.tsx`: `/settings/business` route.
- NOTE: Hours tab is a placeholder; no business-hours backend yet (logged for a later prompt).

### Prompt 36 (S1-06) — Settings Shell + Navigation ✅ COMPLETE
/settings/employees — add/edit/deactivate, PIN, location assignment, hourly rate.
- `migrations/014_employee_hourly_rate.js` ⚠️ NEEDS RAILWAY MIGRATION.
- `employee.service.ts` (new): list/create/update/delete (soft, revokes tokens, blocks last
  owner + self-deactivate)/resetPin/listSelectableEmployees. New staff get a random unusable
  password_hash (PIN-only). PIN 4–6 digits, bcrypt-hashed.
- `employee.routes.ts` (new): /employees CRUD (owner/manager guard) + /:id/reset-pin +
  /employees/selectable (any authed session, minimal fields for lock screen).
- `auth/routes.ts`: new `POST /auth/pin-login` — device-session PIN switch (terminal already
  authenticated → select employee + PIN → fresh full session). Reuses completeLogin.
- `settings.routes.ts`: `GET /api/v1/locations` (org locations for pickers).
- `api.ts`: `employees.*`, `locations.list`, `auth.pinLogin`, types.
- `EmployeesSettingsPage.tsx` (new): list + add/edit modal (role, PIN show/hide, hourly rate,
  location chips), reset-PIN, deactivate.
- `EmployeeSelect.tsx` (new): full-screen lock screen — employee avatar grid → PIN pad
  (keyboard + touch), shake on wrong PIN, 3-attempt lock, "use password instead"; on success
  stores new tokens+user and reloads. Wired into POSLayout via "Switch user" + 5-min idle.
- `animations.css`: `animate-shake`.
- Transaction employee attribution is server-side via JWT (order.service uses user.sub).
- NOTE: order attribution already correct via JWT; pos.store loggedInEmployeeId not needed.

### Prompt 36 (S1-06) — Settings Shell + Navigation ✅ COMPLETE
Shell was built in S1-01 (`SettingsLayout.tsx`): desktop sidebar + mobile horizontal tab bar,
`canAccessSettings()` permission guard (cashier/kitchen/readonly → redirect to / with toast),
`/settings` index → `/settings/products`, `<Outlet/>` for nested pages. POSLayout Settings nav →
`/settings`. This prompt added the `/settings/payments` route + stub page so all 7 nav links
resolve (Products, Categories, Modifiers, Employees, Business, Payments, Dashboard).

### Prompt 37 (S1-07) — Payments Settings ✅ COMPLETE
/settings/payments — full page (replaced S1-06 stub).
- Reuses existing `GET /payments/connect/status`, `POST /payments/connect/account`,
  `POST /payments/connect/refresh-link`. Status 400s when no account → client catches → null
  → "Not connected".
- `settings.routes.ts`: GET/PATCH `/settings/payments` (org settings.paymentMethods; cash forced on).
- `api.ts`: `settings.getPayments/savePayments`, `stripeConnect.status/start/refreshLink`.
- `PaymentsSettingsPage.tsx`: Connect status card (masked account, payouts, manage link / connect
  button), payment-method toggles (cash locked on; card/wallets gated on Stripe), fee display.

### Prompt 37b — (was S1-07, now done above)

### Prompt 37 (S1-08) — Sprint 1 Integration Test + Deploy
Full walkthrough all settings screens, fix bugs, tag v0.2.0-beta-1.1.

## NEXT PROMPT
Prompt 36 (S1-06) — Settings Shell + Navigation

## IMPORTANT: Pending Railway Migrations
Migrations 011, 012, 013 committed but NOT yet run on Railway.
Run before any new code that depends on these columns:
  npx node-pg-migrate up --migrations-dir migrations

## Demo Day Scenario (use for testing)
After completing Sprint 1:
1. Settings → Business → set tax rate to 8.875% (NYC rate)
2. Settings → Products → add "Seasonal Salad" at $16.99
3. Settings → Employees → add "Maria" with cashier role + PIN 2468
4. POS → select Maria → PIN → complete sale → verify Maria tracked in reports

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
