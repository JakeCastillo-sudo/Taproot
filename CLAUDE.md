# Taproot POS — Claude Project State

> # 🚀 AUTONOMOUS BUILD COMPLETE — Sprints 1–5 done
> Built across sessions: **35/35 prompts** (S1-01…S5-07) over 5 sprints, tagged
> **v0.2.0** → **v0.6.0-beta-1.5**.
> - **Sprint 4 (Online Ordering & Engagement):** online checkout, settings, loyalty (auto-accrual),
>   gift cards, discount engine, customer mgmt. Verified live: 10% discount + 97 loyalty pts on $97.94.
> - **Sprint 5 (AI Intelligence):** `/insights` dashboard — demand forecast, staff scheduling, menu
>   engineering, food-cost (auto reorder draft), daily feed, enhanced copilot. Deterministic-first
>   (works without ANTHROPIC_API_KEY; aiUsed flag) — all 5 endpoints verified live with real numbers.
>   Fixed a latent nl-query 500 (total_amount/draft → total/parked).
> - BUG-QA-012 resolved. No new migrations in Sprints 4–5.
> - **Sprint 1 (Settings & Admin):** Products, Categories, Modifiers, Employees + PIN login,
>   Business + configurable tax, Payments, settings shell.
> - **Sprint 2 (Transactions):** Order History, Void/Refund, Tips, Cash Drawer, End-of-Day,
>   Split Check. **Found + fixed P0 BUG-ORD-001** (POS order-create contract mismatch).
> - **Sprint 3 (Table Service):** Floor Plan editor, Table-service POS mode, QR ordering
>   (public storefront — verified live), Kitchen Display, Reservations/Waitlist.
> - **Migrations needed on Railway** (code degrades gracefully until run; ALL features 500-safe):
>   `npx node-pg-migrate up --migrations-dir migrations` → **014_employee_hourly_rate,
>   015_cash_drawer, 016_reservations**.
> - **Bugs:** BUG-ORD-001 fixed (see BACKLOG); BUG-QA-013 resolved (tax UI). No new open P0/P1.
> - **Verified live:** product create+price, tax round-trip, full order create→pay(+tip)→void
>   lifecycle, employees/cash-drawer/reservations resilience, public QR menu (9 categories).
> - **Next for Jake:** review live site, run the 3 migrations, then Sprint 4 (Online Ordering).
> - TypeScript: 0 errors in apps/web + apps/api. All work committed + pushed to main.

> ⚠️ **MIGRATIONS NEEDED** (run in Railway console):
> `npx node-pg-migrate up --migrations-dir migrations`
> Pending: **014_employee_hourly_rate** (S1-05), **015_cash_drawer** (S2-04), **016_reservations** (S3-05).
> All three features are RESILIENT to their pending migration (column/table existence checks →
> graceful degradation, no 500s). Hourly-rate, cash drawer, and reservations are unavailable until run.
> Migrations 011/012/013 are CONFIRMED applied on Railway (verified live: product create with
> default variant + price, tax round-trip, and listProducts all succeed on the deployed API).

## 🚧 Sprint 4 — Beta 1.4: Online Ordering & Engagement (in progress)

### S4-01 — Online Checkout + Stripe ✅ COMPLETE
- `public.service.ts`: getPublicMenu now returns `online` block (enabled/pickup/delivery/fees/
  minOrder/prepMinutes + `paymentAvailable` = connected Stripe acct + STRIPE_PUBLISHABLE_KEY).
  createPublicOrder accepts fulfillmentType/address/requestedTime (stored in metadata+notes),
  honors `enabled`. New `createOnlinePaymentIntent` (Connect direct charge w/ application fee) +
  `confirmOnlinePayment` (verifies PI, records payment, completes order).
- `public.routes.ts`: POST `/public/:slug/payment-intent`, POST `/public/:slug/order/:id/confirm`
  (added to PUBLIC_ROUTES). 
- `api.ts`: `publicApi.paymentIntent/confirmPayment`, `online` on PublicMenu, `PublicOrderBody`.
- `PublicMenuPage`: pickup/delivery toggle + address, delivery fee + min-order, pay-at-counter
  (always) + "Pay now with card" (only when paymentAvailable). `OnlinePaymentSheet.tsx` (new) —
  Stripe Elements on the connected account.
