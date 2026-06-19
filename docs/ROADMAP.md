# Taproot Platform Roadmap — v2.x Multi-Vertical

> Steering document. Tracks SEQUENCE and DEPENDENCY,
> not time estimates. Detailed fitness spec lives in
> docs/STUDIO_MODULE_SPEC.md. Update the "Current
> Position" marker as phases land.

## Current Position
**v1.9.0 shipped** — stable, real-money-safe restaurant
POS. All payment P0s + 13 P1s + WG-024 fixed. This is
the base the platform line builds on.
**Next: v2.0.0** — capability foundation.

---

## Strategic Frame

Taproot is becoming the ONE system a hybrid studio-café
needs, so their second system (a POS bolted onto
Mindbody/Mariana Tek) disappears.

Optimize for **time-to-Counter-Bridge**, NOT feature
parity with incumbents. Ship the thing they structurally
cannot do (a kitchen-aware POS fused with class booking);
add the things they can do as fast-follows.

v1 target customer: **hybrid studio-café** — not a pure
studio. Against Mindbody alone we're a newcomer; against
"Mindbody + a separate POS + reconciling two systems"
we're the only unified option.

---

## The Spine: Capabilities, Not Verticals

organizations.capabilities (JSONB):
- food_service (every restaurant today — default true)
- studio (flips on for fitness)
- retail
- billing_models { ... } (the configurable menu)

Onboarding wizard → preset → sets flags. UI/routes/
features render on flags. A hybrid gym =
food_service:true + studio:true, both native, one
codebase. This is the recipe_mode pattern generalized
to the org level.

Capabilities are editable in Settings (orgs evolve —
a restaurant can add studio later). Default-on for
existing orgs so nothing regresses.

---

## Billing Models (owner-configurable menu)

Ordered by difficulty / risk:

EASY (reuse hardened checkout, no new infra):
- Pay-as-you-go (drop-in) — already exists today
- Pre-paid package (class pack) — one-time charge +
  credit ledger (reuses WG-006 account_credit pattern)
- Free trial with account — identity + zero-dollar

MEDIUM:
- Free trial no account — access without identity

HARD (new payment surface, P0-level care):
- Monthly membership — Taproot-native recurring (v2.5)

EXTERNAL (third-party settlement):
- ClassPass integration (v2.6+)

Each model is an independent capability flag. Owner
picks; onboarding preset sets defaults. Off models
degrade gracefully (recipe_mode pattern).

---

## Release Sequence

### v2.0.0 — Capability Foundation
- organizations.capabilities JSONB (migration)
- Onboarding wizard + vertical presets
  ("Restaurant" / "Studio + Café" / "Retail")
- Preset → capability flags
- Capability-gated nav/routes/features
- Capabilities editable in Settings
- "Landing zone" post-login routing
- Restaurant behavior 100% unchanged (default true)
- **Risk: Low-Med** (gate touches all nav — must
  default-on for existing orgs)
- **Billing lit: none new**

### v2.1.0 — Member + Studio Catalog
- member extends customer (status, waiver, home
  location, tags) — extension, not new identity
- catalog item_type ext: drop_in, class_pack, add_on
  (membership/gift_card defined, dormant)
- studio_meta JSONB per type
- Digital waivers (e-sign, stored on member)
- Sell drop-ins + packs via EXISTING checkout
- Credit ledger (buy N, burn down)
- Manually-managed membership records (owner records
  an existing membership + entitlements; Taproot
  tracks access, does NOT charge — bridge until v2.5)
- **Risk: Low** (reuses hardened rails, no new payment
  surface, no calendar)
- **Billing lit: drop-in, packs, free-trial-with-account**

### v2.2.0 — Scheduling Core + Importers
- class_template, class_session, room
- reservation (booked → checked_in → completed)
- Self-service booking (web)
- Check-in (staff + self + QR), roster
- Schedule auto-import (CSV/ICS) — auto-setup parity
- **FITNESS-IMPORT-001**: Mindbody + Mariana Tek
  migration importers (members, packs, subscriptions,
  schedule, card vault). Reuse the Toast importer
  pattern: parse → dry-run diff → review → commit.
  Lands here because member+catalog+schedule models
  now exist to import INTO.
- **Risk: Med** (net-new calendar domain; CRUD +
  state machine, no money movement, no worker yet)
- **Billing lit: none new (bookings paid via v2.1 credits)**

### v2.3.0 — 🚩 COUNTER BRIDGE (moat proven — ship & sell)
- reservation carries add_on[] (pre-ordered items)
- checkin.completed event → fires café/bar KDS ticket,
  timed to class end
