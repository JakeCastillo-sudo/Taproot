# Taproot POS — Bug Backlog

## P0 — Critical (blocks production)

### BUG-ORD-001: Order creation 500s from the POS — frontend/backend contract mismatch ✅ RESOLVED
- Symptom: clicking Charge (cash, or card in production) → `POST /locations/:id/orders` returns
  500 "Cannot read properties of undefined (reading 'length')". Real orders never created via UI;
  demo only worked because orders were seeded and DEV card payments are simulated.
- Root cause: frontend `ordersApi.create` sent `{ items: [{..., unitPrice}] }` but the backend
  `createOrder` expects `{ orderType, lineItems: [{..., unitPriceOverride}] }` (required orderType).
  `resolveLineItems(input.lineItems)` → undefined.length.
- Fix applied (S2-07): `orders.create` in `api.ts` now translates the cart body → backend contract
  (orderType default 'in_store', items→lineItems, unitPrice→unitPriceOverride, modifiers carry name).
  PaymentSheet + SplitCheckModal pass modifier `name` through. Verified live: `lineItems`+`orderType`
  creates an order (id returned).
- Status: RESOLVED

### BUG-PAY-001: Payment crashes with undefined length error ✅ RESOLVED
- Symptom: "Cannot read properties of undefined (reading 'length')" error modal
  after clicking Charge button
- Fix applied (Prompt 27): `(c.modifiers ?? []).map(...)` guards added in both
  `buildReceiptSnapshot()` and `ordersApi.create()` call in PaymentSheet.tsx.
  `CartItem.modifiers` is non-optional in the type; `?? []` guards are defensive.
- Status: RESOLVED

### BUG-001: Anthropic API key not loading in document parser ✅ RESOLVED
- Symptom: 401 authentication_error from Anthropic API on file upload
- Route: POST /api/v1/imports/upload
- Root cause: Anthropic SDK instantiated at module level before dotenv ran
- Fix applied (Prompt 11): `getAnthropic()` lazy singleton in documentParser.service.ts
  ensures client is created on first call, after dotenv has loaded
- Fix applied (Prompt 13): ai.routes.ts now creates `new Anthropic()` inside the
  handler function — per-call instantiation with guaranteed dotenv load order
- Status: RESOLVED

## P1 — High (degrades experience)

### BUG-UX-001: Missing scroll on Inventory archived screen ✅ RESOLVED
- Symptom: Archived products list has no scroll when content exceeds viewport height
- Fix applied (Beta 1.0): `InventoryPage.tsx` outer changed to `h-screen overflow-hidden`;
  `<main>` gets `overflow-y-auto min-h-0` — all Inventory tabs including Archived now
  scroll within the viewport.
- Status: RESOLVED

### BUG-UX-002: Missing scroll on multiple screens ✅ RESOLVED
- Symptom: Several screens have no scroll when content exceeds standard display viewport
  (1366x768 common laptop resolution)
- Fix applied (Beta 1.0):
  - `InventoryPage.tsx`: `min-h-screen` → `h-screen overflow-hidden`; `<main>` gets
    `overflow-y-auto min-h-0` — all inventory tabs scroll correctly
  - `ImportPage.tsx`: `min-h-screen` → `h-screen overflow-hidden`; review card changed
    from `min-h-[600px]` to `flex-1 min-h-0`; GenericImportReview root gets `min-h-0`
  - Other audited screens (StockCountSheet, OnboardingPage, ReportsPage) already had
    correct overflow handling — no changes needed
- Status: RESOLVED

### BUG-002: Inventory table shows — for category names ✅ RESOLVED
- Symptom: Category column blank in inventory stock levels table
- Root cause: products not linked to categories in seed data
- Fix applied (Prompt 14): 002_seed_data.js already had category_id on all products.
  Migration 008_demo_enrich added 12 more products all with correct category_id.
  Verified with psql: all 22 products show correct category names.
- Status: RESOLVED

### BUG-003: Auth token not auto-refreshing in web app ✅ RESOLVED
- Symptom: "Token has expired" error after 15 minutes
- Fix applied (Prompt 08 / api.ts): apiFetch() automatically calls
  POST /api/v1/auth/refresh on 401 response, stores new accessToken,
  retries the original request transparently. Falls back to /login redirect
  if refresh also fails. Deduplicates concurrent refresh calls.
- Status: RESOLVED

## P2 — Medium (polish)

### BUG-004: Multiple Vite ports in use ✅ RESOLVED
- Symptom: Web app increments port on each restart (5173→5178+)
- Fix applied (Prompt 14): Added `scripts/kill-ports.js` that kills any
  processes on ports 3001, 5173-5178 before starting. Use `npm run dev:clean`
  instead of `npm run dev` to start cleanly.
- Status: RESOLVED

---

