# Taproot POS — Claude Project State

## Stack
- **Frontend**: React + Vite + Tailwind (client/, port 5173)
- **Backend**: Fastify v4 + TypeScript strict, port 3001
- **Database**: PostgreSQL via pg Pool (no ORM)
- **Auth**: JWT (HS256/RS256), bcrypt, TOTP (otplib), AES-256-GCM
- **GraphQL**: Apollo Server 5 + @as-integrations/fastify
- **Testing**: Jest + ts-jest
- **Monorepo**: npm workspaces — client, server, apps/api, packages/shared
- **Migrations**: node-pg-migrate (migrations/)

## Completed Prompts

### Prompt 01 — Project scaffold + SQLite backend ✅
- React + Vite + Tailwind frontend (5 pages: Register, Dashboard, Products, Orders, Settings)
- Express + better-sqlite3 backend (server/)
- Fixed: better-sqlite3 native compile on Node v26, duplicate fmt identifiers, missing Package icon import

### Prompt 02 — PostgreSQL schema + seed data ✅
- 32-table production schema: migration 001_initial_schema.js
- Seed data: migration 002_seed_data.js
- DB client: apps/api/src/db/client.ts (Pool, query, withTransaction)
- Migration runner: apps/api/src/db/migrate.ts
- Shared types: packages/shared/src/types/index.ts
- **Known issue**: 002 seed data uses columns/values that don't match schema (slug on locations, 'pro' plan — needs a fix migration)

### Prompt 03 — Complete auth system ✅
- Fastify server: apps/api/src/index.ts
- Config + validation: apps/api/src/config.ts
- Error hierarchy: apps/api/src/errors.ts
- Crypto utilities: apps/api/src/auth/crypto.ts (bcrypt 12r/10r, SHA-256, TOTP, AES-256-GCM)
- JWT service: apps/api/src/auth/jwt.ts (access 15m, refresh 30d, MFA 5m)
- RBAC: apps/api/src/auth/permissions.ts (43 permissions, 5 roles)
- Audit: apps/api/src/auth/audit.ts
- Schemas: apps/api/src/auth/schemas.ts (Zod)
- Middleware: apps/api/src/auth/middleware.ts
- Routes: apps/api/src/auth/routes.ts (12 routes)
- Plugin: apps/api/src/auth/index.ts
- Migrations: 003_password_reset_tokens.js, 004_mfa_backup_codes.js
- **Known issue**: PAT lacks Contents:write — pushes fail with 403

### Prompt 04 — Product/variant/recipe/inventory data layer ✅
- Errors extended: ProductNotFoundError, VariantNotFoundError, RecipeNotFoundError, RecipeValidationError, CircularRecipeError, InsufficientStockError, InventoryLevelError, PricingError, PurchaseOrderError
- Shared types: packages/shared/src/types/index.ts — fully aligned with DB schema
- Services:
  - apps/api/src/services/product.service.ts — CRUD, list/search, SKU gen, barcode lookup
  - apps/api/src/services/variant.service.ts — CRUD, setPrices, getActivePrice
  - apps/api/src/services/recipe.service.ts — createOrUpdateRecipe, depletion formula, circular detection, theoretical usage
  - apps/api/src/services/inventory.service.ts — depleteForOrder, adjustInventory, transferStock, receiveStock, recordStockCount, getInventoryLevel, listInventoryLevels, getMovementHistory
  - apps/api/src/services/forecast.service.ts — getBurnRate, getTimeToStockout, getForecastDashboard
  - apps/api/src/services/variance.service.ts — generateVarianceReport, finalizeVarianceReport, getVarianceReport, listVarianceReports
- REST routes: apps/api/src/routes/inventory.routes.ts (registered in index.ts)
- GraphQL SDL: apps/api/src/graphql/schema/inventory.graphql
- Tests: 53 passing (recipe, inventory, forecast, variance services)
- Config: jest.config.ts, tsconfig.test.json, "test" script added to package.json
- Typecheck: 0 errors (tests excluded from main tsconfig, compiled by ts-jest via tsconfig.test.json)

