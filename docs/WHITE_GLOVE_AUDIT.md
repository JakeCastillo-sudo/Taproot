# Taproot White Glove Audit — 2026-06-19

> Read-only comprehensive audit across 9 layers (security, reliability, correctness,
> consistency, performance, dead code, web, mobile, docs). No source code was changed.
> Every finding below is documentation only — proposed fixes are described, never applied.
> The headline P0/P1 findings were verified directly against the source by the auditor.

---

## Executive Summary

**Overall codebase health.** This is a genuinely mature, well-structured codebase for a
solo/small-team product. The fundamentals are strong: multi-tenant scoping is applied almost
everywhere via `organization_id`, SQL is parameterized throughout (zero injection found), the
global error handler is production-safe (no stack/PG-internal leakage in prod), rate limiting is
broad and sensibly tiered, secrets come from env, money is integer cents at rest, and there is a
real feature-flag + graceful-degradation discipline (AI, email, Stripe ghost mode). The order
state machine for purchase orders is solid, order-number generation is concurrency-safe via a DB
trigger, and the transactional spine of order creation/void/merge/split is correct.

**But it is not yet safe for real money.** The audit found a small cluster of **payment and
order-lifecycle defects that can lose or duplicate money** — and these are exactly the class of
bug that a "security certified, 0 crit / 0 high" OWASP/PCI pass does not catch, because they are
business-logic correctness issues, not classic vulnerabilities. The single most dangerous is
**WG-003**: the location-scoped void endpoint voids a *paid* order without reversing the charge —
the customer keeps nothing, the merchant keeps the money, the order shows voided. Close behind are
**WG-002** (no idempotency on payment → concurrent/retried charges double-bill) and **WG-001**
(Stripe charge succeeds but the DB write fails → money taken, order not recorded, manual-only
recovery). None of these are theoretical; all three were read and confirmed in source.

**Total findings: 71**
**P0: 3 · P1: 14 · P2: 22 · P3: 32**

**Top 5 to fix before the first paying customer:**
1. **WG-003** — Voiding a *paid* order via the location route keeps the customer's money (no refund). **P0**
2. **WG-002** — No idempotency on `processPayment` → double-tap / retry / concurrent = double charge. **P0**
3. **WG-001** — Stripe charged but DB write fails → no order, no payment row, no auto-recovery. **P0**
4. **WG-005** — Walk-in (no-customer) orders never reach `completed`, so a second full payment is accepted → double charge. **P1**
5. **WG-004** — `ORDER_PRICE_OVERRIDE` permission is defined but never enforced; any cashier can set arbitrary line-item prices (incl. 0 / negative). **P1**

**What's GOOD about this codebase (be fair):**
- **Multi-tenant isolation is real and consistent.** Of dozens of by-UUID lookups reviewed, only
  one is a genuine cross-tenant gap (WG-018, and it's because the `modifiers` table has no
  `organization_id` column, not because the pattern was forgotten). The other "gaps" are
  defense-in-depth on unguessable UUIDs with org-checked parents.
- **Zero SQL injection.** Every dynamic query uses bound parameters; dynamic `SET`/`WHERE`/`ORDER BY`
  fragments are allowlist-validated.
- **Production-safe error handling.** `errorHandler.ts` hides stacks and Postgres internals in prod
  and maps to generic messages; logger serializers omit auth headers and bodies.
- **Strong rate-limit coverage** with stricter-than-spec login/MFA/reset limits; SSRF surface
  (url-fetch) is rate-capped at 5/min.
- **Concurrency-safe order numbers** (DB trigger upsert-returning) and correct transaction
  boundaries on order create/void/merge/split (with `FOR UPDATE` and deadlock-ordered locking on merge).
- **Graceful degradation** is structural (AI/email/Stripe all degrade rather than crash).
- **Stripe inbound webhooks** are done correctly: raw-buffer signature verification + Redis
  idempotency (72h). The mobile Stripe placeholder guard correctly disables card payments.

**Biggest risks if launched as-is:**
- **Money loss / double-billing** on the core payment + void paths (WG-001/002/003/005/006/013).
  These will surface on day one of real card traffic.
- **Silent inventory drift** — deduction is fire-and-forget, non-idempotent, and only runs on
  customer-attached completed orders (WG-011/012; and WG-058: legacy `inventory_levels` products
  are never auto-depleted on sale at all).
- **Unauthenticated forged delivery orders** (WG-021) and dropped delivery orders (WG-009) once
  DoorDash/Uber Eats are connected.
- **Operational launch blockers** outside code: default admin password still seeded (WG-024),
  mobile EAS/Apple credentials are placeholders (WG-017), and the pre-production checklist (live
  Stripe key, secret rotation) is still open per BACKLOG.md.

---

## Findings Index

