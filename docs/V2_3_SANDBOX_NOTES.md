# v2.3 The Counter Bridge — Sandbox Review Notes

> **Branch:** `feat/v2.3-counter-bridge` (off v2.2) · **LOCAL ONLY — never pushed.**
> **NO new migration** (reuses `class_reservations.add_on_order_id`, reserved in v2.2).
> Boot path + `order.service`/`payment.service`/`kitchen.service` cores **ZERO lines
> changed**. tsc 0 both apps; lint 0 errors. Studio-gated — restaurant order/KDS/payment
> path provably unchanged.

The moat: a class reservation carries a pre-ordered café/bar add-on; at check-in the
add-on order fires to the KDS. No incumbent studio platform can do this. This floor is
**pure wiring of existing pieces** — the discipline was to do it without touching a core.

## 1. The add-on lifecycle (decisions + WHY)
**chosen-at-booking → PARKED (held) → fired-at-check-in → paid via the normal café flow.**
- **Chosen at booking** (`attachAddOns`): staff pre-order an `add_on` catalog item onto a
  reservation. We **create one café order** for it and **park it** — held, **off the KDS**.
- **Fired at check-in** (`fireAddOnsForReservation`, called from `classBooking.checkIn`):
  the parked order is **resumed** (`parked → open`) so it appears on the café/bar KDS,
  timed to class end (the order note carries the class + "fires at check-in").
- **Paid via the existing café order lifecycle** (KDS → make → pay → bump). We write **no
  payment code** — once fired, it's a normal café order.