### Prompt 05 — Order and transaction engine ✅
- Dependencies added: ioredis, @fastify/websocket, stripe
- Shared types updated: OrderStatus, OrderType, PaymentMethod, PaymentStatus, DiscountType, LoyaltyTier, Payment, Discount, AppliedDiscount, GiftCard, LoyaltyTransaction, OrderEvent, OrderWithRelations
- New services:
  - apps/api/src/services/realtime.service.ts — Redis pub/sub (publishOrderEvent, subscribeToLocation, subscribeToKDS, buildEvent)
  - apps/api/src/services/loyalty.service.ts — awardPoints, redeemPoints, checkTierUpgrade, adjustPoints, getTierThresholds
  - apps/api/src/services/order.service.ts — createOrder, getOrder, listOrders, updateOrder, voidOrder, parkOrder, resumeOrder, splitOrder, mergeOrders
  - apps/api/src/services/payment.service.ts — processPayment (cash/card/gift_card/account_credit/offline), refundPayment, syncOfflinePayment
  - apps/api/src/services/purchaseOrder.service.ts — createPurchaseOrder, sendPurchaseOrder, confirmPurchaseOrder, cancelPurchaseOrder, receivePurchaseOrder, getPurchaseOrder, listPurchaseOrders
  - apps/api/src/services/receipt.service.ts — buildReceipt, formatReceiptText, sendReceiptEmail
- Infrastructure:
  - apps/api/src/db/redis.ts — ioredis singleton (publisher + subscriber must be separate)
  - CHANNELS: orders:{locationId}, kds:{locationId}, inventory:{locationId}, taproot:offline_payments
- REST routes: apps/api/src/routes/order.routes.ts (orders, payments, receipts, purchase orders — 22 endpoints)
- WebSocket routes: apps/api/src/routes/websocket.routes.ts (/api/v1/ws/locations/:locationId/orders, /kds)
- GraphQL SDL: apps/api/src/graphql/schema/orders.graphql
- Tests: 113 passing (recipe, inventory, forecast, variance, order, payment, loyalty services)
- Typecheck: 0 errors
- Key patterns:
  - Order number auto-generated by DB trigger (order_number='')
  - Stripe charges BEFORE DB transaction; dead-letter log if DB fails after charge
  - Discount engine: stackable/non-stackable sorted by priority; cap by maximum_discount_amount
  - `mockQuery.mockReset()` (not clearAllMocks) needed in tests to flush once-queues

## Key Schema Facts (do not guess — these are ground truth)
- Table names: `product_prices` (not prices), `order_line_items` (not order_items)
- `recipes`: keyed by `product_id` (not variant_id), has `yield_factor`, `version`, `is_active`, `deleted_at`
- `recipe_lines`: `ingredient_product_id` + `ingredient_variant_id` (not ingredient_id)
- `inventory_movements`: includes `quantity_before`, `quantity_after`, `reference_type`, `reference_id`
- `inventory_movements.movement_type` CHECK: `sale|return|waste|adjustment|transfer_in|transfer_out|po_receipt|opening_count|cycle_count`
- `products.product_type` CHECK: `standard|recipe|bundle|service|weight`
- `products.unit_of_measure` CHECK: `each|g|kg|ml|l|oz|lb|m|ft`
- `purchase_orders.status` CHECK: `draft|sent|confirmed|partially_received|received|cancelled`
- Employee roles CHECK: `owner|manager|cashier|kitchen|readonly`
- Org plan CHECK: `trial|starter|growth|enterprise`
- `inventory_levels` uses two partial unique indexes (variant_id NULL vs NOT NULL)

