# Taproot POS — Complete Technical Specification
Version: 1.5.0
Last Updated: June 2026
Classification: Internal + Helpdesk Reference

This document is the single source of truth for what Taproot POS is, every feature
and how it works, every API endpoint, the database schema, the security architecture,
and the integration points. It is consumed by the AI helpdesk, by engineers onboarding
to the codebase, by the executive team, and by investors in due diligence. It is written
to be accurate and complete — technical truth, not marketing.

---

## 1. PRODUCT OVERVIEW

### What Taproot POS Is
Taproot POS is an AI-native, cloud-based point-of-sale system built specifically for
independent restaurants. It runs as a Progressive Web App (PWA) on any device — no
proprietary hardware required.

### Core Value Propositions
1. AI menu import: upload a PDF → products imported in ~60 seconds
2. No contract: month-to-month, cancel anytime
3. $99/month flat: everything included, no add-ons
4. Works on existing hardware: any iPad, tablet, or browser
5. Price locked to CPI inflation: no arbitrary increases

### Technology Stack
Frontend:
- Framework: React 18 with TypeScript
- Build tool: Vite 5
- Styling: Tailwind CSS 3
- State: Zustand + React Query (TanStack Query v5)
- PWA: vite-plugin-pwa with Workbox
- Charts: Recharts
- Drag/drop: @dnd-kit
- Forms: controlled components + Zod validation at the API boundary

Backend:
- Runtime: Node.js 20
- Framework: Fastify 4
- Language: TypeScript (strict)
- Data access: raw SQL with pg (node-postgres) — no ORM
- Migrations: node-pg-migrate
- Auth: JWT (access 15 min + refresh 30 day)
- Hashing: bcrypt (cost 12 passwords, cost 10 PINs)
- AI: Anthropic Claude API (claude-sonnet-4-6, configurable via CLAUDE_MODEL)

Infrastructure:
- Frontend: Vercel (auto-deploy from main branch)
- Backend: Railway (auto-deploy from main branch)
- Database: PostgreSQL 15 (Railway plugin)
- Cache: Redis 7 (Railway plugin)
- Payments: Stripe Connect
- Email: Nodemailer (configurable SMTP)
- SMS: Twilio (optional)

### URLs
- Production frontend: https://taproot-pos.com
- Production API: https://taproot-production-3d63.up.railway.app
- Admin portal: https://taproot-pos.com/admin
- Kitchen display: https://taproot-pos.com/kitchen
- Customer display: https://taproot-pos.com/display
- Public menu: https://taproot-pos.com/order/[slug]
- Kiosk mode: https://taproot-pos.com/kiosk

---

## 2. AUTHENTICATION SYSTEM

### User Types
1. Organization employees (restaurant staff)
   - Identified by: email + password OR PIN
   - Scoped to: one organization
   - Roles: owner, manager, cashier, kitchen, readonly
   - Token: JWT with orgId, locationIds, role, permissions

2. Taproot admin users (internal team + helpdesk)
   - Identified by: email + password (+ MFA when enabled)
   - Scoped to: ALL organizations (super-admin / support)
   - Roles: super_admin, support, read_only
   - Token: separate admin JWT with an admin `role` claim, signed with
     a SEPARATE secret (ADMIN_JWT_SECRET), distinct issuer/audience

### JWT Token Structure (organization employees)
Access token (15 minutes):
```
{
  sub: employee_id,
  orgId: organization_id,
  locationIds: [location_id, ...],
  role: "owner|manager|cashier|kitchen|readonly",
  permissions: ["order:create", "product:view", ...],
  sessionId: uuid,
  iat, exp,
  iss: "taproot-pos",
  aud: "taproot-api"
}
```

Refresh token (30 days):
```
{ sub: employee_id, sessionId: uuid, iat, exp }
```