## Prompt 20 QA Pass Findings

### BUG-QA-001: Registration FK violation ✅ RESOLVED
- Symptom: POST /api/v1/register → 500 "locations_created_by_fk" FK violation
- Root cause: Code tried to insert location before employee existed (FK: locations.created_by → employees.id)
- Fix: Reordered to employee → location → UPDATE employee.location_ids in withTransaction
- Status: RESOLVED

### BUG-QA-002 + BUG-QA-003: Wrong columns in registration INSERT ✅ RESOLVED
- Symptom: "column is_active does not exist", "relation employee_locations does not exist"
- Root cause: Service assumed is_active and employee_locations junction table; actual schema uses deleted_at and location_ids uuid[]
- Fix: Removed is_active from INSERT; removed employee_locations INSERT; uses location_ids array instead
- Status: RESOLVED

### BUG-QA-004: employees.is_active in order service ✅ RESOLVED
- Symptom: POST /api/v1/locations/:id/orders → 500 "column is_active does not exist"
- Root cause: order.service.ts queried `SELECT id, is_active FROM employees` — employees table uses deleted_at
- Fix: Changed to `SELECT id FROM employees WHERE ... AND deleted_at IS NULL`
- Status: RESOLVED

### BUG-QA-005: tax_rates table missing ✅ RESOLVED
- Symptom: POST /api/v1/locations/:id/orders → 500 "relation tax_rates does not exist"
- Root cause: calculateTax() queried non-existent tax_rates table; schema stores rates in locations.tax_config JSONB
- Fix: Rewrote calculateTax() to read `{rates: [{name, rate, included}]}` from locations.tax_config; defaults to 0% if not configured
- Status: RESOLVED

### BUG-QA-006: getDashboardMetrics PostgreSQL 42P18 ✅ RESOLVED
- Symptom: GET /api/v1/reports/dashboard → 500 "could not determine data type of parameter $2"
- Root cause: Query passed `[orgId, null, timezone]` but $2 never appeared in SQL — PostgreSQL can't infer type of unused parameter
- Fix: Changed params to `[orgId, timezone]`; all `$3` references in SQL updated to `$2`
- Status: RESOLVED

### BUG-QA-007: SQL injection in getDashboardMetrics ✅ RESOLVED
- Symptom: locationId was string-interpolated: `AND location_id = '${locationId}'`
- Risk: Low (locationId comes from validated JWT UUID) but violates parameterization standard
- Fix: Replaced with bindings-array pattern; location condition now uses `$3` binding
- Status: RESOLVED

### BUG-QA-008: Rate limit returns HTTP 500 instead of 429 ✅ RESOLVED
- Symptom: 6th login attempt returned HTTP 500 with RATE_LIMITED body instead of 429
- Root cause: errorResponseBuilder accessed `context.ttl` without null guard; NaN result caused Fastify serialization error
- Fix: Added null-safe `ctx.ttl != null ? Math.ceil(ctx.ttl/1000) : 60`; added `statusCode: 429` to response object
- Status: RESOLVED

### BUG-QA-009: Login fails for new registrations (no org slug) ✅ RESOLVED
- Symptom: New users who just registered couldn't log in (don't know their org slug)
- Root cause: Frontend sent x-organization-slug header based on hardcoded 'demo-restaurant'
- Fix: Backend resolves org from email JOIN when no slug header provided; frontend no longer sends slug header
- Status: RESOLVED

### BUG-QA-010: processors.ts uses employees.is_active and employees.name ✅ RESOLVED
- Symptom: Low-stock alert job would fail with column errors
- Root cause: Queue processor queried `e.is_active = true` and `e.name` — neither exist on employees table
- Fix: Changed to `e.deleted_at IS NULL` and `e.first_name || ' ' || e.last_name AS name`
- Status: RESOLVED

---

## P3 — Low Priority (future backlog)

### BUG-QA-011: MFA enforcement UI step missing
- Symptom: Logging in with MFA-enabled account doesn't show TOTP prompt
- Location: LoginPage.tsx:24 (TODO comment)
- Fix needed: Add /login/mfa step; detect mfa_required in login response
- Status: OPEN

### BUG-QA-012: Create customer from POS search not wired
- Symptom: "+" button in CustomerSearch doesn't open create modal
- Location: CustomerSearch.tsx:180 (TODO comment)
- Fix needed: Open CustomerCreateModal or navigate to /customers/new
- Status: OPEN

### BUG-QA-013: Tax configuration UI missing
- Symptom: No way for restaurant owner to set their tax rate through UI
- Root cause: tax_config JSONB exists on locations table but no settings UI
- Fix needed: Add tax rate field to location settings page (Prompt 21 candidate)
- Status: OPEN

