# v2.1 Member + Studio Catalog — Sandbox Review Notes

> **Branch:** `feat/v2.1-member-catalog` (off `feat/v2-capabilities`) · **LOCAL ONLY —
> never pushed.** Migration 033 written, **NOT run.** Boot path (`apps/api/src/index.ts`),
> content-type parsers, and `payment.service`/`order.service`/`product.service` cores
> **untouched.** tsc 0 both apps; lint 0 errors. Everything is gated behind
> `capabilities.studio` — restaurants see ZERO change.

Builds the member identity + sellable studio catalog + credit ledger from
`docs/ROADMAP.md` (v2.1) and `docs/STUDIO_MODULE_SPEC.md` (§3.1/§3.2/§3.5). It reuses
the hardened checkout (studio items are just products) and the WG-006 atomic pattern
(credit ledger). No new payment logic.

## 1. Schema (migration 033) + rationale
- **members** — studio identity that EXTENDS customers via optional `customer_id`
  (unified retail+class identity, or stand-alone). status enum
  (prospect/active/frozen/cancelled/lead, CHECK), waiver fields, home_location_id,
  tags, soft-delete. Mirrors the customers table shape.
- **member_credits** — the burn-down ledger. Integer COUNTS (not money):
  credits_total / credits_remaining, expiry, source_catalog_item_id, `source_ref`
  (idempotency anchor). DB CHECK `credits_remaining BETWEEN 0 AND credits_total` is a
  backstop against ever going negative.
