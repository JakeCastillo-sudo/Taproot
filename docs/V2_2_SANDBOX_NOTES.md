# v2.2 Scheduling + Check-in + Importers — Sandbox Review Notes

> **Branch:** `feat/v2.2-scheduling` (off `feat/v2.1-member-catalog`) · **LOCAL ONLY —
> never pushed.** Migration 034 written, **NOT run.** Boot path (`index.ts`), content
> parsers, and `payment.service`/`order.service` cores **untouched** — and the EXISTING
> `scheduling.service` (employee shifts) / `reservation.service` (restaurant tables) are
> untouched too. tsc 0 both apps; lint 0 errors. All studio-gated — restaurants byte-identical.

The calendar/booking domain the Counter Bridge (v2.3) sits on. Commits (logical chunks):
`80aa57f`-era backend core → frontend → importer (this doc).

---

## 1. ⚠ NAMESPACE COLLISION CATCH (read first)
The restaurant app ALREADY has a `reservations` table (migration 016, table-booking),
a `tables` table (001), and `scheduling.service` (employee shifts) + `reservation.service`
(restaurant tables). A naïve `CREATE TABLE reservations` would silently no-op (IF NOT
EXISTS) and corrupt restaurant data. So the studio domain is fully **namespaced**:
- Tables: `studio_rooms`, `class_templates`, `class_sessions`, `class_reservations`, `class_waitlist`.
- Services: `studioSchedule.service` (not scheduling), `classBooking.service` (not reservation).
- Types: `StudioRoom`, `ClassReservation`, `ClassWaitlistEntry`, …
None of the existing restaurant scheduling/booking code is touched.

## 2. THE TIME MODEL (the critical-path decisions + why)
- **template vs session.** `class_templates` = the recurring DEFINITION + policy defaults.
  `class_sessions` = concrete DATED instances. Sessions **copy** policy fields (capacity,
  credits_required, cutoffs, price) from the template at generation, so editing a template
  never retroactively mutates already-generated/booked sessions. One-off sessions
  (template_id NULL) are allowed.
- **Materialization = EAGER** (`generateSessions(templateId, from, to)`). WHY: reservations
  FK to real session rows, so you must materialize to book. Idempotent via
  `uq_class_sessions_template_start` (`ON CONFLICT DO NOTHING`) — re-generating a range never
  duplicates. Generation is an explicit owner action; auto-generation-ahead is v2.4 (the
  scheduled worker), deliberately NOT built here.
- **Timezone.** `starts_at`/`ends_at` are `timestamptz` (UTC). The template holds a local
  wall-clock `time` + recurrence days; each occurrence's start is computed in Postgres as
  `(occurrence_date + local_time) AT TIME ZONE location_tz` → **DST-correct**, matching the
  codebase's existing `AT TIME ZONE $tz` convention. Display local on the client.
- **Consumption = DEDUCT-AT-BOOK.** A credit is spent when the spot is reserved; check-in
  just confirms attendance; an early cancel (before cutoff) RESTORES the credit; a late
  cancel / no-show forfeits it. WHY: simpler accounting, matches most studios, and forfeiture
  on no-show is the studio's revenue model. The deduct **composes into the booking
  transaction** (see §5) so credit-move + reservation-insert commit atomically — no lost credits.
- **recurrence jsonb**: `{ "freq":"weekly", "days":[0..6], "time":"HH:MM", "until":"YYYY-MM-DD"? }`
  (days 0=Sun..6=Sat). Weekly only in v2.2 (covers ~all studio schedules).

## 3. Reservation state machine
States: `booked | waitlisted | checked_in | late_cancel | no_show | completed` (+ a clean
early cancel = `deleted_at`, NOT a state — frees the spot + restores credit). Transitions:
- (book) → **booked** (deduct credit)  · (waitlist) → **waitlisted**
- booked → **checked_in** (idempotent)  · booked → soft-deleted (early cancel, restore)
- booked → **late_cancel** (after cutoff, forfeit) · booked → **no_show** (manual; auto-fee v2.4)
- waitlisted → booked (manual promote; auto-promote v2.4)
Double-book guard: `uq_class_reservations_active (session_id, member_id) WHERE state NOT IN
('late_cancel','no_show') AND deleted_at IS NULL`. Booking also locks the session `FOR UPDATE`
and re-checks capacity, so capacity/dup are race-safe.

## 4. Schema + enums (migration 034)
`studio_rooms`, `class_templates` (recurrence, policy defaults), `class_sessions`
(timestamptz, status `scheduled|live|closed|cancelled`, hot index on
`(organization_id, location_id, starts_at)`), `class_reservations` (source/state enums,
`credit_txn_id`, **`add_on_order_id` reserved for v2.3**), `class_waitlist`. All `IF NOT
EXISTS`, idempotent, clean `down`.

## 5. v2.1 credit hooks — what's wired, what's a seam (restaurant path PROVEN unchanged)
- **deduct (check-in/booking) → WIRED** inside `classBooking.book()` (deduct-at-book). To make
  it atomic, `memberCredit.deductCredit`/`restoreCredit` gained an **optional transaction
  client** param (additive, backward-compatible) so they compose into booking's/cancel's txn.
  All credit math still lives in `memberCredit.service` — no new math elsewhere.
