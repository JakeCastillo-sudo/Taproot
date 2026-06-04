# Taproot POS — Bug Backlog

## P0 — Critical (blocks production)

### BUG-PAY-001: Payment crashes with undefined length error
- Symptom: "Cannot read properties of undefined (reading 'length')" error modal
  after clicking Charge button
- Location: apps/web/src/components/pos/PaymentSheet.tsx — in the
  `buildReceiptSnapshot()` / `setLastCompletedOrder()` snapshot builder;
  `item.modifiers` or the `items` array may be undefined at access time
- Fix needed:
  - Add safe fallbacks: `item.modifiers ?? []` and `items?.map(...) ?? []`
  - Check pos.store.ts `CartItem` type — ensure `modifiers` field defaults to `[]`
    so it is never undefined when snapshot is built
- Impact: blocks all payment processing and receipt printing
- Priority: P0
- Status: OPEN

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

---

## Import Feature — P1 Bugs

### BUG-IMP-001: CSV import parses file but does not extract menu items
- Symptom: CSV file uploads successfully but review screen shows no items or empty list
- Expected: CSV with columns (name, price, category, description) should parse into editable item list
- File: apps/api/src/services/importJob.service.ts (CSV parsing path in processImportJob)
- Priority: P1
- Status: OPEN

### BUG-IMP-002: PDF menu parser does not extract prices
- Symptom: All items imported from PDF show $0.00 price
- Expected: AI parser should extract prices from menu PDF
- Likely cause: Claude model prompt not returning prices in cents format, or price extraction failing on PDF text
- File: apps/api/src/services/documentParser.service.ts (parseMenu function and prompt)
- Priority: P1
- Status: OPEN

### BUG-IMP-003: Import review screen overflows viewport
- Symptom: Initial review screen does not fit browser window. User must zoom out (Cmd −) to see action buttons. No scroll available to reach buttons at bottom.
- Expected: Screen should be scrollable, buttons always accessible without zooming
- File: apps/web/src/components/imports/ImportReview.tsx (layout/height CSS)
- Priority: P1
- Status: OPEN

### BUG-IMP-004: Import workflow stops at review step
- Symptom: Full workflow upload → review → edit → approve → push to menu stops at review. Confirm/import button does not complete the flow and push items to the POS menu.
- Expected: After editing and clicking Import, products should appear in POS product grid immediately
- Files: apps/web/src/components/imports/ImportReview.tsx + apps/api/src/services/importJob.service.ts (confirm flow and applyMenuImport)
- Priority: P1 — blocks core import feature value
- Status: OPEN

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