### Admin JWT Token Structure
Access token (8 hours):
```
{
  sub: admin_user_id,
  email,
  role: "super_admin|support|read_only",
  sessionId: uuid,
  iat, exp,
  iss: "taproot-admin",
  aud: "taproot-admin-api"
}
```
Admin sessions are also tracked server-side in `admin_sessions` (token hash, expiry,
revoked_at) so a token can be revoked before its 8-hour expiry.

### Permission System
Permissions are additive strings:
```
order:create, order:view, order:void, order:refund
order:discount:apply, order:price:override, order:view:all
inventory:view, inventory:adjust, inventory:count
inventory:transfer, inventory:po:create, inventory:po:receive
inventory:waste:log
product:view, product:create, product:edit, product:delete
recipe:manage
customer:view, customer:create, customer:edit
customer:delete, customer:merge, loyalty:adjust
employee:view, employee:create, employee:edit
employee:delete, employee:sales:view:all
report:view, report:view:basic, report:view:advanced
report:export, report:variance
settings:view, settings:edit, location:manage
discount:manage, tax:manage, import:run
ai:copilot, ai:reports
```

### Role Default Permissions
- owner: ALL permissions
- manager: ALL except employee:delete and tax settings edit
- cashier: order:create, order:view, product:view, customer:view
- kitchen: order:view (kitchen tickets only), product:view
- readonly: order:view:all, report:view:basic

### Auth Endpoints
```
POST /api/v1/auth/login        { email, password }  (org resolved from email; X-Organization-Slug optional)
POST /api/v1/auth/refresh      { refreshToken }
POST /api/v1/auth/logout       { refreshToken }
POST /api/v1/auth/forgot-password   { email }
POST /api/v1/auth/reset-password    { token, newPassword }
POST /api/v1/auth/pin-login    { employeeId, pin, locationId }
POST /api/v1/auth/password/change   { currentPassword, newPassword }  (requires authenticate)
```

### Registration
```
POST /api/v1/register
  Body: { email, password, firstName, lastName, businessName, businessType, partnerCode? }
  Returns: { accessToken, refreshToken, employee, organization, location, trialDays }
```
NOTE: the registration body uses `businessName` + `businessType` (NOT `organizationName`).

---

## 3. ORGANIZATION & MULTI-TENANCY

### Data Model
Every resource belongs to an organization. All queries MUST include an organization_id
filter. Cross-organization data access is a critical security failure. The org id is
taken from the JWT — never trust a client-provided org id.

Organization types:
- independent: standalone restaurant (default)
- franchisor: manages a franchise network
- franchisee: part of a franchise network

### Organization Fields (selected)
```
id (uuid PK), name, slug (unique), plan (trial|starter|growth|enterprise),
plan_expires_at, settings (jsonb — includes dashboardLayout, loyalty, onlineOrdering,
businessProfile, foodCostTargetPct), billing_email, stripe_customer_id,
stripe_subscription_id, subscription_status (trialing|active|past_due|cancelled|unpaid),
subscription_plan, trial_ends_at, stripe_connect_account_id,
stripe_connect_status (not_connected|pending|active), payment_processing_enabled,
parent_org_id, org_type, franchise_code, metadata, deleted_at
```

### Location Fields
Each org has one or more locations:
```
id, organization_id, name, address (jsonb), phone, timezone, currency,
tax_config (jsonb), receipt_config (jsonb), is_active, settings (jsonb)
```

### Tax Configuration
Stored in `locations.tax_config` as JSONB:
```
{ "rates": [ { "name": "Sales Tax", "rate": 0.0825, "included": false, "appliesTo": "all" } ] }
```
`appliesTo` may be all|food|alcohol|merchandise. Default 8.5% if not configured.
Configured at /settings/business → Tax tab. Server-side `calculateTax` reads this JSONB
(there is no `tax_rates` table).

---

## 4. PRODUCT CATALOG

### Product States
Three distinct states (never confuse them):
- ACTIVE:   deleted_at IS NULL AND archived_at IS NULL → visible in POS and admin
- ARCHIVED: deleted_at IS NULL AND archived_at IS NOT NULL → hidden from POS, shown in Inventory → Archived
- DELETED:  deleted_at IS NOT NULL → hidden everywhere (soft delete)