- ONE order (mixed item_types), ONE payment, ONE payout
- Member account_credit funds both (WG-006)
- **Risk: Med** (wires existing pieces: scheduling +
  check-in + KDS + WG-011/012 inventory)
- **Billing lit: none new (fulfillment + unified ledger)**
- A migrated hybrid studio is FULLY OPERATIONAL here:
  members imported, memberships tracked (manual mode),
  classes running, café bridged, packs/drop-ins/trials
  billing live. Everything below WIDENS the market; it
  does not gate operation.

--- (everything below widens market, doesn't gate) ---

### v2.4.0 — Scheduled Worker + No-Show Economics
- **Pull FITNESS-INFRA-001.** Scheduled worker =
  Railway Cron → authed internal endpoint (Option A:
  stateless, no boot-path change, easy revert). Other
  options (separate service / queue consumer) preserved
  in backlog if A proves insufficient.
- No-show / late-cancel engine (time-triggered, auto-
  charges fee — money on a deadline, P0-level care)
- Waitlist auto-promote + SMS
- Booking cutoff / cancel window enforcement
- **Risk: HIGH** (new infra + time-triggered money)
- **Billing lit: none new (no-show FEES are money-
  movement — treated with payment care)**

### v2.5.0 — Taproot-Native Recurring Memberships
- **Pull FITNESS-BILLING-001.** Recommended: Option C —
  Stripe Billing owns the money (cadence, dunning,
  proration, retries); member_subscription mirrors
  state via webhooks and owns MEANING (entitlements,
  food credits, booking windows). Money = Stripe,
  meaning = Taproot.
- member_subscription full lifecycle (freeze/pause/
  cancel), dunning, entitlements
- TAKES OVER the money from v2.1 manual-managed mode
- **Risk: HIGH** (new payment surface — gets its own
  mini-audit like the v1.9 WG payment work)
- **Billing lit: monthly membership**

### v2.6.0+ — Tier 3 Innovations (independent, pull as needed)
- Dynamic/yield pricing on class_session
- AI front desk over live schedule/billing
- Churn radar / member.at_risk
- Engagement: challenges, streaks, leaderboards
- Smart waitlist economics (standby pricing)
- ClassPass / marketplace connectors (external billing)
- Wearable hooks
- Custom report builder + warehouse export
- Multi-rate instructor payroll
- PaymentGateway multi-processor — ONLY if a real
  contract demands it. Keep the interface seam; ship
  only taproot_pay (Stripe Connect) behind it until then.

---

## Parked Decisions (pull at their phase)

### FITNESS-INFRA-001 — Scheduled worker subsystem (v2.4)
Required for: no-show engine, waitlist auto-promote.
Breaks the "no setInterval in index.ts / boot path" rule.
- Option A (chosen direction): Railway Cron → authed
  endpoint processes due no-shows/promotions. Stateless,
  no boot-path change, easy revert.
- Option B: separate Railway worker service + queue
- Option C: BullMQ consumer (repo has queues/) + scheduler
Start with A; escalate only if needed.

### FITNESS-BILLING-001 — Recurring membership engine (v2.5)
- Option A: Stripe Billing end-to-end (least code)
- Option B: self-managed recurring (max control, max
  risk — requires the scheduled worker + full P0 care)
- Option C (recommended): Stripe Billing for money,
  Taproot member_subscription for entitlements/meaning
Decide when v2.5 begins.

---

## What Changed From the Spec (docs/STUDIO_MODULE_SPEC.md)
1. Added v2.0 capability foundation as an explicit
   gating release (spec assumed it).
2. Counter Bridge moved EARLIER as the climax/sellable
   milestone (v2.3), not a Phase-4 innovation. It IS
   the product.
3. Recurring memberships moved LATER (v2.5) — riskiest;
   packs+drop-ins+trials+manual-membership-records make
   a sellable product without it.
4. Scheduled worker split into its own release (v2.4),
   flagged as the one new-infra decision (Option A).
5. Migration importers (Mindbody/MT) promoted to
   launch-class (v2.2), reusing the Toast importer —
   the importer is the wedge's delivery mechanism.
6. PaymentGateway multi-processor demoted to "only if
   a contract demands it" — keep the seam, don't build
   N integrations.

---

## Core Constraints (inherited — never violate)
- Money = INTEGER CENTS everywhere
- Multi-tenant: every query filtered by organization_id
- Feature-flag new subsystems dormant + opt-in
  (recipe_mode pattern); existing behavior untouched
- Never touch index.ts / content-type parsers / boot path
- Migrations: tclaude writes, Jake runs in Railway,
  verify with SELECT (two-step)
- Every new payment surface gets P0-level care + audit
