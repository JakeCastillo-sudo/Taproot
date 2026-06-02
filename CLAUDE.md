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

### Prompt 11 — AI Document Intelligence Pipeline ✅
- Packages installed in apps/api: @fastify/multipart@10, pdf-parse@2, csv-parse@6, @anthropic-ai/sdk@0.100
- Config extended: ANTHROPIC_API_KEY, UPLOADS_DIR, S3_BUCKET/REGION, AWS keys (all optional in dev)
- New services:
  - apps/api/src/services/documentParser.service.ts — classifyDocument, parseMenu, parseInvoice, parseGoodsReceipt, parseInventoryList, parseRecipeSheet, mapCsvColumns, parseImageDocument (Claude vision)
    - Model: claude-sonnet-4-20250514; confidence threshold 0.7 for classification
    - All JSON responses strip markdown fences before parsing
  - apps/api/src/services/importJob.service.ts — createImportJob, processImportJob, confirmImportJob, applyMenuImport, applyInvoiceImport, applyGoodsReceiptImport, applyInventoryListImport, applyRecipeSheetImport, getImportJob, listImportJobs
    - Fuzzy product match via ILIKE on name or exact SKU
    - PDF text extraction: pdf-parse v2 PDFParse class (not default export)
    - Image extraction: Claude vision via parseImageDocument
    - Parsed data stored in mapping_config JSONB alongside column mappings
- Queue updates:
  - AiAnalysisJobData extended: reportType now includes 'import_document'
  - ImportJobQueueData type added
  - apps/api/src/queues/processors/aiAnalysis.processor.ts — handleAiAnalysisJob; routes 'import_document' → processImportJob, others are legacy stubs
  - processors.ts updated to use handleAiAnalysisJob
- New routes:
  - apps/api/src/routes/import.routes.ts — POST /api/v1/imports/upload (multipart, 10MB, saves to uploads/), GET /api/v1/imports/:jobId, POST /api/v1/imports/:jobId/confirm, GET /api/v1/imports — all require IMPORT_RUN
  - apps/api/src/routes/ai.routes.ts — POST /api/v1/ai/nl-query (requires AI_REPORTS), builds org context from DB, calls Claude claude-sonnet-4-20250514, returns { answer, data?, chartType? }
- index.ts: registered importRoutes + aiRoutes
- uploads/ directory created at apps/api/uploads/
- Web — new components:
  - apps/web/src/pages/ImportPage.tsx — drag-and-drop zone, upload queue with status, polling for job completion, tabs (Upload | History)
  - apps/web/src/components/imports/ImportReview.tsx — step indicator, detected type selector, confidence badge, preview table (flags low-confidence rows amber), column mapping editor (CSV only), location selector, apply/cancel
  - apps/web/src/components/imports/ImportHistory.tsx — sortable table of past imports, status badges with auto-refresh when jobs pending, Review button for awaiting_confirmation
- Web — existing files updated:
  - api.ts: ImportType, ImportStatus, ImportJob, ColumnMapping interfaces + importsApi (upload, get, confirm, list)
  - queryClient.ts: importJob, importJobs QK constants
  - App.tsx: /import → ImportPage
  - POSLayout.tsx: Import nav link (Upload icon)
- NL query backend now wired (was stub in Prompt 10): POST /api/v1/ai/nl-query returns real Claude answers
- Typecheck: 0 errors in both apps/api and apps/web. Vite build: 2312 modules, 809kb bundle, clean.
- Key patterns:
  - pdf-parse v2: new PDFParse({ data: buffer }).getText() → TextResult.text
  - Anthropic SDK: lazy singleton, strips markdown fences from JSON responses
  - upload uses raw fetch (not apiFetch) to avoid setting Content-Type on multipart
  - Job polling: 3s interval, max 60 attempts (3 min timeout)