**Why not "pre-paid single charge at booking" (the spec's ideal)?** In the current core,
paying an order fully marks it `completed`, and completed orders **don't route to the KDS**
(`kitchen.service` shows `status IN ('open','in_progress')`). So "pre-paid AND fires-at-
check-in" is not expressible without a core change. Per the constraint ("if firing cleanly
requires a core change, document the seam"), the MVP keeps the add-on unpaid-until-fulfilled
and **pre-pay-at-booking is a documented seam** (§7).

## 2. How the add-on order is created via order.service WITHOUT modifying it
Three PUBLIC `order.service` functions, called from `counterBridge.service` (studio code):
```ts
const order = await OrderSvc.createOrder(orgId, locationId, employeeId, {
  orderType: 'in_store', customerId: member.customer_id,
  notes: 'STUDIO ADD-ON · … · fires at check-in',
  metadata: { studioAddOn: true, reservationId, fulfillment: 'bar' },
  lineItems: itemIds.map(id => ({ productId: id, quantity: 1 })),   // add_on catalog products
});
await OrderSvc.parkOrder(orgId, locationId, order.id, employeeId);   // held, off KDS
// …at check-in:
await OrderSvc.resumeOrder(orgId, o.location_id, orderId, employeeId); // parked → open → ON KDS
```
**Proof the cores are unchanged:** `git diff` shows **zero lines** in `order.service.ts`,
`payment.service.ts`, `kitchen.service.ts`, `index.ts`. The only modified existing file is
`classBooking.service.ts` (my v2.2 file) — a one-line additive fire hook in `checkIn`.

## 3. Bar/café ticket routing
There is **no station concept** in the codebase today (`kitchen.service` hardcodes
`station:'all'`; no station column on products/line-items). So the add-on ticket appears on
the org's KDS **tagged** via the order note (`STUDIO ADD-ON · member · class`) +
`metadata.studioAddOn/fulfillment:'bar'`, which the counter uses to identify it. A hybrid
studio-café runs one counter/KDS (or filters by category). **Multi-station (true bar-vs-
kitchen) routing is a documented seam** (§7) — it needs a `station` column = a core change.

## 4. Failure handling (add-on fails, booking stays sane)
- **Booking and add-on are DECOUPLED.** The class booking (credit deduct + reservation) is a
  separate, already-committed v2.2 transaction; `attachAddOns` runs afterward as its own
  action. A failed/declined add-on therefore can **never** corrupt the booking — no
  half-booked/half-charged state is possible.
- **Create-then-park compensation:** `createOrder` makes an `open` order (briefly on the KDS);
  if `parkOrder` then fails, we **void** that order (unpaid → clean void) so it is never left
  visible at the counter, and rethrow.
- **Fire never blocks check-in:** the check-in hook `.catch()`es the fire — a check-in always
  succeeds even if the KDS fire hiccups (and it's idempotent, so it can be retried).

## 5. Idempotency (no double-fire on re-check-in)
`fireAddOnsForReservation` resumes the order **only if its status is `'parked'`**; once fired
it's `'open'` (or later completed), so a second check-in is a **no-op**. `resumeOrder` itself
also rejects a non-parked order. Plus `classBooking.checkIn` is already idempotent
(`checked_in_at = COALESCE(checked_in_at, now())`). ⇒ checking in twice fires exactly once.

## 6. Files
**New:** `apps/api/src/services/counterBridge.service.ts`, `apps/api/src/routes/counterBridge.routes.ts`.
**Changed:** `apps/api/src/services/classBooking.service.ts` (fire hook in checkIn),
`apps/web/src/lib/api.ts` (counterBridge client), `apps/web/src/pages/StudioSchedulePage.tsx`
(add-on panel in the roster drawer). **No migration. No new web route/nav** (add-on UI lives in
the existing studio-gated schedule page).

## 7. Seams (wire / build supervised later)
- **Route registration** (1 file, boot path untouched):
  ```ts
  import counterBridgeRoutes from './routes/counterBridge.routes';
  await fastify.register(counterBridgeRoutes);
  ```
- **Pre-pay single charge at booking** — needs a core capability (a paid order that still
  routes to the KDS, or splitting "tab settle" from "ticket fire"). Documented, not built.
- **Multi-station (bar vs kitchen) routing** — needs a `station` column on products/line-items
  + `kitchen.service` grouping. Core change → seam.

## 8. 3-layer studio gate + restaurant-path proof
counterBridge routes are `requireManager` + `hasCapability('studio')` 404; the UI is inside the
studio-gated schedule page; the check-in fire only acts when a reservation has an
`add_on_order_id` (studio-only data — restaurants have no reservations). Cores untouched ⇒ a
restaurant's order/KDS/payment flow is byte-identical (verified: those files are absent from the diff).

## 9. Deferred (by design)
Pre-pay single charge (§7); multi-station routing (§7); `redeem_at:'prebook'` (fire immediately
at booking vs at check-in — MVP does check-in, the magic moment); member-facing public booking
add-on (MVP is staff-on-behalf in the roster); add-on at fire-time selection (MVP pre-orders at booking).

## 10. Risk assessment
The only new interaction is **studio code CALLING order.service public functions**; no core
logic changed, so existing order/KDS/payment behavior cannot change. The add-on order is a
normal order (taxed, paid, bumped via the existing pipeline). Worst case if unwired/un-migrated:
inert (routes 404, services table-guarded). **Look hardest at:** the park→resume idempotency
(no double-fire), the create-then-park void compensation, and confirming the 3 core files are
absent from the diff.

## 11. How to test locally (the moat demo)
1. `npm run build --workspace=@taproot/shared`; tsc both → 0.
2. Wire the route files (this branch's + v2.1/v2.2's) into a LOCAL `index.ts` (don't commit),
   run migrations 033/034 locally, set an org `capabilities.studio=true`, and create an
   `add_on` studio-catalog item (e.g. "Recovery Smoothie", fulfillment bar).
3. Demo: create a class → Generate sessions → book a member → open the session roster → ☕ →
   pre-order the smoothie ("pre-ordered — fires at check-in") → **check the member in** →
   the smoothie order leaves 'parked' and appears on the café KDS ("fired to the counter") →
   the bar makes + rings it up through the normal POS. One reservation, one linked order,
   one ticket — fired automatically at check-in.