- **class_pack purchase → grantCredits = DOCUMENTED SEAM (NOT wired).** Auto-granting credits
  when a class_pack is checked out would require an order-completion hook in
  `payment.service`/`order.service` — CORE files this sandbox must not touch unsupervised. The
  `grantCredits` primitive is ready + idempotent (`source_ref` = order id). Supervised wiring,
  studio-gated so the restaurant path stays byte-identical, would look like (in
  `payment.service` after `orderCompleted`):
  ```ts
  // studio-gated, class_pack line items only:
  if (await hasCapability(orgId, 'studio')) {
    for (const li of classPackLineItems) {
      await grantCredits(orgId, employeeId, { memberId, count: li.creditCount,
        sourceCatalogItemId: li.productId, sourceRef: orderId });
    }
  }
  ```
  **Proof the restaurant order path is unchanged:** zero lines of `payment.service`/
  `order.service` are modified on this branch (`git diff` shows neither file). The hook is text
  in this doc only.

## 6. 3-layer studio gate (restaurants see nothing)
1. **Nav**: the "Classes" item carries `cap:'studio'`; POSLayout filter hides it unless studio on.
2. **Page**: `useRequireStudio()` redirects non-studio orgs off `/studio/*`.
3. **API**: every studio route is `requireManager` + 404 when `hasCapability('studio')` is false.
Plus services `to_regclass`-guard their tables → safe before migration 034 runs.

## 7. Files
**New (api):** `services/studioSchedule.service.ts`, `services/classBooking.service.ts`,
`services/studioImport.service.ts`, `routes/studioSchedule.routes.ts`,
`routes/classBooking.routes.ts`, `routes/studioImport.routes.ts`, `migrations/034_scheduling.js`.
**New (web):** `pages/StudioSchedulePage.tsx`, `pages/StudioImportPage.tsx`.
**Changed:** `packages/shared/src/types/index.ts` (scheduling types), `services/memberCredit.service.ts`
(txn-composable deduct/restore + restoreCredit), `web/lib/api.ts` (clients),
`web/components/layout/POSLayout.tsx` (Classes nav item), `web/App.tsx` (routes).

## 8. Migration 034 — two-step Railway run (IF approved)
STEP 1: run `exports.up` from `migrations/034_scheduling.js` (all `IF NOT EXISTS`), then
`INSERT INTO pgmigrations (name, run_on) VALUES ('034_scheduling', now()) ON CONFLICT DO NOTHING;`
STEP 2 verify:
```sql
SELECT to_regclass('public.studio_rooms'), to_regclass('public.class_sessions'), to_regclass('public.class_reservations');
SELECT to_regclass('public.reservations');  -- the EXISTING restaurant table, must still exist + be unchanged
```

## 9. Seams (wire supervised later)
Route registration (3 files, boot path untouched):
```ts
import studioScheduleRoutes from './routes/studioSchedule.routes';
import classBookingRoutes from './routes/classBooking.routes';
import studioImportRoutes from './routes/studioImport.routes';
await fastify.register(studioScheduleRoutes);
await fastify.register(classBookingRoutes);
await fastify.register(studioImportRoutes);
```
Order-completion grant hook: §5. Nav/routes are already on-branch (gated). Without wiring, the
studio UI 404s/empties and restaurants reach nothing.

## 10. Importer status
**Members + Schedule: COMPLETE** (`studioImport.service`: parse → dry-run diff → commit, reusing
csv-parse/sync + member.service/studioSchedule.service, per-row try/catch tally). Keyword-based
column detection handles both Mindbody + Mariana Tek header variants. UI: `StudioImportPage`
(paste CSV → dry-run preview → import). **Card vault: OUT OF SCOPE** (PCI/contractual — flagged,
never attempted). **Pack-balance import: deferred** (needs member-by-email matching + grantCredits;
follow-up).

## 11. Deferred (by design)
- Waitlist **auto-promote** + **no-show auto-charge** → v2.4 (needs the scheduled worker; here it's
  manual promote + manual no-show, state-only).
- Taproot-native **recurring membership billing** → v2.5.
- **Counter Bridge** add-on firing on check-in → v2.3 (the `add_on_order_id` column is reserved now).
- Auto grant-on-checkout (§5). Public member-facing booking widget (here: staff-on-behalf booking).

## 12. Risk assessment
**Effect on existing behavior: none.** No core/boot file touched; the existing restaurant
scheduling/reservation/tables code and data are untouched (studio uses separate namespaced
tables). All UI studio-gated + fails open to "restaurant"; routes unwired (404) and services
table-guarded ⇒ inert for restaurants and safe pre-migration. **Look hardest at:** the
deduct-at-book atomicity (deductCredit composing into book's txn), the tz materialization SQL,
and confirming `reservations`/`tables`/`scheduling.service` are absent from the diff.

## 13. How to test locally
1. `npm run build --workspace=@taproot/shared`; `tsc --noEmit` both apps → 0.
2. Full path (local dev DB): wire the 3 route files into a LOCAL `index.ts` (don't commit), run
   migration 034 locally, set an org `capabilities.studio=true`, then: create a class → Generate
   sessions → book a member (credit deducts) → check in → early-cancel (credit restores) →
   import a Mindbody members CSV (dry-run → commit).
3. Restaurant check: studio off ⇒ no Classes nav, `/studio/schedule` redirects, routes 404.