| WG-ID | Sev | Layer | Title |
|---|---|---|---|
| WG-001 | P0 | Reliability | Stripe charge succeeds but DB write fails → money taken, no order, manual-only recovery |
| WG-002 | P0 | Reliability | No idempotency on `processPayment` → double-tap / retry / concurrent double charge |
| WG-003 | P0 | Correctness | Location-route void of a *paid* order keeps the customer's money (no refund) |
| WG-004 | P1 | Security | `ORDER_PRICE_OVERRIDE` defined but never enforced — cashier price tampering |
| WG-005 | P1 | Correctness | Walk-in orders never reach `completed`; second full payment accepted → double charge; also pay-after-refund |
| WG-006 | P1 | Correctness | Gift-card / account-credit double-spend (balance checked outside txn, no row lock) |
| WG-007 | P1 | Correctness | Recipe yield/waste division has no null/zero guard → NaN/Infinity into inventory & variance |
| WG-008 | P1 | Correctness | Archived products/variants can be sold (order create never filters `archived_at`) |
| WG-009 | P1 | Reliability | Delivery webhook acks 200 then creates order fire-and-forget → orders silently dropped |
| WG-010 | P1 | Reliability | Delivery webhook idempotency is check-then-insert with no unique constraint → duplicate orders |
| WG-011 | P1 | Reliability | Inventory deduction is fire-and-forget with no retry/alert → silent stock drift |
| WG-012 | P1 | Reliability | Inventory deduction is not idempotent → any retry double-deducts |
| WG-013 | P1 | Reliability | `refundPayment` DB writes are not transactional → double-refund / Stripe-DB divergence |
| WG-014 | P1 | Performance | `listProducts` N+1 (~6 queries/product) on the primary POS load |
| WG-015 | P1 | Performance | `resolveLineItems` issues 2-4 queries per line item on order create/update |
| WG-016 | P1 | Dead code | Customer email addresses (PII) logged to stdout via `console.log` |
| WG-017 | P1 | Mobile | EAS projectId + Apple submit creds are `REPLACE_WITH_*` → build/submit blocked (launch) |
| WG-018 | P2 | Security | Order line-item modifier lookup not org-scoped → cross-tenant read + price influence |
| WG-019 | P2 | Security | Public payment confirm doesn't bind the PaymentIntent to the order/amount |
| WG-020 | P2 | Security | Delivery webhook HMAC verified against re-stringified body, not raw bytes |
| WG-021 | P2 | Security | Delivery webhook accepts unverified payloads (creates orders) when no secret configured |
| WG-022 | P2 | Security | Shopify migration connector SSRF via user-supplied `shopDomain` |
| WG-023 | P2 | Security | `urlFetch` SSRF guard is hostname-pattern-only (DNS rebinding / redirect bypass) |
| WG-024 | P2 | Security | Hardcoded default super-admin password seeded on boot |
| WG-025 | P2 | Correctness | Weighted-average cost stores fractional cents into `cost_price` |
| WG-026 | P2 | Correctness | Split-order tax/discount rounding drift (no remainder reconciliation) |
| WG-027 | P2 | Correctness | `foodCost` plate cost silently drops lines with NULL `waste_factor`/`cost_price` |
| WG-028 | P2 | Reliability | Offline-queue Redis push swallowed → payment recorded `offline_queued` but never charged |
| WG-029 | P2 | Performance | `listOrderHistory` correlated subqueries per row (item_count + payment_methods) |
| WG-030 | P2 | Performance | No partial index supports the KDS open-orders query (5s poll) |
| WG-031 | P2 | Performance | `order_line_items(order_id)` not partial on `voided_at` |
| WG-032 | P2 | Consistency | Error response shape inconsistent; `delivery.routes.ts:87` returns only `{error}` |
| WG-033 | P2 | Consistency | Response casing inconsistent — ingredient/product snake_case vs order/customer camelCase |
| WG-034 | P2 | Web | Query errors render as blank/stuck screens (`throwOnError` unset, no `isError` branch) |
| WG-035 | P2 | Web | JWT access + refresh tokens and user PII in `localStorage` |
| WG-036 | P2 | Mobile | EAS has no `env` wiring; gitignored `.env.production` won't reach production builds |
| WG-037 | P2 | Mobile | `KitchenScreen` has no error state → shows "No tickets" on API failure |
| WG-038 | P2 | Mobile | `OrderDetailModal` maps `r.lineItems`/`li.modifiers`/`r.payments` with no `?? []` → crash |
| WG-039 | P2 | Docs | "Security certified 0 crit/0 high" gives false confidence — missed the payment P0s |
| WG-040 | P3 | Security | Ingredient-deduction modifier lookup also not org-scoped (downstream of WG-018) |
| WG-041 | P3 | Security | `createCategory` inserts client `parentId` without org validation |
| WG-042 | P3 | Security | `saveWeekSchedule` inserts client `employeeId`/`locationId` without org validation |
| WG-043 | P3 | Security | Defense-in-depth: private by-id helpers without org clause (org-checked callers) |
| WG-044 | P3 | Security | `/metrics` is public when `METRICS_SECRET` is unset |
| WG-045 | P3 | Security | `ADMIN_JWT_SECRET` derives from `JWT_SECRET` when unset; not required at boot |
| WG-046 | P3 | Security | Dead-letter path logs full payment context to stderr |
| WG-047 | P3 | Security | Delivery webhooks lack replay protection (no event-id idempotency) |
| WG-048 | P3 | Reliability | Outbound webhook + cache invalidation dispatched inside the txn (pre-commit) |
| WG-049 | P3 | Reliability | `depleteForOrder` (legacy inventory depletion) is dead code |
| WG-050 | P3 | Correctness | `redeemPoints` returns float dollars not cents (currently unwired) |
| WG-051 | P3 | Correctness | `foodCost` ingredient join missing `deleted_at` filter |
| WG-052 | P3 | Correctness | Public-menu price subquery ignores deleted variants |
| WG-053 | P3 | Performance | `depleteForOrder` is a severe N+1 (moot — it's dead code, see WG-049) |
| WG-054 | P3 | Performance | Import product creation is N+1 (acceptable — async admin batch) |
| WG-055 | P3 | Performance | A few per-entity reads have no LIMIT (bounded by cardinality in practice) |
| WG-056 | P3 | Dead code | `apps/api/src/graphql/` is dead (schema-only SDL, never wired) |
| WG-057 | P3 | Dead code | Two recipe systems coexist (`recipe.service` live + `ingredientRecipe.service`) |
| WG-058 | P3 | Dead code | Legacy `inventory_levels` products are never auto-depleted on sale |
| WG-059 | P3 | Dead code | `client.bak/` and `server.bak/` are dead cruft at repo root |
| WG-060 | P3 | Web | Kiosk exit PIN hardcoded fallback `'1234'`, checked client-side |
| WG-061 | P3 | Web | `fmtCurrency` bypassed by ~20 ad-hoc `$`-hardcoded formatters |
| WG-062 | P3 | Web | Cart modifier price delta rendered without a `$` sign |
| WG-063 | P3 | Web | Tip-step order summary mislabels the grand total as "Subtotal" |
| WG-064 | P3 | Web | Recipe-mode edit of an off-view product falls back to the legacy editor |
| WG-065 | P3 | Web | Print-server URL defaults to `http://localhost:3333` (by design) |
| WG-066 | P3 | Web | Placeholder App Store / download IDs |
| WG-067 | P3 | Mobile | `StripeProvider` mounts with the placeholder publishable key |
| WG-068 | P3 | Mobile | Mobile dev API port is `3000` but the API runs on `3001` |
| WG-069 | P3 | Docs | CLAUDE.md Stack says "011 files, 001–010 applied" — stale (28 migrations, 001–028 applied) |
| WG-070 | P3 | Docs | QUICK_REFERENCE migration table stops at 027; `028_ingredient_system` undocumented |
| WG-071 | P3 | Docs | `docs/CLAUDE.md` pointer says "001–016 applied, no pending" — very stale |

---

## Detailed Findings

### P0 — Critical (fix before ANY real customer)

### WG-001 — Stripe charge succeeds but DB write fails → money taken, order never recorded
- **Severity:** P0
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:141-153` (charge), `:182-303` (DB txn), `:304-321` (dead-letter)
- **Issue:** `getStripeClient().paymentIntents.create({ confirm: true })` runs at line 142, fully outside the DB transaction that starts at line 183. If the `withTransaction` block throws (DB down, pool exhausted, constraint error, deadlock), the `catch` at 304 only writes an `audit_logs` row via `logDeadLetter(...)` and rethrows. There is no automated reconciliation consuming `payment.dead_letter` rows (the offline-queue machinery in `payments/offline.service.ts` is a different queue). `logDeadLetter` itself can fail to `console.error`, so the only artifact can be a log line.
- **Impact:** The customer's card is charged but no `payments` row exists and the order is not marked paid. Recovery is fully manual and depends on someone reading audit logs. Real money disappears from the system's books.
- **Proposed fix:** Either (a) use manual capture (`confirm:false` → capture only after the DB commit, void on DB failure); or (b) write dead-letters to a durable monitored queue with an automated reconciler that retries the DB write using the known PaymentIntent id, plus a P0 alert (Sentry/PagerDuty) on every dead-letter and a scheduled job listing unreconciled entries.
- **Fix risk:** Medium-high. Manual-capture reshapes the Stripe flow and needs careful testing of the void-on-failure branch. Touches the core payment path — must not regress the happy path.
- **Effort:** medium (alerting + reconciler) to large (manual-capture rework).

### WG-002 — No idempotency on `processPayment` → concurrent/retried charges double-bill
- **Severity:** P0
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:61-64` (unlocked order load), `:66-67` (status guard), `:142-149` (Stripe create with no `idempotencyKey`)
- **Issue:** The order is loaded with a plain `query()` (no `FOR UPDATE`), the `status==='completed'` guard is read outside any lock, and `paymentIntents.create` passes no `idempotencyKey`. Two concurrent `processPayment` calls for the same order (double-click, client retry on a slow/timed-out request, two terminals) both pass the guard, both create separate PaymentIntents, and both insert `payments` rows. Verified directly: line 142-149 has no idempotency key; line 61 has no `FOR UPDATE`. Same pattern in `syncOfflinePayment`.
- **Impact:** Customer charged twice for one order. Completion math sums all completed payments, so the duplicate shows as overpayment/change_due rather than being rejected. Refund is the only remedy.
- **Proposed fix:** Pass a deterministic Stripe `idempotencyKey` (hash of orderId + amount + paymentMethodId, or a client-supplied request id) on every `paymentIntents.create`; additionally load the order `FOR UPDATE` inside the transaction and re-check status under the lock, or add a unique constraint on `(order_id, processor_payment_id)`.
- **Fix risk:** Low-medium. Adding the idempotency key is safe and low-risk; row-locking across a network call to Stripe should be avoided (prefer the idempotency-key approach as the primary mitigation).
- **Effort:** small (idempotency key) / medium (locking).

### WG-003 — Voiding a PAID order via the location route keeps the customer's money
- **Severity:** P0
- **Layer:** Correctness
- **File:** `apps/api/src/services/order.service.ts:867-915` (called from `apps/api/src/routes/order.routes.ts:178-187`)
- **Issue:** Verified directly. `OrderSvc.voidOrder` blocks only `voided` (line 880) and `completed` (line 881); it then voids line items and sets `status='voided'` but **never reverses captured payments** (no Stripe refund, no gift-card credit-back, no account-credit return). The location-scoped route `POST /api/v1/locations/:locationId/orders/:orderId/void` calls this function directly. A separate, *correct* implementation exists — `TransactionSvc.voidOrder` (`transaction.service.ts:124`) calls `distributeRefund` — so there are two divergent void paths and the location route uses the unsafe one. Because `completed` is only set when a customer is attached (see WG-005), most paid walk-in orders sit in `paid`/`partially_refunded` and are fully voidable here.
- **Impact:** A paid order can be voided with the charge never reversed: customer is charged, order shows voided, merchant keeps the money. Loyalty/inventory reversal is also skipped on this path. This is a live money-retention bug on the primary void button.
- **Proposed fix:** Make the location-scoped void delegate to `TransactionSvc.voidOrder` (which refunds), or add a guard in `OrderSvc.voidOrder` rejecting any order with `amount_paid > 0` (status in `paid`/`partially_refunded`) and force it through the refunding path.
- **Fix risk:** Low-medium — two callers exist; ensure the UI points at the refunding endpoint and that downstream reporting handles the refunded state.
- **Effort:** small.

---

### P1 — High (fix before scaling)

### WG-004 — `ORDER_PRICE_OVERRIDE` permission defined but never enforced (cashier price tampering)
- **Severity:** P1
- **Layer:** Security
- **File:** `apps/api/src/services/order.service.ts:176-177` (override applied); `apps/api/src/routes/order.routes.ts` (create route requires only `ORDER_CREATE`); `apps/api/src/auth/permissions.ts` (perm defined, cashier lacks it)
- **Issue:** Verified directly: `if (item.unitPriceOverride !== undefined) { unitPrice = item.unitPriceOverride; }` — the client-supplied override is trusted with no role/permission check and no non-negative guard (unlike `quantity` and `payment.amount`, which are validated `> 0`). `Permission.ORDER_PRICE_OVERRIDE` exists and is granted only to owner/manager but is checked in zero routes/services.
- **Impact:** Any cashier (or a compromised cashier token) can POST an order with `lineItems[].unitPriceOverride: 1` (or `0`, or negative) and ring items at attacker-chosen prices — direct revenue theft. Negative overrides can also drive subtotal math negative.
- **Proposed fix:** In create/update order, if any line item carries `unitPriceOverride`, require `Permission.ORDER_PRICE_OVERRIDE` (strip it otherwise), and validate `unitPriceOverride >= 0` with a sane upper bound in `resolveLineItems`.
- **Fix risk:** Low — additive permission gate; only affects clients sending overrides.
- **Effort:** small.

### WG-005 — Walk-in orders never reach `completed`; second full payment accepted (double charge) + pay-after-refund
- **Severity:** P1
- **Layer:** Correctness
- **File:** `apps/api/src/services/payment.service.ts:66-67` (status guard), `:269` (`justCompleted = fullyPaid && totals.customer_id`)
- **Issue:** `processPayment` blocks only `voided` and `completed`. Orders that ended `refunded`/`partially_refunded` are not blocked (re-charge after refund). Worse, `status` flips to `completed` only when `customer_id` is non-null, so a fully-paid **walk-in (no-customer) order never becomes `completed`** — a second full `processPayment` passes the guard and stacks another payment. Verified: the completed-gate on customer_id is real and combines with WG-002.
- **Impact:** Double charge on the most common POS path (walk-in cash/card), and the ability to charge an already-refunded order.
- **Proposed fix:** Block payment when status is `refunded`/`partially_refunded`; set `status='completed'` on full payment regardless of whether a customer is attached (decouple completion from loyalty accrual).
- **Fix risk:** Medium — changes when orders flip to completed; verify reporting/KDS filters and the inventory-deduction trigger (WG-011, which is also gated on `orderCompleted`).
- **Effort:** small-medium.

### WG-006 — Gift-card / account-credit double-spend (balance checked outside txn, no row lock)
- **Severity:** P1
- **Layer:** Correctness
- **File:** `apps/api/src/services/payment.service.ts:104-119` (gift card), `:83-98` + `:200-205` (deduction)
- **Issue:** The balance sufficiency check runs in a separate `query()` *before* `withTransaction`, and the in-transaction deduction is an unconditional `current_balance = current_balance - $1` with no re-check and no `FOR UPDATE`. Same for `customers.account_credit`.
- **Impact:** Two concurrent payments against the same gift card / account credit both pass the check and both deduct, driving the balance negative — spending money that isn't there.
- **Proposed fix:** Move the balance read+check inside the transaction with `SELECT ... FOR UPDATE`, or make the UPDATE conditional (`... - $1 WHERE current_balance >= $1`) and treat 0 rows updated as insufficient funds.
- **Fix risk:** Low.
- **Effort:** small.

### WG-007 — Recipe yield/waste division has no null/zero guard → NaN/Infinity into inventory & variance
- **Severity:** P1
- **Layer:** Correctness
- **File:** `apps/api/src/services/recipe.service.ts:249,253-254,266`
- **Issue:** `yieldFactor = parseFloat(rows[0].yield_factor)` (NULL→NaN, 0→0) and `wasteFactor = parseFloat(row.waste_factor)` (NULL→NaN) are used in `depletionQty = (lineQty * (1 + wasteFactor)) / yieldFactor * quantity` with no fallback and no zero check on the divisor.
- **Impact:** A recipe with NULL/0 `yield_factor` produces Infinity/NaN depletion; NULL `waste_factor` produces NaN. This flows into `getTheoreticalUsage` → `variance.service.ts` theoretical map → variance reports and any stock projection — silently corrupting theoretical-usage and variance numbers.
- **Proposed fix:** `yieldFactor = parseFloat(...) || 1` with a guard rejecting `<= 0`; `wasteFactor = parseFloat(...) || 0`. Mirror the `NULLIF` guard already used in `foodCost.service`.
- **Fix risk:** Low.
- **Effort:** small.

### WG-008 — Archived products/variants can be sold (order create never filters `archived_at`)
- **Severity:** P1
- **Layer:** Correctness
- **File:** `apps/api/src/services/order.service.ts:118-194`
- **Issue:** Verified: product/variant resolution checks `deleted_at` and `is_active` in code but never `archived_at` (zero `archived_at` references in the file). Ground truth requires sold products to satisfy `deleted_at IS NULL AND archived_at IS NULL`.
- **Impact:** A product an operator archived (removed from the menu, kept for history) can still be added to a new order if its id is known/cached, and its active price still resolves — selling items that should be unsellable.
- **Proposed fix:** Add `AND archived_at IS NULL` (or the equivalent in-code check) to the product lookup and reject archived products before pricing.
- **Fix risk:** Low.
- **Effort:** small.

### WG-009 — Delivery webhook acks 200 then creates the order fire-and-forget → orders silently dropped
- **Severity:** P1
- **Layer:** Reliability
- **File:** `apps/api/src/routes/delivery.routes.ts:93-99`
- **Issue:** `void Delivery.processDeliveryOrder(...).catch((err) => req.log.error(...))` runs after `return reply.code(200)`. The provider receives a success ack before the order is created, so if `processDeliveryOrder` throws (e.g. `systemEmployeeId` null at `delivery.service.ts:97-99`, or any DB failure), the provider will not retry and the order is dropped — kitchen never sees it.
- **Impact:** A paid third-party delivery order silently never appears on the kitchen display. No retry, no alert, only a server log. Direct revenue / customer-experience loss.
- **Proposed fix:** Await `processDeliveryOrder` before acking and return 5xx on failure so the provider retries (the function is idempotent on `delivery_order_id`, so retries are safe). If async dispatch must stay, push failures to a durable retry queue + alert.
- **Fix risk:** Low — idempotency check makes await + provider-retry safe against duplicates (subject to WG-010).
- **Effort:** small.

### WG-010 — Delivery webhook idempotency is check-then-insert with no unique constraint → duplicate orders
- **Severity:** P1
- **Layer:** Reliability
- **File:** `apps/api/src/services/delivery.service.ts:86-167`
- **Issue:** Idempotency is a SELECT-for-existing outside the transaction followed by an INSERT, with no apparent unique index on `(organization_id, delivery_provider, delivery_order_id)`. Two concurrent webhooks for the same external order can both miss the existing row and both insert.
- **Impact:** Duplicate delivery orders → kitchen makes the food twice; possible double inventory deduction if both are later completed.
- **Proposed fix:** Add a partial unique index `orders(organization_id, delivery_provider, delivery_order_id) WHERE delivery_order_id IS NOT NULL`, INSERT with `ON CONFLICT DO NOTHING`, and treat a 0-row insert as the duplicate case. Verify whether migration 026 already created such an index first.
- **Fix risk:** Low — requires a migration; the code change is mechanical.
- **Effort:** small-medium.

### WG-011 — Inventory deduction is fire-and-forget with no retry/alert → silent stock drift
- **Severity:** P1
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:323-328`; impl `apps/api/src/services/ingredientInventory.service.ts:26-158`
- **Issue:** Verified: `if (orderCompleted) { void deductOrderIngredients(orgId, orderId).catch((err) => console.error(...)); }`. The function also swallows its own errors internally and skips missing/wrong-org ingredients (`if (!ing) continue;`). The fire-and-forget *priority* (never block payment) is correct, but failures vanish into stderr with no retry, dead-letter, or alert. Note: it is also gated on `orderCompleted`, which (per WG-005) is false for walk-in orders — so most POS sales never deduct at all.
- **Impact:** Recorded stock stays higher than physical stock; low-stock/reorder alerts fire late or never; the `stock_movements` audit trail is incomplete. Erodes trust in the inventory feature over time.
- **Proposed fix:** Keep it non-blocking but recoverable: enqueue deduction as a durable BullMQ job keyed on orderId (the repo already has `queues/`), retry with backoff, dead-letter on permanent failure, and alert via Sentry instead of `console.error`. Add a nightly reconciliation of expected vs recorded deductions.
- **Fix risk:** Low-medium — additive; requires WG-012 (idempotency) first.
- **Effort:** medium.

### WG-012 — Inventory deduction is not idempotent → any retry double-deducts
- **Severity:** P1
- **Layer:** Reliability
- **File:** `apps/api/src/services/ingredientInventory.service.ts:26-158`
- **Issue:** Unlike `reverseOrderIngredients` (which guards with a `sale_void` existence check), `deductOrderIngredients` has no "already deducted" guard — it recomputes and writes new `stock_movements` + decrements `current_stock` every time it runs.
- **Impact:** Latent today (called once), but becomes an active double-deduction the moment a retry mechanism (WG-011's queue) is added, or if `processPayment` runs twice (WG-002/WG-005).
- **Proposed fix:** Add an idempotency guard mirroring the reversal: `SELECT 1 FROM stock_movements WHERE order_id=$1 AND organization_id=$2 AND movement_type='sale' LIMIT 1` and return early if present. Do this before introducing any retry.
- **Fix risk:** Low.
- **Effort:** small.

### WG-013 — `refundPayment` DB writes are not transactional → double-refund / Stripe-DB divergence
- **Severity:** P1
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:341-424`
- **Issue:** After `refunds.create(...)`, the function does three separate non-transactional `query()` writes (gift-card balance, `payments.refunded_amount`, `orders.amount_paid/status`). The `maxRefundable` check is read before any lock (`:356`). A crash/error between the Stripe refund and the payment-row update leaves the customer refunded at Stripe while the DB still believes the order is fully paid — and a second refund could pass the unlocked `refunded_amount` check.
- **Impact:** Money refunded at Stripe without DB reflection → potential double-refund and inconsistent inventory reversal (keyed on `newStatus==='refunded'`).
- **Proposed fix:** Wrap the three writes in one `withTransaction`, load the payment row `FOR UPDATE`, and pass a Stripe `idempotencyKey` on `refunds.create`. Decide an explicit Stripe-vs-DB ordering policy (mirror the dead-letter mechanism of WG-001).
- **Fix risk:** Medium — same Stripe/DB ordering tension as WG-001.
- **Effort:** medium.

### WG-014 — `listProducts` N+1 (~6 queries/product) on the primary POS load
- **Severity:** P1
- **Layer:** Performance
- **File:** `apps/api/src/services/product.service.ts:603` (loop) → `buildProductWithRelations` (`:143-204`)
- **Issue:** `Promise.all(productRows.map(prod => buildProductWithRelations(prod.id)))` fires 6 queries per product (product, variants, prices, recipe, recipe_lines, modifier-groups). Page 50 → ~302 queries; `limit=200` → ~1,202. Mitigated by a 5-min Redis cache, but `invalidateOrgCache` runs on every product create/update/delete/archive/restore, so any menu edit forces a full cold rebuild.
- **Impact:** Cold/first POS load and every load after a menu edit pays the full N+1 on the core register screen.
- **Proposed fix:** Bulk-fetch relations with `= ANY($ids)` (one query each for variants/prices/recipes+lines, one aggregated modifier-group query keyed by `product_id`), then assemble in JS.
- **Fix risk:** Medium — must preserve exact `ProductWithModifiers` shape (ordering, price-effective filtering, modifier JSON aggregation).
- **Effort:** medium.

### WG-015 — `resolveLineItems` issues 2-4 queries per line item on order create/update
- **Severity:** P1
- **Layer:** Performance
- **File:** `apps/api/src/services/order.service.ts:112-223` (called from `createOrder` and `updateOrder`)
- **Issue:** Per line item: 1 product query, 1 variant query, 1 price query, plus 1 query per modifier — all serial inside the order transaction. A 10-item cart with 2 modifiers each ≈ 50 serial queries, lengthening lock duration on `discounts FOR UPDATE` and checkout latency. The public online-order path hits the same code.
- **Impact:** Large tickets hold a transaction open across dozens of round-trips; checkout latency and lock contention grow with cart size.
- **Proposed fix:** Batch-resolve before the loop (one `products`/`product_variants`/`product_prices`/`modifiers` query each via `= ANY`), build lookup maps, iterate in memory. Replicate the location-specific price preference in JS.
- **Fix risk:** Medium.
- **Effort:** medium.

### WG-016 — Customer email addresses (PII) logged to stdout via `console.log`
- **Severity:** P1
- **Layer:** Dead code / Security
- **File:** `apps/api/src/services/email.service.ts:379,516`; `apps/api/src/email.ts:33`
- **Issue:** `email.service.ts:379` and `:516` print recipient addresses (`${p.to}` / `${params.to}`) to stdout via `console.log` (bypassing the pino logger and any redaction). `email.ts:33` logs a captured dev-transport message object that may include recipient/body content.
- **Impact:** Customer email addresses (PII) land in plaintext production logs (Railway retention), outside the structured/redacted logging path. Minor compliance exposure.
- **Proposed fix:** Route through the pino logger at `debug` with the address redacted/hashed, or gate behind a dev-only check; confirm `email.ts:33` cannot fire in production.
- **Fix risk:** Low.
- **Effort:** trivial.

### WG-017 — Mobile EAS projectId + Apple submit creds are placeholders → build/submit blocked
- **Severity:** P1 (launch blocker, operational — not a runtime crash)
- **Layer:** Mobile
- **File:** `apps/mobile/app.json:70` (`projectId: REPLACE_WITH_EAS_PROJECT_ID`); `apps/mobile/eas.json` (`appleId`/`ascAppId`/`appleTeamId` all `REPLACE_WITH_*`)
- **Issue:** EAS build/OTA cannot run until `projectId` is set; `eas submit` cannot run until the Apple credentials are filled. `eas.json` also has no `env` block (see WG-036).
- **Impact:** The mobile app cannot be built or submitted to the App Store as-is.
- **Proposed fix:** Fill in the real EAS project id and Apple credentials before attempting `eas build`/`eas submit` (tracked in BACKLOG MOBILE-002).
- **Fix risk:** None (config only).
- **Effort:** small.

---

### P2 — Medium (fix this month)

### WG-018 — Order line-item modifier lookup not org-scoped → cross-tenant read + price influence
- **Severity:** P2
- **Layer:** Security (multi-tenant)
- **File:** `apps/api/src/services/order.service.ts:199-205`
- **Issue:** Verified: `SELECT id, name, price_delta FROM modifiers WHERE id = $1 AND is_active = true AND deleted_at IS NULL`. The `modifiers` table has no `organization_id` column; every other modifier query enforces tenancy via `JOIN modifier_groups mg ... WHERE mg.organization_id = $org` (see `modifier.service.ts:201-203`). This query omits the join. Products/variants in the same function are correctly org-checked.
- **Impact:** A user in org A who knows/guesses a modifier UUID from org B can attach it to their own order line — the response copies org B's modifier `name` (info disclosure) and applies its `price_delta`. Bounded by needing a valid UUID; leaks one modifier's name/price per request.
- **Proposed fix:** Add `JOIN modifier_groups mg ON mg.id = m.group_id` and require `mg.organization_id = $orgId` (orgId is in scope), matching `modifier.service.ts`.
- **Fix risk:** Low — purely tightens the WHERE.
- **Effort:** trivial.

### WG-019 — Public payment confirm doesn't bind the PaymentIntent to the order/amount
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/services/public.service.ts:268-297`
- **Issue:** `confirmOnlinePayment` retrieves an arbitrary `paymentIntentId`, checks only `pi.status === 'succeeded'`, then sets `amount_paid = pi.amount` and marks the order completed — without verifying `pi.metadata.orderId === orderId` or `pi.amount >= order.total`.
- **Impact:** A customer could confirm an expensive order with a cheap, separately-owned succeeded PaymentIntent on the same connected account — underpayment / order-confirmation fraud on the unauthenticated storefront.
- **Proposed fix:** Verify `pi.metadata.orderId === orderId` and `pi.amount >= order.total` before marking completed.
- **Fix risk:** Low.
- **Effort:** small.

### WG-020 — Delivery webhook HMAC verified against re-stringified body, not raw bytes
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/routes/delivery.routes.ts:82-91`; verifiers `apps/api/src/services/delivery.service.ts:52-60`
- **Issue:** `const raw = JSON.stringify(body)` re-serializes the already-parsed body; providers sign the exact raw bytes, which `JSON.stringify` will not reproduce (key order, whitespace, unicode/number formatting). The verifiers correctly use `crypto.timingSafeEqual`, but the bytes verified are not the bytes received.
- **Impact:** Signature verification is unreliable (leans toward false-rejects/breakage) and the security guarantee is voided for an order-creating, unauthenticated endpoint.
- **Proposed fix:** Capture the raw request buffer (as the Stripe webhook plugin already does with a scoped `parseAs: 'buffer'` content parser) and verify the HMAC over raw bytes.
- **Fix risk:** Medium — needs a scoped raw-body parser for delivery routes without affecting other JSON routes.
- **Effort:** medium.

### WG-021 — Delivery webhook accepts unverified payloads when no secret configured
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/routes/delivery.routes.ts:89-91`
- **Issue:** When a store has no `webhook_secret`, the handler logs "no secret configured — accepting unverified" and processes the webhook, creating a real order with no authentication.
- **Impact:** Anyone who knows/guesses a `store_id` for a store without a configured secret can inject arbitrary delivery orders into the merchant's POS/kitchen — unauthenticated forged-order injection.
- **Proposed fix:** Reject (401) when no secret is configured; gate processing on `store.isEnabled` + secret presence.
- **Fix risk:** Low-medium (could affect merchants mid-setup).
- **Effort:** small.

### WG-022 — Shopify migration connector SSRF via user-supplied `shopDomain`
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/services/migration.service.ts:366-367,1103-1104`
- **Issue:** `base = \`https://${domain}\`` from `input.shopDomain` (arbitrary user input, `Permission.IMPORT_RUN`) then `fetch(base...)`, with no `.myshopify.com` allowlist and no internal-host blocklist. (Square/Toast/Clover/Lightspeed connectors use fixed hostnames — not vectors.)
- **Impact:** An authenticated owner/manager can point the server at internal hosts (`localhost`, `169.254.169.254`, internal services) — blind SSRF / metadata access. Lower reachability (auth + IMPORT_RUN) but not subject to the `urlFetch` blocklist.
- **Proposed fix:** Validate `shopDomain` against `^[a-z0-9-]+\.myshopify\.com$` (or reuse the `urlFetch` blocklist) before fetching.
- **Fix risk:** Low.
- **Effort:** small.

### WG-023 — `urlFetch` SSRF guard is hostname-pattern-only (DNS rebinding / redirect bypass)
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/services/urlFetch.service.ts:43-79,136-143`
- **Issue:** `validateMenuUrl` blocks internal hosts by regex on the literal hostname, but (a) does not resolve DNS (a public name pointing at `127.0.0.1`/`169.254.169.254` bypasses it) and (b) `fetch(url, { redirect: 'follow' })` follows redirects to internal hosts without re-validating. Used by `POST /api/v1/imports/fetch-url` (authed, IMPORT_RUN, 5/min).
- **Impact:** Authenticated SSRF to internal network / cloud metadata via DNS rebinding or open redirect. Mitigated by auth + low rate limit, but the guard is bypassable.
- **Proposed fix:** Resolve DNS and check the resolved IP against private/link-local ranges before connecting; `redirect: 'manual'` with per-hop re-validation; deny non-standard ports.
- **Fix risk:** Medium (DNS-pinning adds complexity).
- **Effort:** medium.

### WG-024 — Hardcoded default super-admin password seeded on boot
- **Severity:** P2
- **Layer:** Security
- **File:** `apps/api/src/index.ts:506-513`
- **Issue:** `bcrypt.hash('TaprootAdmin2026!', 12)` seeds `admin@taproot-pos.com` / `TaprootAdmin2026!` as `super_admin` when no admin exists; the cleartext is in source and in CLAUDE.md.
- **Impact:** If not changed before exposure (it is on the BLOCKING checklist), it's a full super-admin takeover with a publicly-known credential.
- **Proposed fix:** Generate a random password at seed time (log/email once), or require `INITIAL_ADMIN_PASSWORD` and refuse to seed without it; at minimum force a password change on first admin login.
- **Fix risk:** Low.
- **Effort:** small.

### WG-025 — Weighted-average cost stores fractional cents into `cost_price`
- **Severity:** P2
- **Layer:** Correctness
- **File:** `apps/api/src/services/inventory.service.ts:367-384`
- **Issue:** On PO receipt, cost is `ROUND((cost_price*qty + new_cost*new_qty)/(qty+new_qty), 6)` written to `products.cost_price` (meant to be integer cents), producing values like `333.333333`.
- **Impact:** Every downstream COGS/margin calc multiplies a non-integer cent value (`intelligence`, `foodCost`, `reporting`), producing fractional-cent results that never reconcile to whole cents.
- **Proposed fix:** Round weighted-average cost to whole cents (`ROUND(...,0)`), or move cost to a higher-precision column and round only at the COGS multiplication boundary.
- **Fix risk:** Low-medium (changes stored cost going forward).
- **Effort:** small.

### WG-026 — Split-order tax/discount rounding drift (no remainder reconciliation)
- **Severity:** P2
- **Layer:** Correctness
- **File:** `apps/api/src/services/order.service.ts:1043-1088`
- **Issue:** Each split rounds `Math.round(value * pct)` independently with no remainder reconciliation on the last split.
- **Impact:** Sum of split totals/tax/discount can differ from the original by 1-2 cents; tax remitted and per-line totals won't sum to the parent. Books drift on every split check.
- **Proposed fix:** Allocate the last split as `original − Σ(previous splits)` (largest-remainder method) so parts sum exactly to the whole.
- **Fix risk:** Low.
- **Effort:** small-medium.

### WG-027 — `foodCost` plate cost silently drops lines with NULL `waste_factor`/`cost_price`
- **Severity:** P2
- **Layer:** Correctness
- **File:** `apps/api/src/services/foodCost.service.ts:76-80`
- **Issue:** `SUM(rl.quantity * (1 + rl.waste_factor) * ip.cost_price) / NULLIF(MAX(r.yield_factor),0)` — the divisor is guarded, but a NULL `waste_factor` or `cost_price` makes that line's term NULL and `SUM` silently skips it.
- **Impact:** Theoretical plate cost is understated (missing ingredient cost), inflating margin and mis-classifying items as healthy.
- **Proposed fix:** `COALESCE(rl.waste_factor,0)` and `COALESCE(ip.cost_price,0)` inside the SUM.
- **Fix risk:** Low.
- **Effort:** small.

### WG-028 — Offline-queue Redis push swallowed → payment recorded `offline_queued` but never charged
- **Severity:** P2
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:225-240`
- **Issue:** The offline-queue Redis `rpush` is wrapped in a try/catch that swallows failures. If the push fails, the payment is recorded `offline_queued` in the DB but never enters the Redis sync queue, so `syncOfflinePayment` is never called for it.
- **Impact:** A queued offline payment sits forever as `offline_queued` and is never charged — silent revenue loss.
- **Proposed fix:** On Redis failure, fail the payment creation or write a durable DB-backed marker that a sweeper reconciles; don't silently leave a never-charged queued payment.
- **Fix risk:** Low.
- **Effort:** small.

### WG-029 — `listOrderHistory` correlated subqueries per row
- **Severity:** P2
- **Layer:** Performance
- **File:** `apps/api/src/services/order.service.ts:768-782`
- **Issue:** The main SELECT runs two correlated subqueries per returned row (`item_count` from `order_line_items`, `payment_methods` from `payments`). With `limit` up to 200 that is up to 400 dependent executions per page, plus a separate COUNT(*).
- **Impact:** Order History page cost grows with order volume; amplified by WG-031's index gap on the item_count filter.
- **Proposed fix:** Replace correlated subqueries with `LEFT JOIN LATERAL` or pre-aggregated CTEs (`GROUP BY order_id`) joined once.
- **Fix risk:** Low-medium — keep the `voided_at IS NULL` and `status IN (...)` filters.
- **Effort:** medium.

### WG-030 — No partial index supports the KDS open-orders query (5s poll)
- **Severity:** P2
- **Layer:** Performance
- **File:** query at `apps/api/src/services/kitchen.service.ts:31-44`; indexes `migrations/001_initial_schema.js:992-997`, `020_performance_indexes.js:19-21`
- **Issue:** KDS filters `org + location + status IN ('open','in_progress') + metadata kitchen bumpedAt IS NULL`. The composite index leads with org+location but sorts by `created_at`; `status` is a separate low-selectivity index. No partial index on live orders.
- **Impact:** Polled every 5s per KDS screen; as completed/voided orders accumulate the working set grows even though only live orders matter.
- **Proposed fix:** `CREATE INDEX ON orders (organization_id, location_id, created_at) WHERE status IN ('open','in_progress')`.
- **Fix risk:** Low (additive index/migration).
- **Effort:** low.

### WG-031 — `order_line_items(order_id)` not partial on `voided_at`
- **Severity:** P2
- **Layer:** Performance
- **File:** filters at `order.service.ts:442,774,956,1018`, `kitchen.service.ts:39`, `ingredientInventory.service.ts:36`; index `001_initial_schema.js:1001`
- **Issue:** The hot pattern `WHERE order_id = $1 AND voided_at IS NULL` is served by `idx_oli_order(order_id)` only; `voided_at` is filtered after the index lookup. Amplifies WG-029.
- **Impact:** Moderate — small per order, but executed up to 200× per Order History page.
- **Proposed fix:** Partial index `order_line_items (order_id) WHERE voided_at IS NULL`, or (preferred) fix WG-029 structurally which removes the repeated lookups.
- **Fix risk:** Low.
- **Effort:** low.

### WG-032 — Error response shape inconsistent; `delivery.routes.ts:87` returns only `{error}`
- **Severity:** P2
- **Layer:** Consistency
- **File:** canonical `apps/api/src/middleware/errorHandler.ts` (`{code, message, ...}`); deviations `routes/import.routes.ts:177,193,196`, `routes/ingredient.routes.ts:28`, `routes/delivery.routes.ts:87`
- **Issue:** The global handler returns `{code, message}`, but several routes add a non-standard `error` key, and `delivery.routes.ts:87` returns only `{error: 'Invalid signature'}` — no `code`, no `message`.
- **Impact:** Clients parsing `code`/`message` get inconsistent payloads; the delivery 401 in particular gives clients nothing to key on.
- **Proposed fix:** Normalize inline errors to `{code, message}` (drop `error`); fix `delivery.routes.ts:87`. Better: throw `AppError` subclasses and let the global handler format.
- **Fix risk:** Low — quick grep to confirm the web client doesn't read the legacy `error` field.
- **Effort:** small.

### WG-033 — Response casing inconsistent (snake_case vs camelCase across resources)
- **Severity:** P2
- **Layer:** Consistency
- **File:** `apps/api/src/services/ingredient.service.ts` & `product.service.ts` (return raw snake_case rows) vs `order.service.ts` & `customer.service.ts` (hand-mapped camelCase)
- **Issue:** No central serializer. Ingredient/product endpoints emit `current_stock`/`par_level`/`cost_price`/`category_name`; order/customer endpoints emit `orderType`/`firstName`. Inputs are camelCase while some outputs are snake_case (asymmetric).
- **Impact:** Clients must handle both conventions — a latent source of bugs and friction; confirms the CLAUDE.md note about snake_case leakage.
- **Proposed fix:** Introduce one row→DTO serializer (snake→camel) at the service boundary and standardize on camelCase (or explicitly document snake_case as the contract). Migrate ingredient/product first.
- **Fix risk:** Medium-high — casing change is breaking for web/mobile; update consumers in lockstep.
- **Effort:** medium (large if repo-wide with client updates).

### WG-034 — Query errors render as blank/stuck screens (`throwOnError` unset, no `isError` branch)
- **Severity:** P2
- **Layer:** Web
- **File:** `apps/web/src/lib/queryClient.ts` + KDS/Reports/Inventory/OrderHistory/Customers/Reservations/EndOfDay (e.g. `pages/KitchenDisplayPage.tsx:36,112`, `components/reports/FoodCostTab.tsx:40-44`)
- **Issue:** `queryClient` doesn't set `throwOnError`, so failed queries never reach the `ErrorBoundary`; almost no component checks `isError`. The common `data ?? []` pattern renders an empty state on failure (and `FoodCostTab`'s `if (isLoading || !fc)` shows the skeleton forever).
- **Impact:** On a slow/failed network or a 500, KDS/Reports/Order History/Inventory/Customers show empty tables or a stuck skeleton with no error/retry — misleading (a cook could think there are no tickets; an owner no sales). `retry: 2` mitigates transient blips. Not a crash.
- **Proposed fix:** Either set `throwOnError` (excluding the 401 path apiFetch already handles) so the ErrorBoundary catches failures, or add a shared `isError`+retry branch / `QueryState` wrapper to each component.
- **Fix risk:** Medium for the global option (must exclude/normalize 401); low for per-component.
- **Effort:** small (global) / medium (per-component).