### Prompt 12 — Migration Wizard ✅
- migration.service.ts — 6 provider functions (Square, Shopify, Toast, Lightspeed, Clover, CSV) + applyMigration + listMigrationJobs + 3 test helpers
- migration.routes.ts — 11 routes (6 start, 1 apply, 1 list, 3 test)
- index.ts updated — migrationRoutes registered
- api.ts updated — MigrationImportType, ImportType widened, migrationsApi (startSquare/Shopify/Toast/Lightspeed/Clover/Csv, apply, list, testSquare/Shopify/Clover)
- queryClient.ts updated — migrationJob, migrationJobs QK constants
- MigrationPage.tsx — 5-step wizard: provider grid → credential form + test connection → preview counts + options → animated progress → complete with error download
- App.tsx updated — /migrate → MigrationPage (auth-guarded)
- POSLayout.tsx updated — Migrate nav link (ArrowRightLeft icon, auto-hidden when ≥10 products)
- ImportHistory.tsx + ImportReview.tsx updated — TYPE_LABELS extended for all 5 migration types
- Typecheck: 0 errors (both apps/api and apps/web)
- Key patterns:
  - Credentials never stored — only held in React local state during the wizard session
  - Native fetch used for all external provider API calls (no node-fetch)
  - Square: cursor pagination via POST /v2/catalog/list + /v2/customers/search
  - Shopify: link-header pagination via GET /admin/api/2024-01/products.json etc.
  - Toast: client-credentials OAuth → Bearer token → menus + employees
  - Lightspeed: offset pagination via /API/V3/Account/{id}/Item.json
  - Clover: offset pagination via /v3/merchants/{id}/items?expand=categories
  - applyMigration: categories upsert by name ILIKE, products via ProductSvc, customers via CustomerSvc (duplicate email soft-skipped), loyalty points optional
  - MigrationPayload stored in import_jobs.mapping_config JSONB (status: awaiting_confirmation)
  - Provider external IDs stored in products.metadata JSONB + customers.external_ids JSONB

### Prompt 13 — Production Hardening ✅
- **BUG-001 fixed**: ai.routes.ts creates `new Anthropic()` per-call (no module-level singleton); documentParser already had lazy singleton (Prompt 11)
- **BUG-003 verified**: apiFetch() 401 → refreshTokens() → retry → redirect was already present since Prompt 08
- **Rate limiting hardened**: import.routes.ts 20/hr, ai.routes.ts 30/hr, webhook.routes.ts 1000/min; auth routes already strict (5/15min login, 3/5min MFA)
- **Input validation middleware**: apps/api/src/middleware/validation.ts
  - onRequest: X-Request-ID generate/propagate + attach to response
  - preValidation: reject body >1MB (skip multipart)
  - preHandler: stripHtml() recursively removes HTML tags, JS-URI, inline event handlers, truncates at 50k chars
  - preHandler: UUID validation on route params ending in `id` (excludes readerId — Stripe uses tmr_… format)
- **Error handler**: apps/api/src/middleware/errorHandler.ts — production-safe (no stack traces in prod), Postgres codes (23505→409, 23503→422, 23502→400), Stripe codes →402, Zod→400 flatten, requestId on all error responses
- **config.ts**: JSDoc on every field; production-only validations (JWT ≥64 chars, sk_live_ Stripe key, sslmode=require DB URL, ANTHROPIC_API_KEY present)
- **db/client.ts**: query timing (warn >1s, error >5s), pool capacity monitoring (warn >80%, error at 100%)
- **index.ts**: full hardening rewrite — strict CSP (Stripe/Google Fonts/Anthropic in connect-src), Permissions-Policy via onSend hook, HSTS in production, global 200/min rate limit with retryAfter, HTTPS enforcement, enhanced health check (db SELECT 1, redis PING, stripe key, uptime field), pino serializers never log auth headers or bodies
- **migrations/007_db_security.js**: taproot_app role with least privilege; REVOKE UPDATE/DELETE on audit_logs, inventory_movements, sync_events (append-only tables)
- **apps/web/src/lib/api.ts**: X-Taproot-Client: web CSRF indicator header on all apiFetch() calls
- **vite.config.js**: esbuild minification, hidden source maps in production, manualChunks (vendor-react/state/recharts/icons), chunkSizeWarningLimit 600, drop console/debugger in prod
- **docs/API.md**: complete API reference (all endpoints, rate limits table, error codes table, curl examples)
- **docs/BACKLOG.md**: BUG-001 + BUG-003 marked ✅ RESOLVED
- Audit log completeness verified: order.created, order.voided, payment.process, payment.refund, inventory.adjust, product.create, product.edit, import.completed, migration.complete all present
- Typecheck: 0 errors (both apps/api and apps/web)
- Key patterns:
  - buildApp() returns Promise<any> to avoid FastifyInstance<Http2SecureServer> type drift after helmet registration
  - pino serializer params typed as `any` to avoid ResSerializerReply mismatch
  - readerId excluded from UUID validation (Stripe terminal reader IDs use tmr_… format)
  - Migration numbered 007 (not 008) — sequential after existing 001-006