### Prompt 06 — Stripe Terminal + Connect ISV integration ✅
- Migration 005: organizations.stripe_connect_account_id/status/enabled_at, payment_processing_enabled; terminal_readers table (id, org, location, stripe_reader_id, label, model, status, last_seen_at, metadata jsonb)
- Payments layer:
  - apps/api/src/payments/stripe.config.ts — platform + merchant-scoped Stripe client factory (cached singletons)
  - apps/api/src/payments/connect.service.ts — createConnectAccount, getConnectAccountStatus, refreshOnboardingLink, handleConnectWebhook (account.updated, deauthorized, capability.updated)
  - apps/api/src/payments/terminal.service.ts — registerReader, listReaders, createPaymentIntent, collectPayment, capturePaymentIntent, cancelPaymentIntent, createConnectionToken, handleTerminalWebhook, simulatePayment
  - apps/api/src/payments/offline.service.ts — AES-256-GCM encrypted offline queue (Redis key offline:payments:{orgId}:{paymentId}, TTL 24h, dead-letter after 3 retries, idempotency keys taproot-{orgId}-{orderId}-{ts})
- Queue infrastructure:
  - apps/api/src/queues/index.ts — 5 typed Bull queues (offlinePayment, receipt, lowStockAlert, email, aiAnalysis), graceful shutdown, health check
  - apps/api/src/queues/processors.ts — concurrency 5, registered processors for all 5 queues
- Routes (replaced connect.routes.ts + terminal.routes.ts):
  - apps/api/src/routes/payment.routes.ts — 14 endpoints (Connect onboard, Terminal readers/flow, offline queue)
  - apps/api/src/routes/webhook.routes.ts — unified Stripe webhook handler; addContentTypeParser for raw body; Redis idempotency (webhook:processed:{eventId} TTL 72h)
- email.ts: added sendEmail() export for queue processors
- Tests: 155 passing — 42 new (stripe.test, offline.test, connect.test); typecheck: 0 errors
- Security: AES-256-GCM offline encryption, webhook signature verification, card numbers never stored (only last4+brand), application fee 0.3% of GPV

### Prompt 07 — Customer management, gift cards, and reporting ✅
- Migration 006: pg_trgm extension + GIN indexes on customers (name/email/phone trgm), composite reporting indexes on orders/order_line_items/payments
- New services:
  - apps/api/src/services/customer.service.ts — createCustomer, updateCustomer, deleteCustomer (soft), getCustomer, listCustomers (paginated + search), searchCustomers (ILIKE, min 2 chars), mergeCustomers (transfers orders + loyalty_transactions, absorbs points/credit/spend), getCustomerOrderHistory, addAccountCredit, deductAccountCredit
  - apps/api/src/services/giftcard.service.ts — issueGiftCard (unique code gen with retry), getGiftCard (by code, case-insensitive), getGiftCardById, reloadGiftCard, deactivateGiftCard, getGiftCardTransactions, listGiftCards (paginated)
  - apps/api/src/services/reporting.service.ts — getSalesSummary (day/week/month/year granularity + timezone), getTopProducts, getTopCustomers, getPaymentMethodBreakdown (with % calc), getEmployeePerformance, getHourlyHeatmap (7×24), getDashboardMetrics (single aggregate query + top product)
- New routes:
  - apps/api/src/routes/customer.routes.ts — 16 endpoints (9 customer CRUD/merge/credit + 7 gift card)
  - apps/api/src/routes/report.routes.ts — 7 GET endpoints, all require REPORTS_VIEW
- Permissions updated: CUSTOMER_DELETE, REPORTS_VIEW added; manager excludes CUSTOMER_DELETE; cashier/readonly gain REPORTS_VIEW
- Shared types: GiftCardTransaction, CustomerWithStats, ReportGranularity, SalesSummaryRow, TopProductRow, TopCustomerRow, PaymentMethodRow, EmployeePerformanceRow, HourlyHeatmapRow, DashboardMetrics; TerminalReader fixed to migration 005 schema
- Tests: 206 passing — 51 new (customer.service.test, giftcard.service.test, reporting.service.test); typecheck: 0 errors
- index.ts: registered customerRoutes + reportRoutes