### WG-035 — JWT access + refresh tokens and user PII in `localStorage`
- **Severity:** P2
- **Layer:** Web
- **File:** `apps/web/src/lib/api.ts:22-31` (`taproot_token`, `taproot_refresh_token`, `taproot_user`); `lib/adminApi.ts:28`
- **Issue:** Both access and the long-lived **refresh** token live in `localStorage`, readable by any injected script (XSS); `taproot_user` (name/email/role/orgId) too.
- **Impact:** An XSS could exfiltrate a long-lived refresh token and mint access tokens off-device. This is the standard SPA token-storage tradeoff (httpOnly cookies are the hardened alternative).
- **Proposed fix:** For hardening, move the refresh token to an httpOnly/Secure/SameSite cookie and keep only the short-lived access token in memory; or accept the tradeoff with a strict CSP. Not a launch blocker.
- **Fix risk:** High (touches auth/refresh on client + API).
- **Effort:** large.

### WG-036 — EAS has no `env` wiring; gitignored `.env.production` won't reach production builds
- **Severity:** P2
- **Layer:** Mobile
- **File:** `apps/mobile/eas.json` (no `env` block); `apps/mobile/.gitignore:35-36`
- **Issue:** `.env.production`/`.env.development` are gitignored and `eas.json` has no `env` keys, so an `eas build --profile production` won't receive `EXPO_PUBLIC_API_URL` (falls back to the correct host — fine) or `EXPO_PUBLIC_STRIPE_KEY` (empty → cards stay off, safe, but cards can never be enabled via the .env file alone).
- **Impact:** Production builds can't be configured (esp. Stripe) without wiring env into EAS.
- **Proposed fix:** Add an `env` block to `eas.json` (or set vars in the EAS dashboard) before enabling cards.
- **Fix risk:** Low.
- **Effort:** small.