### Prompt 14 — Beta polish: bug fixes + demo enrichment ✅
- **BUG-002 resolved**: Category names already correct in seed; 22 total products verified in DB
- **BUG-004 resolved**: `scripts/kill-ports.js` clears ports 3001+5173-5178; `npm run dev:clean` runs it first
- **migrations/008_demo_enrich.js**: 12 new products (22 total), 5 demo customers (with loyalty tiers),
  3 modifier groups + 10 modifiers, 3 completed orders with payments → reports show real revenue
- **migrate.ts**: added `checkOrder: false` to allow migrations applied out of strict order
- **migrations/007_db_security.js**: fixed `GRANT CONNECT ON DATABASE CURRENT_DATABASE()` SQL error
  (used DO $$ EXECUTE block with quote_ident instead)
- **PaymentSheet.tsx**: card payments in dev show "Demo Mode" badge + 2-second simulated success;
  `FlaskConical` icon imported for dev badge
- **LoadingSpinner.tsx**: new component with `LoadingSpinner`, `InlineSpinner`, `SkeletonCard`,
  `ProductGridSkeleton`, `TableRowSkeleton`
- **StockLevels.tsx**: quantities now display as integers (Math.round); default sort changed to
  `total_on_hand` ascending (low-stock items float to top)
- **App.tsx**: `PWAInstallBanner` component — detects `beforeinstallprompt`, shows sticky bottom banner
  with Install + Dismiss (remembered 30 days via localStorage)
- **main.tsx**: iOS Safari `--vh` CSS property set + updated on resize; double-tap zoom prevented
  on non-input elements
- **package.json**: added `dev:clean` (kill-ports + dev) and `db:reseed` scripts
- **scripts/reseed.js**: truncates org CASCADE then re-runs all migrations
- Typecheck: 0 errors (both apps/api and apps/web)
- Key patterns:
  - `import.meta.env.DEV` guards all dev-only simulation code
  - All demo UUID prefixes documented in 008 migration header
  - `checkOrder: false` in migrate.ts is permanent (002 was seeded after 003-006 in earlier session)

### Prompt 15 — PWA mobile optimization for iPad and iPhone ✅
- **vite-plugin-pwa** installed; `vite.config.js` updated with VitePWA plugin (autoUpdate, Workbox
  NetworkFirst for API routes, StaleWhileRevalidate for assets, offline-first strategy)
- **manifest.json** rewritten: theme_color #1D9E75, orientation: any, display_override, 10 PNG icons
  (72–512px, `any` + `maskable` purposes), 3 shortcuts (Register/Orders/Inventory) with icons