### BUG-QA-014: Top customers report empty
- Symptom: GET /api/v1/reports/top-customers returns 0 rows
- Root cause: Seed orders have customer_id = NULL (not linked to demo customers)
- Fix needed: Update 008_demo_enrich.js seed to link orders to demo customers
- Status: OPEN

### BUG-QA-015: Data integrity check overpaid_orders too strict
- Symptom: QA test flagged cash order with change_due as "overpaid"
- Root cause: Check should be `SUM(payments) > total + change_due + 0.01`
- Status: INFORMATIONAL — not a real bug, just overly strict check script

### BUG-NAV-001: Category tile grid visual polish needed ✅ RESOLVED
- Symptom: Category tiles are different sizes, colors are auto-generated with no admin
  control, tile order cannot be rearranged, grid alignment is inconsistent
- Fix applied (Prompt 29 + Beta 1.0):
  - `CategoryTileGrid.tsx` uses `aspect-square` on all tiles (uniform size)
  - `/settings/dashboard` editor: color picker, emoji icons, drag-to-reorder, pin/hide
  - Layout config stored in `organizations.settings.dashboardLayout` JSONB
- Status: RESOLVED

---

## Import Feature — P1 Bugs

### BUG-IMP-001: CSV import parses file but does not extract menu items ✅ RESOLVED
- Symptom: CSV file uploads successfully but review screen shows no items or empty list
- Root cause: Full CSV records were stored only as 10-row preview_data; full record set
  not persisted; no `case 'generic_csv':` in confirmImportJob switch
- Fix applied (Beta 1.0):
  - `importJob.service.ts` processImportJob: store full records in
    `mappingConfig.parsed.records` (mirrors document branch pattern)
  - `importJob.service.ts` confirmImportJob: added `case 'generic_csv':` calling
    new `applyGenericCsvImport()` which maps columns via AI mapping and creates products
  - `ImportReview.tsx` GenericImportReview: reads `mapping_config.parsed.records` for
    full row count (falls back to preview_data for backward compatibility)
- Status: RESOLVED

### BUG-IMP-002: PDF menu parser does not extract prices ✅ RESOLVED
- Symptom: All items imported from PDF show $0.00 price
- Root cause: Claude occasionally returns prices as dollars (12.99) despite prompt
  specifying cents; no post-parse normalization existed
- Fix applied (Beta 1.0):
  - `documentParser.service.ts` parseMenu: added `normalizeMenuPrice()` — values < 100
    treated as dollars and multiplied by 100; applied to item prices and modifier
    priceDelta values; prompt updated with clearer examples and "never return 0" rule
- Status: RESOLVED

### BUG-IMP-003: Import review screen overflows viewport ✅ RESOLVED
- Symptom: Initial review screen does not fit browser window. User must zoom out (Cmd −) to see action buttons. No scroll available to reach buttons at bottom.
- Root cause: ImportPage.tsx used `min-h-screen` (unbounded growth) and `min-h-[600px]`
  card; `h-full` on ImportReview could not resolve to a finite height
- Fix applied (Beta 1.0):
  - `ImportPage.tsx`: `min-h-screen` → `h-screen overflow-hidden`; middle wrapper gets
    `flex flex-col min-h-0`; review card changes to `flex-1 min-h-0`
  - `ImportReview.tsx` GenericImportReview: root div gains `min-h-0`; header gets `shrink-0`
- Status: RESOLVED

### BUG-IMP-004: Import workflow stops at review step ✅ RESOLVED
- Symptom: Full workflow upload → review → edit → approve → push to menu stops at review. Confirm/import button does not complete the flow and push items to the POS menu.
- Root cause: `confirmImportJob` switch had no `case 'generic_csv':` — fell through to
  `default: throw new ValidationError('Unsupported import type: generic_csv')`;
  also full CSV records were not stored, so even adding the case would have no data
- Fix applied (Beta 1.0):
  - `importJob.service.ts` processImportJob: full CSV records stored in
    `mappingConfig.parsed.records` (BUG-IMP-001 fix prerequisite)
  - `importJob.service.ts` confirmImportJob: added `case 'generic_csv':` calling new
    `applyGenericCsvImport()` which reads stored records, applies column mapping, and
    creates/updates products via existing ProductSvc
  - For `document_menu` imports: chain was already correct end-to-end (no changes needed)
- Status: RESOLVED

## Prompt 22 Auth Bug Fixes ✅ RESOLVED

### BUG-AUTH-001: Registration email field triggers redirect to /login ✅ RESOLVED
- Symptom: Typing email on /register redirected to /login before form was complete
- Root cause: Stale/expired token in localStorage → apiFetch email-check request
  included the bad Authorization header → 401 → refresh failed → clearTokens() +
  window.location.href = '/login'