CRITICAL: every POS product query must filter:
`WHERE deleted_at IS NULL AND archived_at IS NULL`

### Product Structure
`products → product_variants → product_prices`
One product can have multiple variants (Small/Medium/Large). Each variant has a price
per location. Price is stored as INTEGER CENTS ($12.99 = 1299).

### Modifier System
`modifier_groups → modifiers`, joined to products via `product_modifier_groups`.
Selection types: single (0 or 1), multiple (any), required_single (exactly 1),
required_multiple (minimum N). `price_delta` is integer cents and may be negative.

### Day-Part Filtering
`products.day_parts varchar(50)[]` with values breakfast|brunch|lunch|dinner.
NULL or empty = visible in ALL day parts (additive rule). Specific values = visible only
when that day part is active.

### Category System
`categories`: id, organization_id, parent_id (optional subcategory), name, color, icon,
sort_order, is_active. Dashboard tile layout is stored in `organizations.settings.dashboardLayout`:
```
{
  "dashboardLayout": {
    "categoryConfigs": [
      { "categoryId": "uuid", "displayOrder": 0, "color": "#1D9E75",
        "icon": "🍔", "isPinned": false, "isHidden": false }
    ],
    "showAllItemsTile": true, "allItemsTileColor": "#1D9E75", "gridColumns": 3
  }
}
```

### Import System
Supported import types:
- document_menu: PDF menu parsed by Claude AI
- generic_csv: CSV with columns name,price,category,description
- migration_square / migration_toast / migration_shopify / migration_lightspeed / migration_clover

Import states: pending → processing → awaiting_confirmation → completed | failed | partial