- **scripts/generate-icons.js**: pure Node.js PNG generator (zlib+Buffer, no canvas/sharp); creates
  Taproot green (#1D9E75) circle with white "T" at 72/96/128/144/152/192/384/512px
- **styles/ios.css**: touch-action: manipulation globally; 100svh/100dvh viewport heights; safe area
  insets; -webkit-overflow-scrolling; input font-size max(16px,1rem) to prevent iOS zoom; tap highlight
- **styles/animations.css**: GPU-only animations (transform+opacity only); CSS timing vars
  --anim-fast/base/slow; easing --ease-out/spring/decel; keyframes slide-up/down/in-left, fade,
  scale-in, bounce-in, tap-pulse, toast-in, shimmer, spin, hint-in
- **useSwipeGesture.ts**: touchstart/touchmove/touchend; threshold 50px; velocity 0.3px/ms; supports
  all 4 directions + onMove + onRelease callbacks
- **useHaptic.ts**: navigator.vibrate wrapper; light(10ms)/medium(30ms)/heavy(60ms)/success([15,50,15])
  /error([40,30,40,30,40])/custom patterns; silent fallback on unsupported devices
- **useOrientation.ts**: viewport-based orientation detection (not unreliable ScreenOrientation API);
  isTablet (≥768px), orientation, showHint (tablet+portrait)
- **BottomSheet.tsx**: drag handle + swipe-down to dismiss (useSwipeGesture); body scroll lock; safe
  area padding; backdrop tap close; Escape key; animate-slide-up; BottomSheetFooter exported
- **MobileCart.tsx**: floating FAB with badge (cart item count) + total; opens BottomSheet;
  per-item qty steppers + Remove; totals section; sticky Charge CTA above safe area; haptic feedback
- **CommandPalette.tsx**: ⌘K launcher; fuzzy search; grouped actions with icons/descriptions/shortcuts;
  ↑↓ arrow nav + Enter select; Esc close; auto-scrolls selected into view
- **useKeyboardShortcuts.tsx**: added onOpenCommandPalette callback; ⌘K/Ctrl+K fires even when
  sheets are open (unlike other shortcuts); ⌘K entry added to SHORTCUTS display list
- **POSLayout.tsx** fully responsive:
  - iPhone (<md): 2-col grid, bottom nav (Register/Inventory/Reports/More), MobileCart FAB
  - iPad portrait (md, not lg): hamburger → overlay sidebar (animate-slide-in-left), MobileCart FAB bottom-right, 3-col grid
  - iPad landscape / desktop (lg+): full 3-col inline layout (w-48 sidebar / flex / w-80 cart)
  - SidebarContent extracted as shared component (inline + overlay share same markup)
  - CommandPalette integrated with 8 actions across Navigate/Cart/Search/Help groups
  - haptic feedback on product tap (light) and long-press (medium)
- **Typecheck**: 0 errors (both apps/api and apps/web)

### Prompt 16 — CI/CD pipeline: GitHub Actions + monitoring + code quality ✅

**GitHub Actions workflows:**
- `.github/workflows/ci.yml` — 4 parallel jobs: api-quality (typecheck+jest with real PG+Redis
  services), web-quality (typecheck+build+bundle size warn), lint (ESLint both apps),
  security-scan (npm audit --omit=dev, git-secrets with AWS/Stripe/Anthropic patterns)
  Branch protection: all 4 must pass before merge
- `.github/workflows/deploy.yml` — staging auto-deploys on push to main (SSH → git pull → build →
  db:migrate:safe → pm2 restart → S3 sync → CloudFront invalidation → health check → Slack notify);
  production requires manual workflow_dispatch + GitHub environment approval; post-deploy smoke tests
- `.github/workflows/release.yml` — triggers on v*.*.* tags; generates grouped changelog
  (feat/fix/perf/docs/chore from commit messages); creates GitHub Release; dispatches production deploy
- `.github/dependabot.yml` — weekly npm updates (grouped minor/patch, no major), monthly Actions
  updates; PRs labeled `dependencies`+`automated`

**Code quality:**
- `.eslintrc.js` — root config: ESLint 8 + TypeScript ESLint + security + no-secrets (tolerance 4.5);
  `no-eval/implied-eval/new-func/script-url` as errors; `while(true)` allowed (checkLoops:false);
  React rules in apps/web override; test files relax secrets+any; migrations/scripts override CJS
- `.prettierrc` — singleQuote, no semi, printWidth 100, trailingComma es5
- Lint scripts added: `apps/api: npm run lint`, `apps/web: npm run lint`, root: `npm run lint`
- `apps/web/package.json`: added `typecheck` and `lint` scripts

**Husky pre-commit hooks:**
- `.husky/pre-commit` — runs typecheck (API+web) + ESLint (API) on every commit; blocks on errors
- `husky@9` + `lint-staged@15` installed; `"prepare": "husky"` in root package.json

**Monitoring:**
- `apps/api/src/monitoring/health.ts` — Fastify plugin; `GET /metrics` (protected by X-Metrics-Secret
  header); Prometheus text format (no prom-client dep, written directly); HTTP request counter +
  duration histogram (via onRequest/onResponse hooks); DB pool gauges; business counters
  (incrementOrdersTotal, incrementRevenue); memory/uptime gauges; Redis client count; memory usage
  warning at >80%; DB pool waiting warning in health check hook
- `GET /metrics` added to PUBLIC_ROUTES in index.ts (protected by X-Metrics-Secret, not JWT)
- `registerMonitoring(fastify)` called in index.ts after all route registration

**Deployment config:**
- `ecosystem.config.js` — PM2 cluster mode (instances:max), max_memory_restart:1G, kill_timeout:5000,
  env_staging/env_production overrides, log rotation to logs/
- `scripts/migrate-safe.js` — shows pending migrations, 10s abort window in production, exits
  non-zero on failure; `npm run db:migrate:safe` added to root package.json
- `scripts/release.js` — semantic version bump (patch/minor/major), CHANGELOG.md update (grouped
  by commit type), git commit + tag + push
- `apps/api/.env.staging.example` + `.env.production.example` — full env var templates with
  generation instructions for secrets

**Documentation:**
- `docs/DEPLOYMENT.md` — complete guide: local dev setup, architecture diagram, GitHub Secrets
  table, branch protection instructions, staging/production deploy steps, server setup, rollback
  procedure, environment variable reference, DB migration safety, PM2 commands, common issues

**Bug fixes (lint cleanup):**
- `CommandPalette.tsx` — moved `useMemo(groups)` before early return to fix `rules-of-hooks`
- `CustomerSearch.tsx` — escaped `"` → `&ldquo;/&rdquo;` to fix `no-unescaped-entities`
- `MigrationPage.tsx` — escaped `'` → `&apos;` to fix `no-unescaped-entities`
- `validation.ts` — removed useless `\-` escape in regex character class
- `.gitignore` — added logs/, .env.staging, .env.production, coverage/, builds

**Typecheck**: 0 errors (both apps/api and apps/web)
**ESLint**: 0 errors, 42 warnings (all pre-existing unused imports — downgraded to warn)

### Prompt 17 — AWS CDK production infrastructure + Docker ✅

**CDK Infrastructure (`infra/`):**
- `infra/lib/taproot-stack.ts` — Full `TaprootStack` with `TaprootStackProps` interface;
  parameterized by `stageName`, `domainName`, `instanceClass`, `desiredCount`, `multiAz`
- `infra/bin/taproot.ts` — App entry; instantiates `TaprootStaging` (t3.micro, 1 task, no Multi-AZ)
  and `TaprootProduction` (t3.small, 2 tasks, Multi-AZ) stacks
- `infra/package.json` — CDK deps (`aws-cdk-lib`, `constructs`), build/synth/diff scripts
- `infra/tsconfig.json` — ES2020, strict, commonjs
- `infra/cdk.json` — `npx ts-node --prefer-ts-exts bin/taproot.ts` app command

**Stack constructs built:**
1. **VPC** — 2 AZs; public (ALB/NAT), private (ECS/egress), isolated (RDS/Redis) subnets
2. **Security groups** — ALB (0.0.0.0→80,443), ECS (ALB→3001), RDS (ECS→5432), Redis (ECS→6379)
3. **RDS PostgreSQL 15** — gp3 20GB→100GB auto-scale; encrypted; 7-day backups; deletion protection
   in prod; parameter group (max_connections=100, shared_buffers=256MB, log slow queries >1s);
   Performance Insights in prod; credentials generated via Secrets Manager
4. **ElastiCache Redis 7** — cache.t3.micro; encrypted at rest + in transit; AOF persistence;
   3-snapshot retention in prod
5. **Secrets Manager** — `taproot/{stageName}/{name}` containers for 7 app secrets + RDS credential;
   ECS task role with `GetSecretValue` on `taproot/{stageName}/*` only
6. **ECR** — `taproot-api` repo; scan on push; keep-last-10 lifecycle policy
7. **ECS Fargate** — 256 CPU / 512MB; env from Secrets Manager; health check `/api/health`;
   rolling update with circuit breaker + rollback; auto-scale 1–4 tasks on CPU>70%; CloudWatch
   log group `/taproot/{stageName}/api` (30 day retention)
8. **ACM Certificate** — `taprootpos.com` + `*.taprootpos.com`; DNS validation via Route53
9. **ALB** — HTTPS 443→ECS; HTTP 80→redirect; target group health check `/api/health`
10. **S3 + CloudFront** — private bucket; OAC (not OAI); HTML no-cache policy; assets 1-year
    cache; PriceClass_100; HTTP2+3; brotli+gzip; 404→index.html; Route53 A records
11. **CloudWatch Alarms** → SNS topic: 5xx error rate >5%, P95 latency >2s, DB connections >80,
    Redis CPU >80%; alertEmail context variable
12. **AWS Budgets** — $200/month; alerts at 80% ($160) and 100% ($200) via email+SNS

**Docker:**
- `apps/api/Dockerfile` — multi-stage (builder: npm ci + tsc; production: omit-dev deps, non-root
  `taproot` user, HEALTHCHECK, EXPOSE 3001)
- `docker-compose.yml` — api (builds from Dockerfile) + postgres:15 + redis:7; health conditions;
  uploads volume mount; restart: unless-stopped
- `.dockerignore` — excludes node_modules, .env, uploads, dist, .github, test files, scripts

**Other files:**
- `infra/nginx/nginx.conf` — TLS 1.2/1.3; OCSP stapling; security headers (HSTS/X-Frame/XSS);
  proxy to localhost:3001; WebSocket `/api/v1/ws`; metrics restricted to private CIDRs
- `scripts/setup-server.sh` — Ubuntu 22.04 bootstrap: Node 20, PostgreSQL 15, Redis 7, Nginx,
  PM2, AWS CLI v2, UFW, fail2ban, unattended-upgrades; creates `taproot` app user
- `docs/BACKUP.md` — RTO/RPO table; RDS auto snapshots + manual pre-deploy; pg_dump cron;
  PITR instructions; monthly restore drill procedure; S3 lifecycle; GDPR backup notes
- `docs/RUNBOOK.md` — First deploy walkthrough; routine deploy steps; rollback (code+DB+frontend);
  scale-up guide (ECS/RDS/Redis); on-call runbook per alarm type; useful AWS CLI commands

**CI/CD update (`deploy.yml` rewritten):**
- New `build-push` job: ECR login → `docker/build-push-action@v5` (BuildKit layer cache) → ECR
  scan; outputs `image-tag` (SHA) used by downstream jobs
- Separate `build-web-staging` / `build-web-production` jobs upload dist artifacts
- `staging-deploy`: uses `amazon-ecs-render-task-definition@v1` + `amazon-ecs-deploy-task-definition@v1`
  (waits for service stability); then S3 sync + CloudFront invalidation + health check
- `production-deploy`: pre-deploy RDS snapshot → same ECS deploy + smoke tests

**Shared package fix:**
- `packages/shared/tsconfig.json` — added `outDir: ./dist`
- `packages/shared/package.json` — added `build: tsc` script; updated `main`/`types` to `dist/`

**Typecheck**: 0 errors (both apps). **ESLint**: 0 errors, 30 warnings (pre-existing).

### Prompt 19 — Open for Business: Onboarding Wizard ✅

**Backend:**
- `migrations/010_partner_codes.js` — partner_codes table (code, partner_name, trial_days, is_active, uses_count, max_uses, expires_at); seeded TAPROOT30 (30d) + EARLYBIRD (21d)
- `apps/api/src/services/referral.service.ts` — getTrialDays(referralSource, partnerCode?): queries partner_codes, validates, falls back to 14d; trackReferral(): updates org.metadata, increments uses_count, audit log
- `apps/api/src/routes/registration.routes.ts` — updated to use getTrialDays() + trackReferral(); returns `{ accessToken, refreshToken, employee: { ...orgId, locationIds, permissions }, trialEndsAt, trialDays }`; partnerCode param added
- `apps/api/src/routes/onboarding.routes.ts` — GET/POST /onboarding/status (JSONB merge), POST /onboarding/complete, POST /onboarding/menu-from-url (server-side fetch + strip HTML + createImportJob)
- `apps/api/src/index.ts` — registered onboardingRoutes

**Frontend — state + hooks:**
- `apps/web/src/store/onboarding.store.ts` — Zustand persist; org-scoped key; actions: setStep, skipStep, completeOnboarding, updateBusinessInfo/MenuUpload/RecipeSetup/StripeConnect; partialize: returns {} if isComplete
- `apps/web/src/hooks/useOnboardingGate.ts` — shouldShowOnboarding: isOwner && !isComplete && productCount < 5
- `apps/web/src/hooks/useOnboardingResume.ts` — resume banner: owner, !complete, step !== 'welcome', started >5min ago, not dismissed (24hr)
- `apps/web/src/lib/analytics.ts` — onboarding funnel events: onboardingStarted/StepViewed/StepCompleted/StepSkipped/Abandoned, menuUpload*, menuItemsApproved, recipeSetup*, stripeConnected, onboardingCompleted

**Frontend — step components:**
- `apps/web/src/components/onboarding/WelcomeStep.tsx` — bouncing 🌿, staggered timeline, "Let's go →"
- `apps/web/src/components/onboarding/MenuUploadStep.tsx` — 4 cards (PDF/photo, CSV, URL, manual), polling import jobs, drag-and-drop, CSV template blob, DemoMenuButton
- `apps/web/src/components/onboarding/ManualEntryStep.tsx` — 4-column spreadsheet table, Tab/Enter navigation, Excel TSV paste
- `apps/web/src/components/onboarding/DemoMenuButton.tsx` — 14-item hardcoded sample menu (isDemo: true)
- `apps/web/src/components/onboarding/MenuReviewStep.tsx` — category tabs, inline cell editing, confidence dots (green/amber/red), bulk select/delete/move, DEMO badge, flagged items sorted to top
- `apps/web/src/components/onboarding/RecipeSetupStep.tsx` — 3 benefit cards, file upload or text paste, polling import job, done/error states
- `apps/web/src/components/onboarding/StripeConnectStep.tsx` — card logos, POST /connect/account, opens Stripe tab, polls status every 5s, waiting/connected states
- `apps/web/src/components/onboarding/CompleteStep.tsx` — canvas-confetti burst, animated SVG checkmark, summary chips, 3 action cards, fires analytics + POST /onboarding/complete

**Frontend — page + routing:**
- `apps/web/src/pages/OnboardingPage.tsx` — full-screen shell; progress bar; step label + "Step X of 4"; Skip/Back/Exit (×) buttons; CSS slide transitions; step rendering switch; confirms import job on review approve (non-blocking); analytics per step
- `apps/web/src/pages/RegisterPage.tsx` — updated response parsing (`accessToken` not `tokens.accessToken`); redirect to /onboarding; partnerCode URL param + input; extended referral dropdown (Reddit/Facebook/review_site); saves businessInfo to onboarding store
- `apps/web/src/App.tsx` — added /onboarding → OnboardingPage (RequireAuth)

**Fixes:**
- MenuUploadStep/RecipeSetupStep: `parsed_data` → `mapping_config` (correct ImportJob field)
- OnboardingPage: `importsApi.confirm(jobId, locationId)` — passes required locationId arg

**Typecheck**: 0 errors (both apps). **ESLint**: 0 errors, 14 web warnings / 33 API warnings (all pre-existing).

### Prompt 18 — Beta: Subscription billing & registration ✅

**Backend:**
- `migrations/009_subscriptions.js` — adds stripe_customer_id, stripe_subscription_id,
  subscription_status (CHECK), subscription_plan (CHECK), trial_ends_at (14d default),
  subscription_ends_at, location_count, referral_source, metadata to organizations table
- `apps/api/src/payments/stripe.config.ts` — added `validateStripeMode()`: production requires
  `sk_live_`, dev rejects `sk_live_`; logged at startup
- `scripts/register-webhooks.js` — CLI to register Stripe webhook endpoints; outputs secrets
- `apps/api/src/services/subscription.service.ts` — createSubscription, handleSubscriptionWebhook,
  checkSubscriptionAccess (Redis cache 5min), getSubscriptionPortalUrl
- `apps/api/src/middleware/subscription.ts` — 402 with SUBSCRIPTION_REQUIRED for expired orgs
- `apps/api/src/services/email.service.ts` — sendWelcomeEmail, sendTrialEndingEmail,
  sendPaymentFailedEmail, sendPasswordResetEmailTemplate, sendLowStockAlertEmail
- `apps/api/src/routes/registration.routes.ts` — POST /api/v1/register + /check-email (rate
  limited 10/hr); LegalZoom → 30d trial, slug gen, withTransaction, JWT auto-login
- `apps/api/src/routes/billing.routes.ts` — GET /subscription, POST /portal, GET /invoices,
  POST /subscribe
- `apps/api/src/monitoring/sentry.ts` — Sentry.init at startup; beforeSend deletes request.data +
  redacts Authorization; captureException for 5xx only
- `apps/api/src/config.ts` — added SENTRY_DSN, STRIPE_BILLING_PRICE_ID, SENDGRID_API_KEY
- `apps/api/src/index.ts` — validateStripeMode + initSentry at startup; billingRoutes registered

**Frontend:**
- `apps/web/src/lib/analytics.ts` — Plausible wrappers (pageView, login, orderCompleted,
  trialStarted, subscriptionStarted, upgradePageViewed, import/migration events)
- `apps/web/src/components/ui/TrialBanner.tsx` — amber/orange/red banner (urgent ≤3d, critical ≤1d);
  dismissible per session; navigate('/billing') CTA
- `apps/web/src/components/ui/HelpButton.tsx` — fixed ? button; help panel with search, 6 articles,
  docs link, support email, bug report mailto
- `apps/web/src/pages/RegisterPage.tsx` — multi-step (account→business→success); email availability
  debounce 500ms; password strength meter; business type emoji grid; LegalZoom banner
- `apps/web/src/pages/BillingPage.tsx` — plan status, features, Stripe portal, invoices, usage stats
- `apps/web/src/pages/UpgradePage.tsx` — Stripe Elements card form → POST /billing/subscribe
- `apps/web/src/pages/LandingPage.tsx` — hero, 6-feature grid, pricing section, footer
- `apps/web/src/pages/PrivacyPage.tsx` — full privacy policy (GDPR, CCPA)
- `apps/web/src/pages/TermsPage.tsx` — full terms of service
- `apps/web/src/lib/api.ts` — exported apiFetch; added billingApi, registrationApi + types
- `apps/web/src/lib/queryClient.ts` — added QK.billing(), QK.billingInvoices()
- `apps/web/src/App.tsx` — TrialBanner + HelpButton; / = LandingPage (logged out) or POS (logged in);
  routes: /register, /billing, /upgrade, /privacy, /terms
- `apps/web/src/pages/LoginPage.tsx` — "Start free trial" link → /register; Privacy/Terms footer
- `apps/web/index.html` — Plausible script tag (data-domain=app.taprootpos.com)
- `apps/web/src/main.tsx` — @sentry/react init (prod-only, no request bodies, no session replay)

**Bug fixes:**
- `subscription.service.ts` — logAudit → createAuditLog, emailQueue → queues.email
- `registration.routes.ts` — generateTokenPair → signAccessToken/signRefreshToken with proper fields;
  logAudit → createAuditLog
- `sentry.ts` — removed invalid @ts-expect-error directive

**Typecheck**: 0 errors (both apps). **ESLint**: 0 errors, 33 API warnings / 12 web warnings (all pre-existing).

## Next Prompt
Prompt 20 — Settings page: location settings, employee management, tax rates, printer config, Stripe Connect onboarding