### Prompt 08 — React PWA checkout UI ✅
- Converted apps/web from JSX to TypeScript (tsconfig.json, vite-env.d.ts, TS 6 with ignoreDeprecations)
- Packages added: @tanstack/react-query@5, zustand@5, immer, react-hot-toast, clsx, tailwind-merge, @types/react, @types/react-dom, typescript
- Design system: apps/web/src/styles/design-system.css — CSS variables (colors, typography, spacing, radii, shadows, transitions), global resets, animations
- Tailwind extended: Taproot primary/accent/danger/surface color tokens, Inter font, shadow/radius/tap-target utilities
- API client: apps/web/src/lib/api.ts — typed fetch wrapper, JWT auto-attach + auto-refresh (deduplicated), retry-once on network error, all API endpoints typed
- Query client: apps/web/src/lib/queryClient.ts — staleTime 30s, retry 1, no refetch on window focus, typed QK constants
- POS store: apps/web/src/store/pos.store.ts — Zustand + immer + sessionStorage persist; cart CRUD, undo stack, customer/table/notes/discount state, computed subtotal/tax/total/itemCount
- Toast: apps/web/src/components/ui/Toast.tsx — react-hot-toast wrapper with Taproot-styled success/error/warning/info/loading helpers
- SyncStatus: apps/web/src/components/ui/SyncStatus.tsx — online/offline indicator with pending count
- useBarcode: apps/web/src/hooks/useBarcode.ts — 8+ chars in <100ms = barcode scan, calls API, adds to cart
- useKeyboardShortcuts: apps/web/src/hooks/useKeyboardShortcuts.tsx — / search, Enter charge, F2-F8 actions, Ctrl+Z undo, Ctrl+D clear, ? help overlay; ShortcutsOverlay component included
- CustomerSearch: apps/web/src/components/pos/CustomerSearch.tsx — debounced 300ms search, loyalty tier badges, account credit display, keyboard navigation
- ModifierSheet: apps/web/src/components/pos/ModifierSheet.tsx — bottom sheet, single/multi/required groups, live price preview, quantity stepper
- PaymentSheet: apps/web/src/components/pos/PaymentSheet.tsx — 4-step flow: tip selection (presets + custom) → method (cash/card/gift_card/account_credit/split) → processing → success/error; cash keypad with change calc
- POSLayout: apps/web/src/components/layout/POSLayout.tsx — 3-column desktop layout (240px nav | flex product grid | 380px order panel); mobile single-column + floating cart button + bottom sheet; product tiles with long-press modifier support; cart with quantity steppers; CHARGE button
- LoginPage: apps/web/src/pages/LoginPage.tsx — clean login form, show/hide password, demo credentials prefill
- App.tsx: routes /login → LoginPage, / → POSLayout (auth guarded), /inventory → InventoryPage, /orders /reports /settings → PlaceholderPage; QueryClientProvider + ErrorBoundary + ToastContainer
- main.tsx: replaced main.jsx, imports design-system.css
- Typecheck: 0 errors. Vite build: 1580 modules, 295kb bundle, clean.

### Prompt 09 — Inventory Management UI ✅
- API extensions in apps/web/src/lib/api.ts:
  - inventoryApi — levels (paginated, search, low-stock filter), movements, adjust, stockCount, forecast
  - recipesApi — get, save
  - varianceApi — list, get, generate, finalize
  - purchaseOrdersApi — list, get, create (stub, PO routes not yet wired)
- QK constants extended: inventoryMovements, forecast, recipe, varianceReports, varianceReport
- New components (apps/web/src/components/inventory/):
  - StockLevels.tsx — sortable paginated table, search, low-stock filter, row-click → ProductDetailSheet
  - ProductDetailSheet.tsx — slide-in panel with stock cards, quick-adjust form, movement history
  - StockCountSheet.tsx — full-screen cycle count with diff preview, opening count toggle
  - ForecastDashboard.tsx — urgency summary cards + sortable stockout table, window selector (24h–7d)
  - RecipesManager.tsx — product grid with recipe status badges, opens RecipeEditor
  - RecipeEditor.tsx — ingredient line editor (product select + qty + unit + waste factor), save/update
  - VarianceReports.tsx — list with generate form (date range + flag threshold), opens detail
  - VarianceReportDetail.tsx — flagged/normal line split, finalize button