- NOTE: card path requires Stripe Connect + STRIPE_PUBLISHABLE_KEY — UNTESTED on demo (no Connect);
  pay-at-counter is the verified path. @stripe/stripe-js + react-stripe-js already installed.

### S4-02 — Online Ordering Settings ✅ COMPLETE
- `settings.routes.ts`: GET/PATCH `/settings/online-ordering` (org settings.onlineOrdering:
  enabled/pickup/delivery/prepMinutes/radius/feeCents/minOrderCents). Public menu already reads it.
- `api.ts`: `settings.getOnlineOrdering/saveOnlineOrdering` + `OnlineOrderingConfig`.
- `OnlineOrderingSettingsPage.tsx` (new, `/settings/online-ordering`): toggles + prep/min/radius/fee.
  Online Ordering nav item.

### S4-03 — Loyalty Program ✅ COMPLETE
- `loyalty.service.ts`: was dead code reading a non-existent `loyalty_config` column —
  rewired to `organizations.settings.loyalty` (enabled/pointsPerDollar/redeemRate/minimumRedemption/
  tiers). Configurable tier thresholds.
- **Automatic accrual:** `payment.service.processPayment` awards points when an order is paid in
  full AND has a customer attached (non-fatal, never blocks payment).
- `settings.routes.ts`: GET/PATCH `/settings/loyalty`. `customer.routes.ts`: POST
  `/customers/:id/loyalty/adjust` (manual). `api.ts`: `settings.getLoyalty/saveLoyalty` + type.
- `LoyaltySettingsPage.tsx` (new, `/settings/loyalty`): earn/redeem rates + tier thresholds. Nav item.
- NOTE: redeem-at-checkout UI in PaymentSheet DEFERRED (POS payment flow is sacred); redeemPoints +
  manual adjust are available programmatically. Points/tier shown on the customer record (S4-06).

### S4-04 — Gift Cards ✅ COMPLETE
- Backend already complete (giftcard.service + /gift-cards routes; processPayment gift_card method
  validates + DEDUCTS balance + logs gift_card_transactions, refund restores). No backend change.
- `api.ts`: `giftCards.list/lookup/issue/reload/deactivate` + `GiftCardRow`.
- `GiftCardsSettingsPage.tsx` (new, `/settings/gift-cards`): issue (sell), list w/ balances, lookup
  by code, copy, deactivate. Nav item.
- `PaymentSheet`: gift_card method now shows a code-entry sub-flow and passes `giftCardCode` →
  real balance redemption at the POS.
- NOTE: selling a gift card as a cart line item deferred (issued via settings/admin instead);
  digital email delivery is a stub.