### WG-037 — `KitchenScreen` has no error state → shows "No tickets" on API failure
- **Severity:** P2
- **Layer:** Mobile
- **File:** `apps/mobile/src/screens/kitchen/KitchenScreen.tsx:97-112`
- **Issue:** Renders only on `isLoading`; the else goes straight to `FlatList data={...data ?? []}` with no `isError` branch (unlike POSScreen/OrdersScreen). Mutations (`itemReady`, `bump`) have no `onError` either.
- **Impact:** On a `/kitchen/tickets` failure the screen shows "No open tickets" — a false negative telling kitchen staff there's nothing to cook during an outage. Self-heals on the 5s poll, but lies meanwhile; failed bump/ready taps give no feedback.
- **Proposed fix:** Add an `isError` branch (message + retry) mirroring POSScreen; add `onError` toasts to the mutations.
- **Fix risk:** None.
- **Effort:** trivial.

### WG-038 — `OrderDetailModal` maps `r.lineItems`/`li.modifiers`/`r.payments` with no `?? []` → crash
- **Severity:** P2
- **Layer:** Mobile
- **File:** `apps/mobile/src/screens/orders/OrdersScreen.tsx:207,212,232`
- **Issue:** After the `!r` guard, the code assumes `r.lineItems`, `li.modifiers`, `r.payments` are always arrays. A receipt row with a null/missing array (e.g. no payments yet, or backend shape drift) makes `.map` throw and crashes the modal render.
- **Impact:** Tapping such an order crashes the Orders detail view. Contained to the modal but on an order/money screen.
- **Proposed fix:** Default each: `(r.lineItems ?? [])`, `(li.modifiers ?? [])`, `(r.payments ?? [])` — the same pattern mandated by BUG-PAY-001 on web.
- **Fix risk:** None.
- **Effort:** trivial.