- InventoryPage.tsx — 4-tab layout (Stock | Forecast | Recipes | Variance), Stock Count shortcut button, back-to-POS nav
- App.tsx updated: /inventory → InventoryPage
- POSLayout.tsx updated: Inventory nav link in sidebar using useNavigate
- Typecheck: 0 errors. Vite build: 1589 modules, 353kb bundle, clean.

### Prompt 10 — Reporting & Analytics Dashboard ✅
- Inventory bug fixes:
  - inventory.service.ts: listInventoryLevels now JOINs product_variants + categories → returns variant_name, category_name, unit_of_measure, cost_price
  - StockLevels.tsx: groups variant rows by product_id client-side (sums qty), shows one row per product with variant count badge
- Packages installed: recharts@3.8.1 (date-fns was already present at 2.30.0)
- Shared utilities:
  - apps/web/src/lib/dateRanges.ts — preset date ranges (Today/Yesterday/Last7/Last30/ThisMonth/LastMonth/Custom), toApiParams, fmtCurrency, fmtShortCurrency, fmtPct, fmtDate
- API extensions in apps/web/src/lib/api.ts:
  - reports.getDashboardMetrics / getSalesSummary / getTopProducts / getTopCustomers / getPaymentBreakdown / getEmployeePerformance / getHourlyHeatmap
  - ai.nlQuery (graceful stub — route not yet implemented on backend)
  - Re-exported shared types: DashboardMetrics, SalesSummaryRow, TopProductRow, TopCustomerRow, etc.
- QK constants extended: reportDashboard, reportSales, reportTopProducts, reportTopCustomers, reportPayments, reportEmployees, reportHeatmap
- Chart components (apps/web/src/components/charts/):
  - RevenueLineChart.tsx — Recharts LineChart with responsive container, empty state
  - SalesBarChart.tsx — Recharts BarChart, stacked or grouped
  - DonutChart.tsx — Recharts PieChart with inner donut
  - HeatmapChart.tsx — custom SVG 7×24 heatmap with lerp color scale, hover tooltip
  - SparklineChart.tsx — tiny inline SVG sparkline with area fill
- Report tab components (apps/web/src/components/reports/):
  - NLQueryBar.tsx — animated placeholder rotation, AI query, history chips, data table + chart
  - DashboardTab.tsx — 4 KPI cards with sparklines + change %, revenue line chart, product donut, heatmap, top-5 table
  - SalesTab.tsx — bar chart (revenue/orders/AOV toggle), granularity selector, stats row, payment method donut + table
  - ProductsTab.tsx — ABC analysis, top/bottom/all toggle, sortable table, CSV export
  - CustomersTab.tsx — metric cards, loyalty tier donut, top customers sortable table
  - StaffTab.tsx — role-gated (owner/manager see all; cashier sees own row), comparison bar chart, performance table
- ReportsPage.tsx — 5-tab layout, date range picker with presets + custom range, NL query bar
- App.tsx updated: /reports → ReportsPage
- POSLayout.tsx updated: Reports nav link added to sidebar
- Recharts 3.x notes: Tooltip formatter receives ValueType|undefined (not number) — use Number(value ?? 0)
- Typecheck: 0 errors. Vite build: 2309 modules, 786kb bundle (recharts adds ~430kb), clean.

## Key Web Patterns
- `TOKEN_KEY`/`REFRESH_TOKEN_KEY`/`USER_KEY` in localStorage; token decoded for locationId
- `VITE_API_URL=""` → relative URL → Vite proxy → `http://localhost:3001`
- `usePOSStore.getState()` for imperative access outside React
- `.tap-highlight` + `.active-scale` CSS classes for touch feedback
- `data-product-tile` attribute enables keyboard 1-9 quick-add shortcuts

## Pending Issues
- Fix 002 seed data columns (slug on locations table doesn't exist, plan 'pro' fails CHECK)
- Configure PAT with Contents:write to unblock git push
- Set DATABASE_URL, JWT_SECRET, MFA_TOKEN_SECRET, MFA_ENCRYPTION_KEY env vars before running server

## Next Prompt
Prompt 11 — Settings page: location settings, employee management, tax rates, printer config, Stripe Connect onboarding