### S4-05 — Discount Code Engine ✅ COMPLETE
- `discount.service.ts` + `discount.routes.ts` (new, registered): list/create/update/delete +
  `validate` (active window/usage/min-order, computes savings, matches order.service value
  semantics: percentage=percent#, fixed=cents) + `report` (usage + total_saved from applied_discounts).
  Uses the existing `discounts` table (001).
- `api.ts`: `discounts.list/report/create/update/remove/validate` + types; `discountCodes` on
  OrderCreateBody + transform.
- `pos.store`: `appliedDiscount` {code, amount} + `setAppliedDiscount`; `discountTotal` now real
  (was placeholder 0); persisted + cleared on clearCart. tax computed on (subtotal − discount).
- `POSLayout`: "Add discount" prompts a code → validates → applies (toggles to "Remove"); cart
  preview + charged total both correct. PaymentSheet + SplitCheckModal send `discountCodes`.
- `DiscountsSettingsPage.tsx` (new, `/settings/discounts`): CRUD (%, fixed, BOGO, free item),
  min-order/usage-limit/active-until/stackable, redemption report column. Discounts nav item.
- NOTE: bogo/free_item preview shows base value (computed precisely server-side at order creation).

### S4-06 — Customer Management ✅ COMPLETE
- Backend already complete (customer.service + routes: list/search/create/get/patch/delete/orders/
  merge/credit + loyalty/adjust from S4-03). No backend change.
- `api.ts`: `customers.list/update/remove/orders/adjustLoyalty` (+ create tags/notes).
- `CustomersPage.tsx` (new, `/customers`): searchable list (name/contact/LTV/visits/points/tier/tags),
  CSV export, profile drawer (stats, recent orders, edit, ±points), create/edit modal. Customers nav item.
- `CustomerSearch.tsx`: **BUG-QA-012 resolved** — "Create new customer" now creates inline from the
  query (email/phone/name heuristic) and attaches to the cart.

## 🚧 Sprint 5 — Beta 1.5: AI Intelligence Layer (in progress)

Pattern: every feature computes deterministic numbers from SQL, then layers an optional Claude
narrative (`aiUsed` flag). `ai.service.ts` (new): `askClaudeJSON`/`askClaudeText` (graceful null on
no-key/parse/API failure, mirrors ai.routes pattern — `new Anthropic`, `config.CLAUDE_MODEL`) +
Redis `cacheGet/cacheSet`. All features degrade gracefully without ANTHROPIC_API_KEY.

### S5-01 — Demand Forecasting Engine ✅ COMPLETE
- `intelligence.service.ts` (new): `getDemandForecast` — 56-day history → day-of-week averaged
  7-day forecast (confidence by sample size) + Claude narrative; **cached 4h in Redis**.
- `intelligence.routes.ts` (new, registered): `GET /intelligence/forecast` (REPORTS_VIEW).
- `api.ts`: `intelligence.forecast` + `DemandForecast`. `InsightsPage.tsx` (new, `/insights`):
  tabbed AI dashboard, Forecast tab (narrative + bar chart + detail table). Insights nav item.

### S5-02 — AI Staff Scheduling ✅ COMPLETE
- `intelligence.service.getStaffingPlan`: forecast → recommended staff (sales/$900-per-shift),
  labor cost (avg `employees.hourly_rate` resilient → $15 fallback) + labor % with >30% alerts;
  Claude action narrative. `GET /intelligence/staffing`.
- `api.ts`: `intelligence.staffing` + `StaffingPlan`. InsightsPage Staffing tab (table + alerts).

### S5-03 — AI Menu Engineering ✅ COMPLETE
- `intelligence.service.getMenuEngineering`: 90-day per-product units + margin (price−cost), classified
  into Stars/Plowhorses/Puzzles/Dogs vs avg-units/avg-margin thresholds + per-class action + Claude
  narrative. `GET /intelligence/menu`.
- `api.ts`: `intelligence.menu` + `MenuEngineering`/`MenuClass`. InsightsPage Menu tab (4 quadrant cards).

### S5-04 — AI Food Cost Intelligence ✅ COMPLETE
- `intelligence.service.getFoodCostIntelligence`: overall food cost % (COGS from
  order_line_items.cost_price vs revenue, 30d), high-cost item list (flag >33%), auto **reorder
  draft** from inventory_levels ≤ reorder_point, + Claude action. `GET /intelligence/food-cost`.
- `api.ts`: `intelligence.foodCost` + `FoodCostIntelligence`. InsightsPage Food Cost tab
  (headline %, high-cost items, reorder draft).

### S5-05 — Daily Intelligence Feed ✅ COMPLETE
- `intelligence.service.getDailyFeed`: yesterday summary (sales/orders/avg/top item, tz day window) +
  aggregated alerts (food cost, reorder, labor, no-sales) + Claude morning briefing.
  `GET /intelligence/feed`; `POST /intelligence/feed/send` (SMS/email stub → logs).
- `api.ts`: `intelligence.feed/sendFeed` + `DailyFeed`. InsightsPage Daily Feed tab (default; briefing
  + yesterday cards + alerts, polls 5m, Send button).

### S5-06 — Enhanced AI Copilot ✅ COMPLETE
- `ai.routes.ts` nl-query: **fixed a latent bug** (queried non-existent `total_amount` / status
  `draft` → would 500). Now uses `total` / `parked`, adds top-products context, accepts conversation
  `history` (multi-turn), and returns `suggestedQuestions`.
- `api.ts`: `ai.nlQuery(query, locationId, history)` + `suggestedQuestions` on NLQueryResponse.
- InsightsPage Copilot tab: chat UI (history bubbles), suggested-question chips, data tables + bar
  charts from responses.

## 🚧 Sprint 6 — Beta 2.0: Scale & Infrastructure (in progress)

### S6-01 — Multi-Location ✅ COMPLETE
- `location.service.ts` (new): create/update/delete/list; createLocation grants access to
  owner/manager `location_ids`. Routes POST/PATCH/DELETE `/api/v1/locations` in settings.routes
  (GET already existed).
- `session.ts`: `getActiveLocationId`/`setActiveLocationId`; `getLocationId` now honors the switcher
  selection (localStorage `taproot_active_location`) → all client queries follow active location.
- `LocationSwitcher.tsx` (new) in POS sidebar (hidden when 1 location; reloads on switch).
- `LocationsSettingsPage.tsx` (new, `/settings/locations`): CRUD. `api.ts`: `locations.create/update/remove`.
- NOTE: cross-location report comparison lands in S6-05 (reporting suite). New-location WRITES may need
  a re-login so the JWT picks up the added location_id (reads work immediately).

### S6-02 — Offline Mode ✅ COMPLETE
- `offlineQueue.ts` (new): IndexedDB queue (enqueueOrder/getQueue/processQueue/pendingCount/
  clearSynced); replays create-order → process-payment on reconnect with real order numbers.
- `useOfflineSync.ts` (new): mirrors navigator.onLine → pos.store `isOffline`, auto-syncs on
  reconnect with toasts, polls pending count. Wired in POSLayout.
- POSLayout: red pulsing **offline banner**; existing SyncStatus shows queued count.
- PaymentSheet: when offline (cash/card) → enqueue + offline receipt snapshot (TEMP-xxxx), no API call.
- NOTE: queued card orders sync only where Stripe is configured; cash syncs everywhere.

### S6-03 — ESC/POS Printer Support ✅ COMPLETE
- `apps/print-server/` (new, standalone Node, no deps): ESC/POS bridge — `/health`,
  `/print/receipt`, `/print/kitchen`, `/drawer/open`; TCP:9100 to network printers or log mode.
  `docs/PRINT_SERVER.md` setup guide.
- `thermalPrint.ts` (new): detect server (configurable URL), `printReceiptThermal`/
  `printKitchenThermal`/`openCashDrawer`/`checkPrintServer`. ReceiptPage tries thermal → falls back to browser.
- `HardwareSettingsPage.tsx` (new, `/settings/hardware`): server status, URL, model, test print
  (+ barcode toggle for S6-04). Nav item.
- NOTE: print server runs on **3333** (prompt said 3001 = API port).

### S6-04 — Barcode Scanner Support ✅ COMPLETE
- Existing `useBarcode` (POS scan→add-to-cart) now gated on the Hardware scanner toggle.
- `useBarcodeScanner.ts` (new, generic, gates on `enabled` arg; default-on `getScannerEnabled`).
- ProductsSettingsPage modal: **Barcode field + "Scan to assign"** (arms a one-shot capture);
  `barcode` flows through product create/update.
- HardwareSettingsPage: scanner enable toggle (S6-03).
- NOTE: inventory scan→jump deferred — POS scan-lookup already covers finding products by barcode.

### S6-05 — Advanced Reporting Suite ✅ COMPLETE
- Report endpoints (sales/top-products/employee-perf/payment-methods/hourly-heatmap) + tabs
  (Dashboard/Sales/Products/Customers/Staff/Tips) already existed. Added:
  - **Heatmap tab** (`HeatmapTab.tsx`): 7×24 day×hour revenue grid, peak callout, CSV export.
  - **Cross-location filter** (S6-01 deliverable): "All Locations" + per-location dropdown in
    ReportsPage header → `apiParams.locationId` (omitted = org-wide).
- Menu engineering matrix lives in `/insights` (S5-03). CSV export present on Heatmap/EOD/Orders.

### S6-06 — QuickBooks Integration ✅ COMPLETE
- `integrations.routes.ts` (new, registered): `GET /integrations/export/:provider` (quickbooks|xero)
  → daily-sales CSV (Date/Description/Amount/Account/Tax) download (REPORTS_VIEW).
- `api.ts`: `integrations.exportCsv` (auth'd fetch → text). `IntegrationsSettingsPage.tsx` (new,
  `/settings/integrations`): date range + QuickBooks/Xero download + Mailchimp/Gusto/OpenTable/
  DoorDash "coming soon" stubs. Nav item.

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
| BUG-QA-012 | "+" in CustomerSearch doesn't open create modal | ✅ RESOLVED (S4-06) |
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

## 🚧 Sprint 3 — Beta 1.3: Table Service (in progress)

### S3-01 — Floor Plan Editor ✅ COMPLETE
- `table.service.ts` + `table.routes.ts` (new, registered): GET/POST/PATCH/DELETE `/tables`,
  PATCH `/tables/bulk-positions` (declared before `:id`). Uses existing `tables` table (001).
- `api.ts`: `tables.*` + `TableRow`/`TableInput`/`TableShape`.
- `FloorPlanEditorPage.tsx` (new, `/settings/floor-plan`): dotted 20px grid canvas, pointer-based
  drag-to-move (snap) + corner resize, select + properties panel (name/seats/section/shape),
  add/delete, undo/redo (20-deep, positions), deterministic section colors, Save → bulk-positions.
- `SettingsLayout`: Floor Plan nav item. `App.tsx`: `/settings/floor-plan` route.

### S3-02 — Table Service POS Mode ✅ COMPLETE
- `table.service.ts`: `getTableStatus` (tables + current open order via LATERAL join: itemCount,
  total, minutesOpen), `assignOrderToTable`. Routes `GET /tables/status`, `PATCH /orders/:id/table`.
- `api.ts`: `tables.status/assignOrder` + `TableStatus`; `tableId` on `OrderCreateBody` (orderType
  defaults to 'table_service' when a table is set); create transform passes tableId.
- `TableView.tsx` (new): read-only floor plan, green=available/amber=occupied, section tabs, polls
  10s. Tap available → `setTable` + switch to grid; tap occupied → toast order summary.
- `POSLayout`: Grid/Table toggle in top bar; renders TableView in table mode. PaymentSheet +
  SplitCheckModal send `tableId` (clearCart already resets it).
- NOTE: "Move table" reassignment UI deferred (endpoint exists). Occupied-table tap shows summary
  rather than loading the order into the cart (quick-service cart model).

### S3-03 — QR Code Ordering ✅ COMPLETE
- `public.service.ts` + `public.routes.ts` (new, NO auth — keys added to PUBLIC_ROUTES, registered
  before auth plugin): `GET /public/:slug/menu`, `POST /public/:slug/order`, `GET /public/:slug/order/:id/status`.
  Online orders attributed to a system employee (prefer owner), orderType 'online', fires realtime event.
- `settings.routes.ts`: GET /settings/business now returns `orgSlug`.
- `api.ts`: `publicApi.menu/createOrder/orderStatus` (uses `/public` base, no JWT); `orgSlug` on BusinessSettings.
- `PublicMenuPage.tsx` (new, routes `/order/:slug` + `/order/:slug/table/:tableId`, no auth): branded menu,
  cart, checkout (name/phone), place order (pay at counter), confirmation w/ order # + ETA.
- `QrCodesSettingsPage.tsx` (new, `/settings/qr-codes`): per-table + general-menu QR via
  api.qrserver.com (no dependency), PNG download, Print all. QR Codes nav item.
- `OnlineOrdersBell.tsx` (new) in POS top bar: polls history 15s, badges open online orders, toasts on new.
- NOTE deferred: Stripe "Pay Now" (pay-at-counter only), modifiers on public menu, PDF-all (print used).

### S3-04 — Kitchen Display System ✅ COMPLETE
- `kitchen.service.ts` + `kitchen.routes.ts` (new, registered): GET `/kitchen/tickets`,
  PATCH `/kitchen/items/:itemId/ready`, PATCH `/kitchen/orders/:orderId/bump`. Kitchen state stored
  in `orders.metadata.kitchen` ({ readyItems[], bumpedAt }) — NO migration. Bumped orders drop off.
- `api.ts`: `kitchen.tickets/itemReady/bump` + types.
- `KitchenDisplayPage.tsx` (new, `/kitchen`): dark full-screen, polls 5s, ticket cards w/ elapsed
  color (green<5/amber5-10/red>10 flashing), tap item → ready (strikethrough), BUMP (green when all
  ready), large-text mode. Kitchen nav item in POS sidebar.
- NOTE: stations deferred (no station config — all items station 'all').

### S3-05 — Reservations & Waitlist ✅ COMPLETE
- `migrations/016_reservations.js` ⚠️ NEEDS RAILWAY MIGRATION (prompt called it "014"; renumbered
  to 016 since 014/015 were used this sprint).
- `reservation.service.ts` (resilient) + `reservation.routes.ts` (registered): list/create/update/
  delete + `/:id/notify` (Twilio stub → logs when unconfigured) + `/:id/seat`.
- `api.ts`: `reservations.*` + types.
- `ReservationsPage.tsx` (new, `/reservations`): Waitlist | Reservations tabs (date picker for
  reservations), add modal, notify, seat (table prompt), remove. Reservations nav item in POS.

## ✅ Sprint 2 COMPLETE — Beta 1.2 (tag v0.3.0-beta-1.2)
Order History, Void/Refund, Tips, Cash Drawer, End-of-Day, Split Check. **Found + fixed
BUG-ORD-001** (P0): the POS order-create body shape didn't match the backend, so live cash/card
order creation 500'd — `orders.create` now translates items→lineItems + orderType. Live-verified:
full create→pay(+tip)→void lifecycle, all Sprint 2 endpoints 200, resilience fixes (employees,
cash-drawer) confirmed in prod. Migrations 014 + 015 still pending on Railway (code degrades
gracefully).

## 🚧 Sprint 2 — Beta 1.2: Transaction Management (detail)

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

### S2-04 — Cash Drawer Management ✅ COMPLETE
- `migrations/015_cash_drawer.js` ⚠️ NEEDS RAILWAY MIGRATION (cash_drawer_sessions + cash_drops,
  one-open-per-location partial unique index; money in integer cents/bigint).
- `cashDrawer.service.ts` (new, resilient to pending migration): open/drop/close/getCurrent/
  history. Expected = opening + cash sales − cash refunds − drops (computed from payments).
- `cashDrawer.routes.ts` (new, registered): /cash-drawer/current|history|open|drop|close.
- `api.ts`: `cashDrawer.*`. `CashDrawerWidget.tsx` (new) in POS cart panel — open/drop/close
  modals + live expected; close shows discrepancy.
- NOTE: no-sale button deferred.

### S2-05 — End of Day Report ✅ COMPLETE
- `reporting.service.ts`: `getEndOfDayReport(orgId, date, locationId?, tz)` — tz-aware day window;
  gross/refunds/net/orders/avg ticket, tax, tips, by-payment-method, top 5 items, by-employee,
  hourly breakdown, cash reconciliation (from that day's drawer session; resilient if 015 absent).
  Careful param indexing (location=$4, tz appended per-query) to avoid the $N-type-infer trap.
- `report.routes.ts`: `GET /reports/end-of-day?date=YYYY-MM-DD&location_id&timezone`.
- `api.ts`: `reports.getEndOfDay` + `EndOfDayReport`.
- `EndOfDayPage.tsx` (new, route `/reports/end-of-day`): date picker, summary cards, payment/hourly,
  top items, employees, cash reconciliation; Print (.receipt-content) / CSV / Email(stub).
- `ReportsPage`: prominent "End of Day" button.

### S2-06 — Split Check ✅ COMPLETE
- No backend change needed — the order model already accepts multiple payments (amount_paid
  accumulates). `SplitCheckModal.tsx` (new) creates the order once on first charge, then
  processes each split as a separate `payments.process` call (cash/card per split). On full
  settlement → receipt snapshot → /receipt.
- Modes: Split Evenly (2–8 ways, remainder spread to first shares) + Custom Amounts (must sum
  to total). "Split check" button added under Charge in the cart panel.
- NOTE: By-item split deferred (even + custom shipped).
- CAVEAT: card splits use the real payment API like the rest of the app — needs Stripe Connect
  in production; cash splits work everywhere.

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