### WG-039 — "Security certified 0 crit/0 high" gives false confidence — missed the payment P0s
- **Severity:** P2
- **Layer:** Docs
- **File:** `CLAUDE.md` (psr-2026-06-12 cert line); `docs/SECURITY_AUDIT_2026.md`
- **Issue:** The project is described as "Production certified… OWASP Top 10 + PCI DSS 4.0, 0 crit / 0 high." That pass did not catch the business-logic money defects in this audit (WG-001/002/003/005/006/013) because they aren't classic vulnerability classes.
- **Impact:** The cert can be read as "payments are safe," which this audit contradicts. A reader could launch on real money believing the payment path is verified.
- **Proposed fix:** Add a note to the security/cert docs that the OWASP/PCI scope did not include payment-lifecycle correctness, and reference this audit's P0s as outstanding before real card traffic.
- **Fix risk:** None (doc only).
- **Effort:** trivial.

---

### P3 — Low (polish / future)

### WG-040 — Ingredient-deduction modifier lookup also not org-scoped (downstream of WG-018)
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/services/ingredientInventory.service.ts:71-73`
- **Issue:** `SELECT ... FROM modifiers WHERE id = ANY($1::uuid[])` — same missing `modifier_groups`/org join. `modIds` come from an already-org-validated order, so only reachable via a modifier smuggled in through WG-018.
- **Impact:** Reads a foreign modifier's fields during deduction; no cross-org write. Becomes a non-issue once WG-018 is fixed.
- **Proposed fix:** Join `modifier_groups` and filter `organization_id = $orgId`.
- **Fix risk:** Low. **Effort:** trivial.

### WG-041 — `createCategory` inserts client `parentId` without org validation
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/services/category.service.ts:55-63`
- **Issue:** `parentId` from the client is inserted without verifying it belongs to the org. No foreign data is read or mutated; reads re-filter by org.
- **Impact:** A category could reference a foreign category UUID as parent. Cosmetic / defense-in-depth.
- **Proposed fix:** Validate `parentId` against the org before insert.
- **Fix risk:** Low. **Effort:** trivial.