Price normalization (`normalizeMenuPrice`, documentParser.service.ts): the parser prompt
commands integer cents. Integer values are trusted as cents; only non-integer / `$`-prefixed
/ decimal strings are ×100; negative deltas are preserved (discount modifiers); 0/null is
flagged for review. (This is the BUG-IMP-005-hardened behavior — earlier versions naively
×100'd any value < 100, which corrupted sub-$1 prices and modifier deltas.)

---

## 5. ORDER MANAGEMENT

### Order States
open → in_progress → completed; and voided / refunded / partially_refunded / parked.

### Order Types
in_store, takeout, delivery, table_service, online, phone (NOT "dine_in").

### Order Number Format
`T-[YEAR]-[6-digit-counter]`, e.g. `T-2026-000001`, generated by a database trigger.

### Order Line Items (`order_line_items`)
productId, variantId, name, sku, quantity, unitPrice (cents), costPrice (cents),
discountAmount (cents), taxAmount (cents), total (cents), modifiers (jsonb array),
notes, voided_at, void_reason. Modifiers JSONB:
```
[{ "groupId": "uuid", "groupName": "Burger Options", "modifierId": "uuid",
   "name": "Add Cheese", "priceDelta": 150 }]
```

### Payment Methods
cash, credit_card, debit_card, apple_pay, google_pay, gift_card, account_credit, check, other.

### Tax Calculation
At order creation: read location tax_config → apply each rate to applicable items → sum →
`orders.tax_total`. If tax_config missing, default 8.5%.

### Void Rules
Only completed orders can be voided; reason required. Card payments → Stripe refund initiated
automatically; cash → no Stripe call. Audit log entry `order.voided` created.

### Refund Rules
Full or partial (by amount or by line item). Card → Stripe refund for the exact amount;
updates `payments.refunded_amount`; order status → refunded | partially_refunded.

---

## 6. PAYMENT PROCESSING

### Stripe Connect
Each restaurant has their own Stripe account; Taproot is the platform. Stripe processes
in-person payments (2.7% + $0.05 typical). Online orders use a Connect direct charge with an
application fee.

### Payment Flow
1. Order created with items and totals
2. Optional tip selection
3. Payment method selected
4. Cash: change calculated, order completed
5. Card: Stripe Payment Intent created and confirmed
6. Receipt snapshot set as `lastCompletedOrder` in pos.store
7. Navigate to /receipt
8. Kitchen ticket printed (thermal if a print server is configured, else browser)

### Stripe Terminal
Hardware readers (WisePOS E, WisePad 3) over WiFi/Bluetooth via the Stripe Terminal SDK.
Card path requires Stripe Connect + a publishable key; pay-at-counter is the always-available path.

### Receipt Storage
`lastCompletedOrder` lives in the Zustand pos.store and is NOT persisted to localStorage
(session only). It must be set BEFORE navigating to /receipt and cleared only on "New Order".
`GET /api/v1/orders/:id/receipt` provides full receipt data as a fallback / enrichment source.

---

## 7. INVENTORY SYSTEM

### Inventory Levels
`inventory_levels`: quantity_on_hand, quantity_on_order, reorder_point, reorder_quantity,
max_stock_level. Updated by a DB trigger on INSERT into `inventory_movements`.

### Movement Types
sale, return, waste, adjustment, transfer_in, transfer_out, po_receipt, opening_count, cycle_count.

### Recipe Engine
`recipes → recipe_lines`. Each recipe line: ingredient product + quantity + unit + waste_factor.
Recipes are keyed by product_id and carry yield_factor, version, is_active, deleted_at.

### Variance Reports
`variance_reports → variance_report_lines` compare theoretical vs actual usage and flag
items with > 10% variance; AI can suggest root causes.

---

## 8. CUSTOMER & LOYALTY

### Customer Profile
first/last name, email, phone, loyalty_points, loyalty_tier, account_credit, total_spend,
visit_count, last_visit_at, allergens (varchar[]), marketing_opt_in.
Tiers: none → bronze → silver → gold → platinum.

### Points System (`organizations.settings.loyalty`)
```
{ "enabled": true, "pointsPerDollar": 1, "redeemRate": 0.01, "minimumRedemption": 100,
  "tiers": { "none": 0, "bronze": 100, "silver": 500, "gold": 1000, "platinum": 2000 } }
```
Points earned automatically on order completion when a customer is attached (non-fatal —
never blocks payment).

### Gift Cards
`gift_cards` (code, balance, expiry) sold and redeemed at the POS; `gift_card_transactions`
for history. The gift_card payment method validates and deducts balance; refunds restore it.

---

## 9. AI FEATURES

### Claude API Integration
Model: claude-sonnet-4-6 (config.CLAUDE_MODEL). All AI calls are cached in Redis (TTL 4h
for most, 1h for daily intelligence / suggested questions). Graceful degradation is
structural: every Claude call returns null on missing key / parse error / API failure and
falls back to a deterministic estimate or a friendly "AI insights temporarily unavailable".

### Menu Import AI (documentParser.service.ts)
Input PDF/CSV → Claude extracts structured menu → `ParsedMenu { items: [{name, price (cents),
category, description}] }`.

### Demand Forecasting (aiForecast.service.ts / forecast.service.ts)
90 days of history grouped by day-of-week → Claude predicts next-day revenue range, top items,
prep recommendations, confidence. Statistical fallback (±20% band, confidence ≤ 0.5) with
< 7 days history or no key.

### Menu Engineering (analytics.getMenuInsights)
2×2 matrix: Stars (promote), Plowhorses (reprice), Puzzles (reposition), Dogs (archive),
with per-item AI recommendations and quick wins.

### Daily Intelligence Feed (intelligence.service.ts)
Yesterday vs last week, today's forecast + prep checklist, alerts, reorder ETAs, one AI
insight. Cache TTL 1h. Owner landing view, dismissible per day.

### AI Copilot
`POST /api/v1/ai/query` — natural-language questions over sales data → answer text + optional
chart/table data + a suggested action. Context-aware suggested questions via
`GET /api/v1/ai/suggested-questions`.

### Staff Scheduling (scheduling.service.ts)
Demand forecast + roster + hourly rates → suggested weekly schedule optimized toward a 30%
labor target, with a deterministic round-robin fallback.

### Food Cost Intelligence (foodCost.service.ts)
Theoretical plate cost per product from recipes; status vs org target (default 30%);
batched AI fix suggestions + deterministic price-for-target fallback.

---

## 10. TABLE SERVICE

### Tables
`tables`: name, section, seats, position_x, position_y, shape, width, height, is_active.
Floor plan editor at /settings/floor-plan; Table view toggle in the POS.

### QR Code Ordering
Public, no-auth routes: `GET /public/:slug/menu`, `POST /public/:slug/order`,
`GET /public/:slug/order/:id/status`. QR codes generated in Settings → QR Codes;
format `taproot-pos.com/order/[slug]/table/[id]`.

### Kitchen Display System
`/kitchen` (auth within org). Polls `GET /api/v1/kitchen/tickets` every 5s. Item ready:
`PATCH /api/v1/kitchen/items/:id/ready`. Order bump: `PATCH /api/v1/kitchen/orders/:id/bump`.
Kitchen state stored in `orders.metadata.kitchen` (no migration).

### Reservations & Waitlist
`reservations`: customer_name, party_size, phone, type (reservation|waitlist), reserved_for,
table_id, status, notes, notified_at. Status: waiting → notified → arrived → seated | no_show | cancelled.

---

## 11. REPORTING & ANALYTICS

### Available Reports / Endpoints
```
End of Day:           GET /api/v1/reports/end-of-day?date=&location_id=&timezone=
Sales / Tips / etc.:  GET /api/v1/reports/sales, /tips, /top-products, /employee-perf,
                          /payment-methods, /hourly-heatmap, /dashboard
Food Cost:            GET /api/v1/analytics/food-cost (+/summary)
Menu Engineering:     GET /api/v1/analytics/menu-engineering, /menu-insights
Cohort / Staff:       GET /api/v1/analytics/cohort, /staff-performance
Peak Hours:           GET /api/v1/analytics/peak-hours
Customer Insights:    GET /api/v1/analytics/customer-insights
AI Forecast:          GET /api/v1/ai/forecast?date=YYYY-MM-DD&locationId=
```
Reports also accept a `locationId` to scope to one location (omit = org-wide).

---

## 12. SECURITY ARCHITECTURE

### Authentication Security
- JWT HS256; 15-minute access, 30-day refresh; algorithm allowlist enforced
- bcrypt cost 12 (passwords), cost 10 (PINs)
- Refresh-token ROTATION on every refresh; reuse → theft detection (revokes ALL sessions, critical alert)
- DB-backed token revocation checked on every refresh
- Account lockout: failed attempts → 30-min lockout (PCI 8.3.4); brute-force detector (5 org failures/5 min → deduped alert)
- Concurrent session cap: 5 per employee (oldest revoked)
- Enumeration-resistant login (generic 401), HTTPS redirect, boot-time fail-secure assertions

### Rate Limiting (representative; see lib/rateLimit.ts)
- Login: 5 attempts / 15 min, Register: 5 / hour, Password reset: 3 / hour
- AI endpoints throttled per org; global limiter ~200/min per IP/org; 429 emitted as an abuse signal

### HTTP Security (Helmet)
CSP (with Stripe/Plausible allowances on web; frame-src 'none' on the JSON API), X-Frame-Options:
DENY, X-Content-Type-Options: nosniff, HSTS (1 year), Referrer-Policy: strict-origin-when-cross-origin,
X-Permitted-Cross-Domain-Policies, fingerprint removal.

### PCI DSS Compliance
Card data is NEVER stored — Stripe handles it. Only last4, brand, and the Stripe payment intent
id are stored. Scope: SAQ A (minimal via Stripe). All financial events audit-logged (Req 10).

### Multi-Tenant Isolation
Every query MUST filter by organization_id (taken from the JWT). Cross-org access = critical
failure. (Known low-severity defense-in-depth follow-up: SEC-ORG-001 — a few by-UUID child
lookups don't yet add a redundant org filter; parents are org-validated and UUIDs unguessable.)

### Input Validation
Zod schemas at route handlers; sanitization helpers (stripHtml/escape/safe-redirect);
parameterized SQL only (no string concatenation).

### Admin Portal Security
Admin auth is fully separate from org auth: separate users table (`admin_users`), separate
secret (ADMIN_JWT_SECRET), separate issuer/audience, separate server-side sessions
(`admin_sessions`, revocable). Impersonation issues a short-lived (1h) org token and is logged
to `admin_impersonation_log`. Admin actions on orgs are written to `audit_logs`.

---

## 13. DATABASE SCHEMA

### Core Tables
organizations, locations, employees, refresh_tokens, password_reset_tokens,
mfa_backup_codes, partner_codes

### Product Tables
products, product_variants, product_prices, categories, suppliers, modifier_groups,
modifiers, product_modifier_groups, recipes, recipe_lines

### Order Tables
orders, order_line_items, payments, applied_discounts, discounts

### Inventory Tables
inventory_levels, inventory_movements, purchase_orders, purchase_order_lines,
variance_reports, variance_report_lines

### Customer Tables
customers, loyalty_transactions, gift_cards, gift_card_transactions

### Operations Tables
tables, reservations, cash_drawer_sessions, cash_drops, time_clock_entries, schedules

### Import / API / Admin Tables
import_jobs · api_keys, webhooks · admin_users, admin_sessions, admin_impersonation_log,
helpdesk_tickets, helpdesk_messages

### Audit
`audit_logs` — partitioned by month (36 monthly partitions 2025-01..2027-12 + default),
INSERT-only. `actor_type` CHECK is `('employee','system','api')` — admin-originated entries
use actor_type 'system' with the admin id in actor_id/metadata.

### Applied Migrations (001–021)
```
001 Initial schema           012 Product archive
002 Seed data                013 Org settings (settings jsonb)
003 Password reset tokens     014 Employee hourly rate
004 MFA backup codes          015 Cash drawer sessions
005 Stripe Connect columns    016 Reservations
006 Customer search (pg_trgm) 017 Franchise mode columns
007 DB security roles         018 API keys + webhooks
008 Demo data enrichment      019 Allergens
009 Subscriptions             020 Performance indexes
010 Partner codes             021 Time clock + schedules
011 Day parts
```

### Pending Migrations (run in Railway console)
```
022 Admin users + helpdesk (admin_users, admin_sessions, admin_impersonation_log,
    helpdesk_tickets, helpdesk_messages)
```
Run: `npx node-pg-migrate up --migrations-dir migrations`

---

## 14. API REFERENCE

### Base URL & Headers
Base: https://taproot-production-3d63.up.railway.app
Headers: `Authorization: Bearer {accessToken}` (org slug resolved from token/email).

### Standard Response Format
Success: `{ data }` or an array. Error: `{ statusCode, code, message, errors? }`.

### Common Error Codes
VALIDATION_ERROR 400 · UNAUTHORIZED 401 · FORBIDDEN 403 · NOT_FOUND 404 · CONFLICT 409 ·
TOO_MANY_ATTEMPTS 429 · ACCOUNT_LOCKED 423.

### Products API
```
GET    /api/v1/products            ?locationId&search&categoryId&dayPart&page&limit
POST   /api/v1/products            { name, description, categoryId, price (cents), sku, trackInventory, dayParts, isActive }
PATCH  /api/v1/products/:id        any product fields
DELETE /api/v1/products/:id        soft delete
POST   /api/v1/products/:id/archive   { reason? }
POST   /api/v1/products/:id/restore
GET    /api/v1/products/archived
```

### Orders API
```
GET    /api/v1/orders                                          ?locationId&status&employeeId&from&to&search&page
                                                               (org-wide history — read only)
POST   /api/v1/locations/:locationId/orders                    { orderType, tableId?, lineItems[], notes? }
                                                               (locationId is in the PATH, not the body)
GET    /api/v1/locations/:locationId/orders/:orderId
PATCH  /api/v1/locations/:locationId/orders/:orderId           { lineItemsToAdd?, lineItemsToVoid?, ... }
POST   /api/v1/locations/:locationId/orders/:orderId/payments  { paymentMethod, amount, tipAmount }
POST   /api/v1/orders/:id/void                                 { reason }
POST   /api/v1/orders/:id/refund                               { type, amount?, lineItemIds?, reason }
GET    /api/v1/locations/:locationId/orders/:orderId/receipt
```
`lineItems` entries: `{ productId, variantId?, quantity, unitPriceOverride?, notes?, modifiers? }`
— the field is **`lineItems`** (not `items`); unit price is resolved server-side from the
product unless `unitPriceOverride` is supplied. `orders.source` has a CHECK constraint
(use the default; arbitrary values are rejected).

> **Common issue — `POST /api/v1/orders` returns 404.** There is no org-level create-order
> route; `/api/v1/orders` is GET-only (history). Create orders at the location-scoped path
> `POST /api/v1/locations/:locationId/orders`, and record payments at
> `POST /api/v1/locations/:locationId/orders/:orderId/payments`.

### Settings API
```
GET/PATCH /api/v1/settings/business
GET/PATCH /api/v1/settings/dashboard-layout
GET/PATCH /api/v1/settings/loyalty
GET/PATCH /api/v1/settings/online-ordering
GET/PATCH /api/v1/settings/tax
```

### AI API
```
GET  /api/v1/ai/forecast?date=&locationId=
GET  /api/v1/ai/daily-intelligence?locationId=
GET  /api/v1/ai/schedule-suggestion?week=&locationId=
GET  /api/v1/ai/suggested-questions
POST /api/v1/ai/query              { query, locationId, history? }
```

### Admin API (Taproot internal only — separate admin JWT)
```
POST  /api/v1/admin/auth/login                          { email, password }
POST  /api/v1/admin/auth/logout
GET   /api/v1/admin/organizations                       ?search&status&plan&page&limit
GET   /api/v1/admin/organizations/:id
PATCH /api/v1/admin/organizations/:id                   (super_admin, support)
POST  /api/v1/admin/organizations/:id/impersonate       { reason }  (super_admin)
GET   /api/v1/admin/metrics
POST  /api/v1/admin/helpdesk/query                      { query, orgId?, history? }
GET   /api/v1/admin/helpdesk/tickets                    ?status
```

---

## 15. COMMON ISSUES & SOLUTIONS

### Login fails with CORS error
Cause: origin not in the CORS allowlist. Fix: add the origin to CORS_ORIGINS in Railway;
note `taproot-pos.com` / `www.taproot-pos.com` are also hardcoded in index.ts. If auth "works
via curl but not on the live site", suspect the frontend `VITE_API_URL` or a stale PWA service
worker before the backend.

### Products show $0.00 price
Cause 1: import price in the wrong format → `normalizeMenuPrice` now trusts integer cents.
Cause 2: `product_prices` record missing → `createProduct()` creates a variant + active price
in one transaction (older import bugs inserted a variant without organization_id and left items
priceless — BUG-IMP-004/005, resolved).

### Import completes but products don't appear
Cause: missing `case` for the import type in `confirmImportJob`, or a manual variant insert that
omitted organization_id. Fix: ensure `createProduct()` is used (creates variant + price with
org_id); `ImportReview` invalidates the products/categories caches so the POS updates immediately.

### Payment crashes with "undefined length"
Cause: `item.modifiers` undefined on a cart line. Fix: `(item.modifiers ?? []).map(...)`;
selectedModifiers defaults to [] in pos.store (BUG-PAY-001, resolved).

### Tax rate still shows 8.5% after changing it
Cause: tax_config not saved. Fix: PATCH /settings/tax writes `locations.tax_config`; clear the
React Query cache after save; POS reads the live rate via setPosTaxRate.

### Modifier sheet doesn't appear on product tap
Cause: modifierGroups missing from the products response. Fix: `buildProductWithRelations()`
JOINs modifier groups; products list includes a modifierGroups array.

### Kitchen display shows no orders
Cause: order not in an open/in_progress state. Fix: check order status after payment; kitchen
polls `GET /api/v1/kitchen/tickets`.

### Receipt page empty after payment
Cause: `lastCompletedOrder` cleared before render. Fix: it is NOT persisted; set it in pos.store
BEFORE navigating to /receipt; clear only on "New Order".

### QR ordering fails
Cause: public route behind auth. Fix: `/public/*` must NOT have the authenticate middleware
(keys are in PUBLIC_ROUTES, registered before the auth plugin); verify OPTIONS preflight CORS.

### Account locked
Cause: too many failed logins. Fix (admin): clear `failed_login_attempts` and `locked_until` on
the employee row. Fix (user): wait 30 minutes or contact a manager.

### Import hangs at "Processing"
Cause: Claude timeout or invalid key. Fix: check ANTHROPIC_API_KEY in Railway and
status.anthropic.com; imports time out and surface an error.

### Stripe payment fails
Cause 1: Stripe not connected → owner completes Stripe Connect at /settings/payments.
Cause 2: keys missing → check STRIPE_SECRET_KEY. Cause 3: test keys in production → use live keys.

### Reports show no data
Need ≥ 1 completed order for basic reports, 7+ days for trends, 30+ days for AI forecasting.

---

## 16. ENVIRONMENT VARIABLES

### Required (backend)
DATABASE_URL, REDIS_URL (Railway injects both), JWT_SECRET (≥ 64 chars in prod),
JWT_REFRESH_SECRET, STRIPE_SECRET_KEY, ANTHROPIC_API_KEY, CORS_ORIGINS, NODE_ENV.
ADMIN_JWT_SECRET — secret for the admin portal JWT (falls back to `JWT_SECRET + '_admin'`
if unset; set explicitly in production: `openssl rand -base64 32`).

### Optional (backend)
STRIPE_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID / AUTH_TOKEN / PHONE_NUMBER, SENDGRID_API_KEY or
SMTP_HOST/PORT/USER/PASS, CLAUDE_MODEL (default claude-sonnet-4-6).

### Required (frontend, Vercel)
VITE_API_URL = https://taproot-production-3d63.up.railway.app,
VITE_STRIPE_PUBLISHABLE_KEY. Optional: VITE_PLAUSIBLE_DOMAIN.

---

## 17. DEPLOYMENT

### Railway (Backend)
Auto-deploys on push to main. Build: install (incl. dev) → build @taproot/shared → build
@taproot/api. Start: `node apps/api/dist/index.js` (cwd = repo root, so `docs/TECH_SPEC.md`
resolves for the helpdesk).

### Vercel (Frontend)
Auto-deploys on push to main. Root apps/web, build `npm run build`, output dist.

### Migrations
After a deploy that includes migrations, run in the Railway console:
`npx node-pg-migrate up --migrations-dir migrations`

### Health Check
`GET /api/health` → `{ status, version, checks: {database, redis, stripe}, uptime }`.

---

## 18. MONITORING & OBSERVABILITY

Structured JSON logs to Railway stdout. Plausible analytics (privacy-friendly) with custom
events (Trial Started, Demo Login, Menu Import Started/Complete, Payment Completed, AI Forecast
Viewed). Sentry initialized. All financial events → `audit_logs` (partitioned, INSERT-only,
3-year retention per PCI).

---

## 19. SUPPORT ESCALATION MATRIX

- Tier 1 (Helpdesk AI handles automatically): login issues, menu import questions, how-to,
  price display issues, basic settings.
- Tier 2 (human helpdesk with admin portal): Stripe connection issues, payment failures needing
  investigation, data issues needing a DB query, account suspension/reactivation, billing disputes.
- Tier 3 (engineering escalation): production 500s, data corruption, security incidents,
  performance degradation, reproducible feature bugs.
- Emergency: payment processing fully down, suspected data breach, cross-tenant data exposure,
  database unreachable.