- Fixes applied (Prompt 22):
  1. `RegisterPage.tsx`: Mount effect decodes JWT, redirects to / if valid, or
     calls clearTokens() silently if expired/malformed — so apiFetch never sends bad header
  2. `api.ts`: apiFetch 401 handler now checks PUBLIC_PATHS — no redirect from /register or /login
- Status: RESOLVED

### BUG-AUTH-002: Demo login briefly shows POS then redirects back ✅ RESOLVED
- Symptom: After demo login, POS flashed then app reverted (loop on next login)
- Root cause (multi-factor):
  a. `TrialBanner` fired apiFetch('/api/v1/billing/subscription') immediately after
     mount; if that returned 401 for any reason (e.g. billing endpoint edge-case),
     apiFetch triggered window.location.href = '/login' *before* TrialBanner's catch
     block could swallow the error
  b. `onboarding.store.ts` partialize returned {} when isComplete=true, causing
     isComplete to reset to false on rehydration (Zustand merges {} with defaults)
  c. React Query cache from previous SPA session could serve stale/error state
- Fixes applied (Prompt 22):
  1. `TrialBanner.tsx`: Uses apiFetch noRedirect:true — billing check never forces logout
  2. `LoginPage.tsx`: Calls queryClient.clear() before navigate; marks onboarding
     complete if account has ≥5 products (self-heals demo and existing accounts)
  3. `onboarding.store.ts`: Partialize now persists { isComplete:true, completedAt }
     instead of {} — isComplete survives rehydration correctly
  4. `useOnboardingGate.ts`: Added !loading guard to shouldShow + mounted ref
- Status: RESOLVED

## DEP-AUDIT-001 — npm audit advisories (post-V1.0)
Found during S7-07. 5 advisories, **no criticals**, all in build/transitive deps:
- `esbuild` (moderate) — dev-only via vite; fix = vite@8 (breaking).
- `nodemailer` (high) — SMTP injection class; fix = nodemailer@8 (breaking). Audit before bumping.
- `tar`, `uuid` (high/moderate) — transitive; revisit on next dep sweep.
Action: schedule a dependency-bump pass with build verification. Not a launch blocker.

## BUG-AUTH-002 — "Cannot login on live site" investigation — RESOLVED
**Reported:** P0 — login/registration failing on taproot-pos.com.

**Evidence gathered (all PASS at investigation time):**
- `POST /api/v1/auth/login` (curl, with & without X-Organization-Slug) → 200 + accessToken.
- `GET /api/health` → ok, v1.0.0, db/redis/stripe ok.
- CORS preflight from `https://taproot-pos.com` → 204, `access-control-allow-origin` correct, credentials allowed.
- `POST /register/check-email` → 200; `/register` OPTIONS → 204.
- **Live deployed bundle** (`taproot-pos.com/assets/*.js`) targets the CORRECT backend host
  `taproot-production-3d63.up.railway.app` → Vercel has a dashboard env override.

**Root cause (latent landmine, cause E):** committed `apps/web/.env.production` had
`VITE_API_URL=https://taproot-api.up.railway.app` — a host that 404s — wrong since the original
deploy commit (a116e6d, Jun 2). Production has been saved only by a Vercel dashboard override of
`VITE_API_URL`. Any build/deploy WITHOUT that override (new Vercel project, override removed, local
prod build) posts auth to the dead host → "cannot login." 

**Fix:**
- `apps/web/.env.production` → correct host `taproot-production-3d63.up.railway.app`.
- `apps/api/src/index.ts` CORS → hardcode `https://taproot-pos.com` + `https://www.taproot-pos.com`
  (defense in depth; no longer depends solely on APP_URL/CORS_ORIGINS env).
- Added auth check to `scripts/morning-check.sh` and a note in SESSION_GUIDELINES.

**Status:** RESOLVED. Live auth verified healthy end-to-end; committed config now matches reality so a
rebuild can't reintroduce the dead-host failure.

**Note (separate, observed during diagnosis):** the demo owner's JWT `locationIds` contains a
soft-deleted location (`40aef9d7…`, the S6-07 smoke-test loc). `deleteLocation` doesn't strip the id
from `employees.location_ids`. Not auth-blocking, but can point the POS at a deleted location. → BUG-LOC-002.

## Session 2026-06-06 — verification pass
- **BUG-AUTH-002** — RESOLVED (prior session): login + registration verified live again this session
  (login 200+token; register 200+token with businessName/businessType). The earlier "registration fails"
  was a test-payload field-name mismatch (`organizationName` vs `businessName`+`businessType`) — the app
  sends the correct fields. No code bug.
- Landing page rewritten to the new GTM copy ($99 flat, origin story, pain, value props, honest
  comparison, price promise + pass-through disclaimer, savings, FAQ, closing CTA).
- TypeScript: 0 errors both apps; production build green. Migrations 001–016 all applied (no pending).