### WG-042 — `saveWeekSchedule` inserts client `employeeId`/`locationId` without org validation
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/services/scheduling.service.ts:243-249`
- **Issue:** `s.employeeId`/`s.locationId` from the client are inserted into `schedules` without confirming org membership; rows are tagged with the caller's orgId, so no cross-org read/mutation.
- **Impact:** Defense-in-depth only.
- **Proposed fix:** Validate ids via `= ANY` against the org.
- **Fix risk:** Low. **Effort:** small.

### WG-043 — Defense-in-depth: private by-id helpers without org clause (org-checked callers)
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/services/product.service.ts:143-155`; `inventory.service.ts:153-154,170`; `routes/settings.routes.ts:205,272,315`
- **Issue:** These SELECT `... WHERE id = $1` with no org clause, but every caller org-validates first (productId validated; `resolveLocationId` validates locationId; etc.). This is the remaining tail of SEC-ORG-001.
- **Impact:** None exploitable on its own (unguessable UUID + org-checked parent); adding the clause is proper defense in depth.
- **Proposed fix:** Add `AND organization_id = $org` to each as a hardening sweep.
- **Fix risk:** Low. **Effort:** small.

### WG-044 — `/metrics` is public when `METRICS_SECRET` is unset
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/monitoring/health.ts:114-121` (in `PUBLIC_ROUTES`, `index.ts:434`)
- **Issue:** The auth block is skipped entirely if `METRICS_SECRET` is unset, serving Prometheus metrics (route names, traffic, latencies) publicly.
- **Impact:** Reconnaissance-value information disclosure if the secret isn't configured in prod. No PII.
- **Proposed fix:** Fail closed — in production with no `METRICS_SECRET`, return 403 (or refuse boot, like other secrets).
- **Fix risk:** Low. **Effort:** trivial.

### WG-045 — `ADMIN_JWT_SECRET` derives from `JWT_SECRET` when unset; not required at boot
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/config.ts:45`; `apps/api/src/middleware/adminAuth.ts:13-14`
- **Issue:** `ADMIN_JWT_SECRET ?? \`${JWT_SECRET}_admin\``. If unset, the admin token secret is a trivial transformation of the org secret; `validateConfig()` doesn't require it.
- **Impact:** Reduced cryptographic separation between org and admin tokens (already a BLOCKING checklist item).
- **Proposed fix:** Require `ADMIN_JWT_SECRET` (with a length assertion) in production config validation.
- **Fix risk:** Low. **Effort:** trivial.