- **member_subscriptions** — MANUAL mode only: `managed_externally` DEFAULT true,
  state enum (active/frozen/cancelled). No gateway_ref/dunning (that's v2.5).
- **products.item_type** (varchar DEFAULT `'food'`) + **studio_meta** (jsonb): catalog
  extension on the EXISTING products table. A separate `item_type` axis was added
  rather than overloading the existing `product_type` (standard/recipe/…); every
  existing product defaults to `'food'`, unchanged. CHECK added idempotently via DO-block.

### studio_meta shapes (by item_type)
- **membership**: `{ billing_interval, price_cents, included_credits|"unlimited", booking_window_hrs, freeze_policy_id, commitment }`
- **class_pack**: `{ credit_count, expiry_days, shareable, transferable }`
- **drop_in**: `{ credits_required }` (normal priced item; 1 visit)
- **add_on**: `{ fulfillment:"bar"|"retail"|"none", redeem_at:"checkin"|"prebook" }`

## 2. Files created / changed
**New (9):**
- `migrations/033_member_catalog.js` — tables + products columns. **NOT run.**
- `apps/api/src/services/member.service.ts` — member CRUD + waiver (mirrors customer.service).
- `apps/api/src/services/memberCredit.service.ts` — grant (idempotent) + atomic deduct + balance.
- `apps/api/src/services/studioCatalog.service.ts` — studio items as products (+ variant + price).
- `apps/api/src/services/memberSubscription.service.ts` — manual subscriptions CRUD.
- `apps/api/src/routes/member.routes.ts` — members/waiver/credits/subscriptions. **NOT wired.**
- `apps/api/src/routes/studioCatalog.routes.ts` — studio catalog CRUD. **NOT wired.**
- `apps/web/src/pages/MembersPage.tsx` — list + drawer (credits/subs/waiver) + modal.
- `apps/web/src/pages/StudioCatalogPage.tsx` — studio item list + editor.

**Changed (5, all additive):**
- `packages/shared/src/types/index.ts` — Member/MemberCredit/MemberSubscription/StudioCatalogItem types (rebuilt gitignored dist for api tsc).
- `apps/web/src/lib/api.ts` — `members` + `studioCatalog` clients + type imports.
- `apps/web/src/hooks/useCapabilities.ts` — added `useRequireStudio()` page guard.
- `apps/web/src/components/layout/POSLayout.tsx` — 2 studio nav items (`cap:'studio'`) replacing the v2.0 seam + 2 icon imports.
- `apps/web/src/App.tsx` — imports + `/studio/members` + `/studio/catalog` routes.

## 3. How studio-gating protects restaurants (fail-safe, 3 layers)
1. **UI nav gate** (v2.0): nav items carry `cap:'studio'`; the POSLayout filter hides
   them unless `capabilities.studio` is on. `useCapabilities` fails open to defaults
   (studio:false) — so a restaurant (or any fetch failure) never shows studio nav.
2. **Page guard**: `useRequireStudio()` bounces a non-studio org that hits a studio URL
   directly back to the register (after caps load, so a studio org isn't bounced early).
3. **API gate**: every studio route is double-gated — `requireManager` + a 404 when
   `hasCapability('studio')` is false. A restaurant calling these gets a clean 404.
Plus: every service graceful-guards its new table/column (to_regclass /
information_schema), so the branch is safe even BEFORE migration 033 runs.

## 4. Credit ledger — atomic, mirrors WG-006 / WG-012
- **deductCredit**: inside a transaction, the oldest usable pack is `SELECT … FOR UPDATE`
  then decremented with `UPDATE … WHERE credits_remaining >= $n` — 0 affected rows ⇒
  `Insufficient credits`. Concurrent deducts can NEVER drive a balance negative (row
  lock + conditional update + DB CHECK backstop). This is the WG-006 account_credit
  pattern generalized to multi-pack ledgers.
- **grantCredits**: `ON CONFLICT (organization_id, source_ref) DO NOTHING` when a
  `sourceRef` (e.g. order id) is supplied ⇒ a retried grant-on-checkout never
  double-credits (WG-012-style idempotency). Manual grants (no sourceRef) always insert.

## 5. Migration 033 — two-step Railway run (IF approved)
**STEP 1 — apply** (Railway → Postgres → Data): run `exports.up` from
`migrations/033_member_catalog.js` (creates members/member_credits/member_subscriptions
+ adds products.item_type/studio_meta; all `IF NOT EXISTS`, idempotent). Then:
```sql
INSERT INTO pgmigrations (name, run_on) VALUES ('033_member_catalog', now()) ON CONFLICT DO NOTHING;
```
(Alt: `npx node-pg-migrate up` — would also run any earlier unrun migration, e.g. 031/032.)
**STEP 2 — verify:**
```sql
SELECT to_regclass('public.members'), to_regclass('public.member_credits'), to_regclass('public.member_subscriptions');
SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name IN ('item_type','studio_meta');
SELECT count(*) FROM products WHERE item_type <> 'food';  -- 0 until studio items are created
```

## 6. Seams left (wire supervised later)
- **Route registration** (2 files; boot path untouched):
  ```ts
  import memberRoutes from './routes/member.routes';
  import studioCatalogRoutes from './routes/studioCatalog.routes';
  await fastify.register(memberRoutes);
  await fastify.register(studioCatalogRoutes);
  ```
- **Auto-grant-on-checkout**: buying a class_pack should call `grantCredits(... sourceRef:orderId)`.
  Wiring that needs an order-completion hook in payment/order (core, off-limits this turn),
  so v2.1 exposes `grantCredits` as a manual action + the idempotent `source_ref` anchor;
  auto-grant lands in v2.2 alongside the checkout/booking integration.
- **Auto-deduct at check-in**: `deductCredit` is ready; the check-in trigger is v2.2 (scheduling).

## 7. Risk assessment
**Effect on existing behavior: none.** No core file touched (boot/payment/order/product).
New tables + a default-`'food'` column don't alter any existing query. All UI is
studio-gated and fails open to "restaurant". Routes are unwired (404) and services
graceful-guard their tables, so the branch is inert for restaurants and safe pre-migration.
**Look hardest at:** the deductCredit atomicity (FOR UPDATE + conditional), the products
ALTER default/CHECK, and the studio-gate on every route.

## 8. How to test locally
1. `npm run build --workspace=@taproot/shared`; `tsc --noEmit` both apps → 0.
2. Full path (local dev DB): wire the 2 route files into a LOCAL index.ts (don't commit),
   run migration 033 on a LOCAL DB, set the org `capabilities.studio=true` (v2.0 settings
   page or SQL), then Members + Studio nav appear; create a member, grant/deduct credits,
   create a class pack, record a manual membership.
3. Restaurant check: with studio off, confirm NO members/studio nav appears and
   `/studio/members` redirects to the register.

## 9. NOT done (deliberate — later versions)
- Scheduling / classes / reservations / check-in → **v2.2**.
- Mindbody / Mariana Tek migration importers → **v2.2**.
- Taproot-native recurring membership billing (charging, dunning) → **v2.5** (v2.1 is MANUAL).
- Auto grant-on-checkout / auto deduct-at-checkin wiring (needs order/scheduling hooks).
- Route wiring into index.ts; running migration 033.