### WG-046 — Dead-letter path logs full payment context to stderr
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/services/payment.service.ts:46`
- **Issue:** On a rare double-failure (`logDeadLetter` itself failing), `console.error('[payment] Dead letter log failed:', JSON.stringify(context))` may print order/amount/customer metadata (no raw PAN; possibly `card_last4`).
- **Impact:** Minor PII in logs on a rare path.
- **Proposed fix:** Redact `context` to ids/amounts before logging.
- **Fix risk:** Low. **Effort:** trivial.

### WG-047 — Delivery webhooks lack replay protection
- **Severity:** P3
- **Layer:** Security
- **File:** `apps/api/src/routes/delivery.routes.ts:63-100`
- **Issue:** Unlike the Stripe webhook (Redis idempotency, 72h), DoorDash/Uber Eats handlers have no event-id/idempotency check; a valid signed payload can be replayed.
- **Impact:** Duplicate order creation via replay (bounded once WG-010/020/021 are fixed).
- **Proposed fix:** Add a Redis idempotency key on the provider event/order id, mirroring Stripe.
- **Fix risk:** Low. **Effort:** small.

### WG-048 — Outbound webhook + cache invalidation dispatched inside the txn (pre-commit)
- **Severity:** P3
- **Layer:** Reliability
- **File:** `apps/api/src/services/payment.service.ts:289-300`
- **Issue:** `void deliverWebhook(...)` and `void invalidateOrgCache(...)` fire inside the `withTransaction` body, before COMMIT. A merchant could be notified of `order.completed` and read stale state, or the event fires for a transaction that later rolls back.
- **Impact:** Correctness smell; low because post-this-point rollback is rare.
- **Proposed fix:** Move these dispatches to after `withTransaction` resolves, guarded by the returned flags (alongside the post-commit deduction/audit block).
- **Fix risk:** Low. **Effort:** small.

### WG-049 — `depleteForOrder` (legacy inventory depletion) is dead code
- **Severity:** P3
- **Layer:** Dead code / Reliability
- **File:** `apps/api/src/services/inventory.service.ts:141-228`
- **Issue:** `depleteForOrder` has no callers (only its own definition, the `dist/` `.d.ts`, and a test). The live payment path uses `deductOrderIngredients` (the new ingredient system) instead.
- **Impact:** No runtime bug; maintenance hazard (looks wired but isn't). See WG-058 for the functional consequence.
- **Proposed fix:** Remove it, or wire it in for non-recipe-mode products (coordinating with the ingredient system to avoid double deduction). Document which inventory system is authoritative.
- **Fix risk:** Low (delete) / medium (wire in). **Effort:** small-medium.

### WG-050 — `redeemPoints` returns float dollars not cents (currently unwired)
- **Severity:** P3
- **Layer:** Correctness
- **File:** `apps/api/src/services/loyalty.service.ts:150,172`
- **Issue:** Returns `points * redeemRate` (e.g. `0.01`) as a float dollar value. No caller outside tests.
- **Impact:** None today; a 100×-wrong, fractional footgun if wired into checkout.
- **Proposed fix:** Return integer cents (`Math.round(points * redeemRate * 100)`) or document the unit and convert at the call site.
- **Fix risk:** Low. **Effort:** small.

### WG-051 — `foodCost` ingredient join missing `deleted_at` filter
- **Severity:** P3
- **Layer:** Correctness
- **File:** `apps/api/src/services/foodCost.service.ts:79`
- **Issue:** `JOIN products ip ON ip.id = rl.ingredient_product_id` has no `ip.deleted_at IS NULL`; a soft-deleted ingredient still contributes its cost.
- **Impact:** Minor plate-cost inaccuracy.
- **Proposed fix:** Add `AND ip.deleted_at IS NULL`.
- **Fix risk:** Low. **Effort:** small.

### WG-052 — Public-menu price subquery ignores deleted variants
- **Severity:** P3
- **Layer:** Correctness
- **File:** `apps/api/src/services/public.service.ts:79-82`
- **Issue:** The `MIN(pp.price)` subquery joins `product_variants` without `pv.deleted_at IS NULL` (the outer query and the variant_id subquery do filter).
- **Impact:** A deleted variant's active price can become the advertised menu price (display only; ordering re-resolves server-side).
- **Proposed fix:** Add `AND pv.deleted_at IS NULL` to the subquery.
- **Fix risk:** Low. **Effort:** small.

### WG-053 — `depleteForOrder` is a severe N+1 (moot — dead code)
- **Severity:** P3
- **Layer:** Performance
- **File:** `apps/api/src/services/inventory.service.ts:150-227`
- **Issue:** Query-per-ingredient-per-line-item (a 10-item order ≈ 100-300 serial queries). But the function is unreachable (WG-049), so this is not a live hot path.
- **Impact:** None today; would matter only if WG-049 wires it in.
- **Proposed fix:** If wired in later, mirror the bulk-preload pattern in `deductOrderIngredients` (aggregate net delta, lock all rows in deterministic order, batch the movements insert).
- **Fix risk:** Medium-high if implemented. **Effort:** high.

### WG-054 — Import product creation is N+1 (acceptable — async admin batch)
- **Severity:** P3
- **Layer:** Performance
- **File:** `apps/api/src/services/importJob.service.ts:581-664` (+ goods-receipt/inventory/recipe imports)
- **Issue:** One `findProductByName` + `createProduct` per item; modifier options inserted one row at a time; recipe import does `findProductByName` per ingredient. A 200-item import → thousands of queries.
- **Impact:** Acceptable — one-time async admin job; per-item isolation is intentional so one bad row doesn't abort the import.
- **Proposed fix:** Optional — batch modifier-option inserts and pre-load a name→product map per import.
- **Fix risk:** Low. **Effort:** low-medium.

### WG-055 — A few per-entity reads have no LIMIT (bounded by cardinality in practice)
- **Severity:** P3
- **Layer:** Performance
- **File:** `apps/api/src/services/order.service.ts:406-416`; `ingredientInventory.service.ts:238,350`
- **Issue:** `fetchOrderWithRelations` selects all line items/payments/discounts for an order, and `getInventoryStatus`/`getStockAlerts` select all ingredients — no LIMIT. Bounded by per-order item count / per-org ingredient count (small). All large growing-table reads checked ARE bounded (orders/history clamp to 200, movement history to 500, analytics date-bounded).
- **Impact:** Negligible at realistic cardinality.
- **Proposed fix:** Add pagination to the full ingredient-list endpoint only if catalogs grow large.
- **Fix risk:** n/a. **Effort:** n/a.

### WG-056 — `apps/api/src/graphql/` is dead (schema-only SDL, never wired)
- **Severity:** P3
- **Layer:** Dead code
- **File:** `apps/api/src/graphql/schema/orders.graphql`, `inventory.graphql`
- **Issue:** Only two `.graphql` SDL files; no resolvers, no GraphQL server, no `import` of `graphql`/`./graphql` anywhere, not referenced by `index.ts`, no `graphql`/`mercurius`/`apollo` dependency.
- **Impact:** Dead cruft; misleads readers into thinking a GraphQL API exists.
- **Proposed fix:** Delete the dir (or move under `docs/` as a design artifact).
- **Fix risk:** None. **Effort:** trivial.

### WG-057 — Two recipe systems coexist (`recipe.service` live + `ingredientRecipe.service`)
- **Severity:** P3
- **Layer:** Dead code / Consistency
- **File:** `apps/api/src/services/recipe.service.ts` (callers: `inventory.routes.ts`, `ingredient.routes.ts`, `importJob.service.ts`, `variance.service.ts`, `inventory.service.ts`) + `ingredientRecipe.service.ts`
- **Issue:** `recipe.service.ts` is labeled "legacy" but is actively imported/called (getRecipe, setProductRecipe, enableRecipeMode, getTheoreticalUsage, calculateDepletionForSale, etc.). Two parallel recipe subsystems.
- **Impact:** No dead code, but architectural duplication / maintenance hazard. Do NOT delete `recipe.service` — it's live.
- **Proposed fix:** Document which system is canonical; longer-term consolidate.
- **Fix risk:** High if consolidated. **Effort:** large (consolidate) / trivial (document).

### WG-058 — Legacy `inventory_levels` products are never auto-depleted on sale
- **Severity:** P3
- **Layer:** Dead code / Correctness
- **File:** `apps/api/src/services/payment.service.ts:325-328` (only `deductOrderIngredients` runs); `inventory.service.ts:141` (`depleteForOrder` dead)
- **Issue:** The only sale-driven depletion is `deductOrderIngredients`, which acts on recipe_mode/ingredient products. Products tracked via the legacy `inventory_levels` system have no auto-depletion path (depletion happens only via manual `adjustInventory`/`recordStockCount`).
- **Impact:** Any org relying on `inventory_levels` for sell-through sees stock never move on sales — a potential missing feature, not just dead code. (Also note: even ingredient depletion is gated on `orderCompleted`, false for walk-ins — see WG-005/WG-011.)
- **Proposed fix:** Decide intentionally — either retire the legacy system or wire `depleteForOrder` into completion for non-recipe products.
- **Fix risk:** Low (document) / medium (wire in). **Effort:** small-medium.

### WG-059 — `client.bak/` and `server.bak/` are dead cruft at repo root
- **Severity:** P3
- **Layer:** Dead code
- **File:** `/client.bak/`, `/server.bak/`
- **Issue:** Neither is referenced by any `package.json`/`tsconfig`/`vite.config` (zero matches); not in any workspace or build.
- **Impact:** Repo bloat and stale-code search noise; no runtime effect.
- **Proposed fix:** Delete both (confirm they aren't a deliberate reference snapshot first).
- **Fix risk:** None. **Effort:** trivial.

### WG-060 — Kiosk exit PIN hardcoded fallback `'1234'`, checked client-side
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/pages/KioskPage.tsx:101-102`
- **Issue:** `localStorage.getItem(KIOSK_PIN_KEY) || '1234'` with a client-side comparison; PIN stored/compared in plaintext.
- **Impact:** Anyone who knows the default (or reads localStorage) can exit kiosk mode. Low blast radius (soft guard).
- **Proposed fix:** Require a PIN at kiosk setup (no hardcoded fallback); ideally validate server-side.
- **Fix risk:** Low. **Effort:** small.

### WG-061 — `fmtCurrency` bypassed by ~20 ad-hoc `$`-hardcoded formatters
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/lib/dateRanges.ts:93` (`fmtCurrency`) vs ~20 local `fmt` helpers (PaymentSheet, SplitCheckModal, POSLayout, charts, etc.)
- **Issue:** Nearly every component defines its own `fmt(cents) => \`$${(cents/100).toFixed(2)}\``. Output is correct for USD, but `$` is hardcoded (ignores `orgCurrency` the receipt API returns).
- **Impact:** Correct today; non-USD orgs mis-display the symbol; a formatting change must touch ~20 files.
- **Proposed fix:** Consolidate on `fmtCurrency` (extend to accept a currency code) and replace local helpers.
- **Fix risk:** Low (pure display). **Effort:** medium.

### WG-062 — Cart modifier price delta rendered without a `$` sign
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/components/layout/POSLayout.tsx:192`
- **Issue:** `{m.priceDelta > 0 ? '+' : ''}{(m.priceDelta / 100).toFixed(2)}` renders `+2.00`/`-2.00` with no `$`, unlike the rest of the app.
- **Impact:** Minor visual inconsistency; value is correct.
- **Proposed fix:** Prefix `$`.
- **Fix risk:** None. **Effort:** trivial.

### WG-063 — Tip-step order summary mislabels the grand total as "Subtotal"
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/components/pos/PaymentSheet.tsx:430-433`
- **Issue:** The row shows `fmt(total())` but is labeled "Subtotal"; `total()` = subtotal − discount + tax (the pre-tip grand total). The real "Total due" with tip is shown correctly elsewhere.
- **Impact:** Confusing label; charged amounts are correct.
- **Proposed fix:** Rename the label to "Total" (or show the true subtotal).
- **Fix risk:** None (label only). **Effort:** trivial.

### WG-064 — Recipe-mode edit of an off-view product falls back to the legacy editor
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/components/layout/POSLayout.tsx:744-765`
- **Issue:** Editing a cart line whose product isn't in the current list builds a synthetic `__current__` group; for a recipe_mode product in this state `recipeModeOpen` resolves false, so the 3-section recipe UI doesn't appear (legacy editor used instead).
- **Impact:** Minor UX inconsistency for recipe products edited outside their category; no data corruption, no impact on legacy products. (Note: the `recipe_mode=false` path is otherwise well-isolated and safe — verified.)
- **Proposed fix:** Fetch the product/recipe_mode flag before deciding the mode, if desired.
- **Fix risk:** Low. **Effort:** small.

### WG-065 — Print-server URL defaults to `http://localhost:3333` (by design)
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/lib/thermalPrint.ts:15`; placeholder in `pages/HardwareSettingsPage.tsx:215`
- **Issue:** The ESC/POS print server runs on the cashier's own machine, so localhost is correct; overridable via Settings → Hardware.
- **Impact:** None in normal use; only matters for remote-print-server deployments.
- **Proposed fix:** Optionally back the default with `VITE_PRINT_SERVER_URL`.
- **Fix risk:** Low. **Effort:** trivial.

### WG-066 — Placeholder App Store / download IDs
- **Severity:** P3
- **Layer:** Web
- **File:** `apps/web/src/components/PlatformDetect.tsx:20-24`
- **Issue:** `'app-store': '.../id000000000'` — placeholder App Store ID.
- **Impact:** Download link 404s until real IDs are filled in. Marketing, not core.
- **Proposed fix:** Replace with real store IDs once published.
- **Fix risk:** None. **Effort:** trivial.

### WG-067 — `StripeProvider` mounts with the placeholder publishable key
- **Severity:** P3
- **Layer:** Mobile
- **File:** `apps/mobile/App.tsx:16-18`
- **Issue:** `StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}` receives the literal `pk_live_REPLACE...` (or empty). The PaymentSheet guard correctly disables charges (verified — no charge-with-bad-key path), but the native SDK may log/warn on an invalid key at provider init.
- **Impact:** Low — cosmetic/log noise; an empty string is inert.
- **Proposed fix:** Gate `StripeProvider` to mount only with a key matching `^pk_(live|test)_` and not containing `REPLACE`.
- **Fix risk:** Low. **Effort:** small.

### WG-068 — Mobile dev API port is `3000` but the API runs on `3001`
- **Severity:** P3
- **Layer:** Mobile
- **File:** `apps/mobile/src/api/config.ts:9` (`.env.development` → `http://localhost:3000`)
- **Issue:** Local dev points at port 3000; the API runs on 3001 (per CLAUDE.md). Affects developer machines only; the production default host is correct.
- **Impact:** Local dev against a localhost API 404s/refuses until corrected. No shipped-build impact.
- **Proposed fix:** Correct the dev port to 3001.
- **Fix risk:** None. **Effort:** trivial.

### WG-069 — CLAUDE.md Stack says "011 files, 001–010 applied" — stale
- **Severity:** P3
- **Layer:** Docs
- **File:** `CLAUDE.md` (Stack → Migrations line)
- **Issue:** The Stack section states "node-pg-migrate (`migrations/` — 011 files, 001–010 applied on Railway)", but `migrations/` holds 28 files (001–028, 023 discarded) and the rest of the doc states 001–028 are applied. Internally contradictory.
- **Impact:** Misleads on migration state; contradicts the "Active Pending / migrations none pending" section.
- **Proposed fix:** Update the Stack line to reflect 001–028 applied (023 discarded).
- **Fix risk:** None. **Effort:** trivial.

### WG-070 — QUICK_REFERENCE migration table stops at 027; `028_ingredient_system` undocumented
- **Severity:** P3
- **Layer:** Docs
- **File:** `docs/QUICK_REFERENCE.md:70-93`
- **Issue:** The migration table lists through 027 and says "No pending migrations as of 2026-06-16," but `migrations/028_ingredient_system.js` exists (the live ingredient/recipe system this audit references).
- **Impact:** A reader using QUICK_REFERENCE as ground truth misses migration 028 and the ingredient system's schema.
- **Proposed fix:** Add a row for 028 and confirm its applied status.
- **Fix risk:** None. **Effort:** trivial.

### WG-071 — `docs/CLAUDE.md` pointer says "001–016 applied, no pending" — very stale
- **Severity:** P3
- **Layer:** Docs
- **File:** `docs/CLAUDE.md` (Migrations section)
- **Issue:** States "Migrations 001–016 are all applied… Sprints 4–6 added no new migrations. No pending migrations" — predates 017–028.
- **Impact:** Anyone resolving the docs-side pointer gets a badly outdated migration picture.
- **Proposed fix:** Update or remove the stale migration block; point to QUICK_REFERENCE as the single source.
- **Fix risk:** None. **Effort:** trivial.

---

## Audit Method & Coverage Notes

- **Scope:** `apps/api/src/` (services, routes, middleware, auth, config, monitoring, db),
  `apps/web/src/`, `apps/mobile/`, `migrations/`, and the docs (`CLAUDE.md`,
  `docs/QUICK_REFERENCE.md`, `docs/BACKLOG.md`, `docs/SESSION_HISTORY.md`).
- **Method:** Layer-by-layer review (security → reliability → correctness → consistency →
  performance → dead code → web → mobile → docs). The P0 and headline P1 findings
  (WG-001/002/003/004/005/008/011/018) were verified by the auditor reading the exact source
  lines, not taken on report alone.
- **Reconciliation note:** one sub-report initially claimed there is "no automatic sale-driven
  inventory depletion at all." Direct reading of `payment.service.ts:325-328` shows
  `deductOrderIngredients` IS wired (fire-and-forget, gated on `orderCompleted`). The accurate
  picture: the new ingredient system auto-depletes recipe_mode products on customer-attached
  completed orders; the legacy `depleteForOrder` is dead (WG-049); legacy `inventory_levels`
  products are not auto-depleted (WG-058). The findings above reflect the verified behavior.
- **Not covered (require a running environment / live DB, explicitly out of this read-only pass):**
  live load/index `EXPLAIN` profiling, browser/device visual QA, and confirming which exact
  indexes exist on the production database (index findings are cross-referenced against migration
  source only).
- **Constraints honored:** no source file modified; no DB/curl/mutating operations; no
  boot-path/content-type/`index.ts` edits; the only file written is this audit document.
