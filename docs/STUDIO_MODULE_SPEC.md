# Taproot Studio — Technical Specification

**A fitness / studio reservation + membership module for Taproot POS**

Version 0.1 (Draft) · Target base: Taproot POS (taproot-pos.com)
Positioning inherited from core: flat **$99/month**, **no contract**, **auto-setup** ("reads your menu and sets itself up").

---

## 0. Why this module, and why Taproot specifically

Taproot POS is a flat-rate, no-contract restaurant POS with payment processing, a self-building catalog ("menu"), and a green-themed mobile-first UI. The two dominant fitness booking platforms — **Mindbody** (broad, marketplace-driven) and **Mariana Tek / Xplor Mariana Tek** (boutique-studio, spot-booking) — are powerful but draw a consistent set of complaints from owners on G2, Capterra, and studio-owner forums:

- **Fee creep**: pricing that starts low then scales per-location, per-feature, per-transaction; branded apps and marketing automation locked behind expensive tiers.
- **Processor lock-in**: Mariana Tek is Stripe-only; Mindbody uses a proprietary processor where stored cards may not transfer out.
- **Marketplace commissions**: Mindbody charges ~20% (capped ~$30) on new clients who book through its app.
- **Weak custom reporting**: owners resort to external warehouses (e.g., Snowflake) to get the cuts they need.
- **Rigid payroll**: one pay rate per staffer; multi-rate (different class lengths, front-desk vs. teaching) requires a paid add-on.
- **Thin retail/inventory**: simplistic product catalogs, slow to manage.
- **Contracts**: multi-month lock-ins (some 24-month) that owners can't exit even when the software underperforms.

Taproot's existing DNA — **flat price, no contract, fast auto-setup, owned payment rails, a real catalog engine** — directly neutralizes the top five complaints. The strategic wedge: **studios increasingly run a retail/café/smoothie-bar alongside classes.** A POS that already handles food-and-beverage and retail can become the *only* system a hybrid studio needs — one catalog, one checkout, one payout — instead of bolting a booking tool onto a separate POS.

This spec defines the booking layer that turns Taproot from "restaurant POS" into "studio + counter POS," organized in three tiers:

- **Tier 1 — Best-of (table stakes).** The proven, owner-loved features that any 2026 studio platform must have.
- **Tier 2 — Wishlist / gap-fillers.** The things owners explicitly say the incumbents do badly.
- **Tier 3 — Innovations.** Net-new capability, much of it powered by Taproot's POS heritage.

---

## 1. Design principles

1. **One catalog, one ledger.** Memberships, class packs, retail SKUs, and café items are all `CatalogItem`s on the same checkout and the same revenue ledger. No separate "studio money" vs. "retail money."
2. **Flat and transparent.** Every feature in Tier 1 ships in the base $99/month. No per-feature gates, no per-location surcharge, no marketplace commission. (This is a deliberate competitive position, not an oversight.)
3. **Processor-agnostic.** Abstract the payment processor behind a `PaymentGateway` interface so owners are never locked to a single vendor and card vaults are portable/exportable.
4. **Auto-setup parity.** The same "reads your menu and sets itself up" onboarding should ingest a class schedule (CSV/ICS/scrape) and stand up the booking calendar automatically.
5. **Mobile-first, offline-tolerant.** Front-desk check-in and booking must survive a flaky connection (queue + reconcile), matching POS expectations.
6. **Rules before bookings.** Commercial rules (plans, packs, freezes, cancellation/no-show windows) are configured first; scheduling and member-facing flows inherit them. This mirrors the recommended studio setup order and prevents the "billing wrong → booking wrong → reporting wrong" cascade.

---

## 2. Module architecture

```
Taproot Core (existing)
├── Catalog Engine ........... extended with item types: membership, class_pack, drop_in, add_on
├── Checkout / Payments ...... reused as-is; new PaymentGateway abstraction
├── Customer Records ......... extended into Member profile
├── Reporting Ledger ......... reused; new studio event sources feed it
└── Staff / Roles ............ extended with instructor role + multi-rate payroll

Taproot Studio (new module)
├── Scheduling Service ....... classes, appointments, rooms/resources, recurrence
├── Reservation Service ...... booking, spot selection, waitlist, no-show engine
├── Membership Service ....... plans, packs, freezes, dunning, transfers
├── Check-in Service ......... self / kiosk / proximity / staff
├── Engagement Service ....... challenges, milestones, win-back, reviews
├── Notification Service ..... SMS / email / push (two-way)
├── Insights Service ......... custom report builder + churn signals + warehouse export
└── Booking Widget / App ..... embeddable web widget + branded PWA
```

All services communicate over an internal event bus (`reservation.created`, `member.at_risk`, `payment.failed`, `checkin.completed`, etc.) so Tier-3 automations can subscribe without coupling.

---

## 3. Core data model

Concise schema (Postgres-style). Types abbreviated; FKs implied by `_id`.

### 3.1 Member
```
member
  id                uuid pk
  customer_id       uuid fk -> taproot.customer   # unifies retail + class identity
  display_name      text
  email             text
  phone             text
  status            enum(prospect, active, frozen, cancelled, lead)
  waiver_signed_at  timestamptz null
  liability_doc_id  uuid null
  home_location_id  uuid fk
  tags              text[]
  created_at        timestamptz
```

### 3.2 Catalog extensions (live on Taproot's existing catalog)
```
catalog_item
  ...existing fields...
  item_type         enum(retail, food, membership, class_pack, drop_in, add_on, gift_card)
  studio_meta       jsonb   # see below by type

# membership studio_meta:  { billing_interval, price, included_credits|"unlimited",
#                            booking_window_hrs, freeze_policy_id, commitment:"none" }
# class_pack studio_meta:  { credit_count, expiry_days, shareable:bool, transferable:bool }
# add_on studio_meta:      { fulfillment:"bar"|"retail"|"none", redeem_at:"checkin"|"prebook" }
```

### 3.3 Schedule + resources
```
class_template          # the recurring definition
  id, location_id, name, discipline, instructor_default_id,
  duration_min, capacity, room_id, spot_map_id null, price_drop_in,
  credits_required int

class_session           # a concrete dated instance
  id, template_id, location_id, starts_at, ends_at,
  instructor_id, capacity, status enum(scheduled, live, closed, cancelled),
  waitlist_capacity, booking_opens_at, booking_closes_at,
  cancel_cutoff_min, noshow_window_min

room
  id, location_id, name, capacity
spot_map                # for spot-booking (bikes / reformers / mats)
  id, room_id, layout jsonb   # grid of addressable spots [{spot_label,x,y,disabled}]
```

### 3.4 Reservation + waitlist
```
reservation
  id, session_id, member_id, spot_label null,
  source enum(member_app, widget, staff, kiosk, api),
  state enum(booked, waitlisted, checked_in, late_cancel, no_show, completed),
  credit_txn_id null, add_on_order_id null,
  booked_at, checked_in_at null

waitlist_entry
  id, session_id, member_id, position int, auto_promote bool, notified_at null
```

### 3.5 Membership lifecycle + payroll
```
member_subscription
  id, member_id, catalog_item_id, state enum(active, frozen, past_due, cancelled),
  current_period_end, freeze_until null, dunning_state, gateway_ref

instructor_pay_rule           # multi-rate by design (incumbent gap)
  id, staff_id, applies_to enum(class_template, discipline, role, session),
  ref_id null, rate_type enum(flat, per_head, per_head_tiered, hourly),
  amount numeric, tiers jsonb null
```

### 3.6 Payment abstraction (portability by design)
```
payment_gateway
  id, location_id, provider enum(taproot_pay, stripe, adyen, square, custom),
  config jsonb, is_default bool
card_on_file
  id, member_id, gateway_id, token, brand, last4, exportable bool default true
```

---

## 4. Tier 1 — Best-of feature set (ships in base, $99 flat)

These are the proven, owner-validated essentials. Each line notes the origin of the demand.

| # | Feature | Spec summary | Demand origin |
|---|---------|--------------|---------------|
| 1.1 | **Self-service booking (web + app)** | Real-time availability; book/cancel/reschedule from phone with no front-desk contact. ~81% of clients prefer self-booking. | Universal; survey-backed |
| 1.2 | **Spot booking** | Optional `spot_map` per room; member picks bike/reformer/mat from a visual grid. Toggle per class template. | Mariana Tek's signature strength |
| 1.3 | **Marketplace-style discovery** | Optional public class directory + "Reserve with Google"/ClassPass connectors — but **commission-free** by default. | Mindbody's marketplace, minus the 20% cut |
| 1.4 | **Waitlist with auto-promote + SMS** | FIFO or priority waitlist; auto-promotes on cancellation and texts the promoted member. | MT added this after owner outcry; now expected |
| 1.5 | **No-show / late-cancel engine** | Per-template `cancel_cutoff_min` + `noshow_window_min`; auto-charge fee or deduct credit; configurable grace. | MT's auto-penalty (~$10K/yr/studio uplift cited) |
| 1.6 | **Memberships, packs, drop-ins, intro offers** | Recurring plans, expiring credit packs, single drop-ins, trial/intro pricing — all as catalog items. | Table stakes across all platforms |
| 1.7 | **Automated billing + smart dunning** | Recurring charges, failed-payment retry logic, dunning sequences, freeze/pause, cancellation rules. | MyStudio-class billing; reduces revenue leakage |
| 1.8 | **Branded member app (PWA)** | White-label PWA with studio logo/colors — **included, not a $699 tier add-on.** | Direct answer to Mindbody's gated Ultimate app |
| 1.9 | **Integrated POS + retail** | Class checkout, retail, and café on one ledger (native Taproot strength). | MT/Mindbody retail catalogs called "too simplistic" |
| 1.10 | **Check-in suite** | Self check-in, tablet kiosk, staff check-in, optional proximity/QR check-in. | Clubworx/MT; reduces front-desk load |
| 1.11 | **Two-way SMS + email + push** | Confirmations, reminders, win-backs; replies route to staff inbox. | WellnessLiving-class comms |
| 1.12 | **Marketing automation** | Behavior-triggered journeys (first visit, lapsed, milestone), lead follow-up. | MT/ABC XLerate-class journeys |
| 1.13 | **Staff scheduling + multi-rate payroll** | Instructor scheduling **with multiple pay rates per person** (per class length, per-head, front-desk vs. teaching). | Explicit MT gap (one rate only; $100/mo add-on) |
| 1.14 | **Standard reporting** | Sales, attendance, retention, billing exceptions, instructor performance, by-location. | Universal; both incumbents called weak here |
| 1.15 | **Digital waivers** | E-sign liability/waiver in the booking flow; stored on `member`. | MT/Mindbody onboarding flow |
| 1.16 | **Family / shared bookings** | One payer books multiple members; sharable/transferable packs. | Clubworx "family bookings"; MT transfer gap |

---

## 5. Tier 2 — Wishlist / gap-fillers (the "we wish the incumbents did this")

These exist precisely because owners complain the current tools handle them badly.

### 5.1 Custom report builder + warehouse export
Drag-and-drop report builder over the studio ledger with savable views, scheduled email delivery, and a **native read-replica / warehouse export** (BigQuery/Snowflake/CSV) so owners never have to bolt on external tooling just to answer a custom question. Multi-location custom cuts (cross-studio member usage, intercompany) are first-class.

### 5.2 Membership movement & transfers
First-class **transfer / move / merge** between locations and between members: move a subscription, transfer remaining pack credits, merge duplicate profiles, relocate a member's home studio — all without support tickets.

### 5.3 Processor choice + card portability
`PaymentGateway` abstraction lets the owner pick or switch processors; `card_on_file.exportable = true` guarantees the vault can be exported on exit. No proprietary lock-in, no "your cards don't transfer" surprise.

### 5.4 Robust inventory / retail catalog
Bring Taproot's catalog depth to studio retail: variants, vendors, cost/margin, low-stock alerts, purchase orders, and bar/café modifiers — eliminating the "product catalog is too simplistic / time-consuming" complaint.

### 5.5 Reliability + offline resilience
Booking and check-in queue locally and reconcile on reconnect; published uptime targets; no "login loops," "broken booking links at launch," or "clear your cache" failure modes that owners reported during incumbent migrations. Import tooling validates client data before go-live (no missing-client imports).

### 5.6 No-surprise migration
Guided importer for members, packs, subscriptions, and card vaults from Mindbody/MT exports; dry-run + diff report before commit; no contract to trap an unhappy customer (inherits Taproot's no-contract stance).

### 5.7 Unified member 360 profile
One profile = attendance history + payment status + retail/café purchases + communications + progress. No tool-hopping to assemble a member view (a named churn-detection pain point).

---

## 6. Tier 3 — Innovations (Taproot's unfair advantages)

### 6.1 The Counter Bridge (flagship differentiator)
Because Taproot is already an F&B/retail POS, a class reservation can carry a **pre-ordered add-on** fulfilled at the counter.

- Member books the 6:00 PM ride and pre-orders a post-class smoothie (`add_on` with `fulfillment:"bar"`).
- At `checkin.completed`, the bar's KDS/ticket fires automatically, timed to class end.
- One tab, one payment, one payout. Retail attach-rate becomes a booking-flow upsell instead of a separate transaction.

No incumbent studio platform can do this natively, because none of them is also a kitchen-aware POS. This is the reason the two product worlds belong in one system.

### 6.2 Dynamic / yield pricing for classes
Airline-style yield management on `class_session`: price drop-ins and packs by predicted demand — surge peak 6 PM slots, discount dead 2 PM slots to lift utilization. Dynamic pricing is moving from differentiator to expectation in 2026; Taproot can ship it flat instead of as a premium tier.

### 6.3 AI front desk that actually answers
Conversational agent over the live data model (schedule, availability, member account, billing) for after-hours booking, lead capture, and FAQ — explicitly engineered to resolve account/billing/reschedule questions, since the #1 AI complaint about incumbents is "it doesn't give the answer." Also configures rules conversationally ("add a 12-hour cancel window to all reformer classes").

### 6.4 Predictive scheduling & churn radar
`member.at_risk` events from attendance frequency, pack burn-down, and payment health; month-over-month activity views; suggested win-back offers auto-drafted for staff approval. Predictive class-demand forecasting feeds 6.2's pricing and informs schedule planning.

### 6.5 Engagement layer
Studio-wide challenges, personal milestones, streaks, leaderboards, gamified attendance, plus automated CSAT surveys and host ratings/reviews — community features proven to lift attendance and retention.

### 6.6 Smart waitlist economics
Beyond auto-promote: optional **standby pricing** (discounted last-minute standby seats), **guaranteed-spot fees**, and dynamic cancel windows that tighten as a class fills — converting no-show risk into yield.

### 6.7 Wearable / device hooks
Optional integrations to surface heart-rate/performance data on the member profile and (where the discipline supports it) on the in-class spot display.

---

## 7. API surface (illustrative REST)

All endpoints under `/v1/studio`. Auth via Taproot's existing API keys/OAuth. JSON.

```
# Scheduling
GET    /classes?location_id&from&to            list sessions w/ availability
POST   /class-templates                        create recurring template
POST   /class-sessions/{id}/cancel             cancel + notify + refund credits

# Reservations
POST   /reservations                           { session_id, member_id, spot_label?, add_ons[] }
DELETE /reservations/{id}                       cancel (applies cutoff rules)
POST   /reservations/{id}/check-in
GET    /sessions/{id}/roster
POST   /sessions/{id}/waitlist                 join waitlist

# Membership
POST   /members
POST   /members/{id}/subscriptions             attach plan/pack
POST   /members/{id}/freeze                     { until }
POST   /members/{id}/transfer                   { to_location_id | to_member_id, scope }

# Commerce (reuses Taproot checkout)
POST   /checkout                               mixed cart: memberships + retail + café
POST   /gift-cards

# Insights
POST   /reports/run                            { dimensions, measures, filters }
GET    /reports/at-risk
POST   /exports/warehouse                       { destination, dataset }

# Webhooks (event bus → owner systems)
reservation.created | reservation.no_show | waitlist.promoted |
payment.failed | member.at_risk | checkin.completed | addon.fulfilled
```

---

## 8. Pricing & packaging position

| Item | Position |
|------|----------|
| Base module | **$99/month flat**, all Tier-1 + Tier-2 features, no per-feature gates |
| Additional locations | Flat per-location (no surcharge multipliers); contrast incumbents' per-location scaling |
| Branded app | **Included** (vs. Mindbody's ~$699 tier) |
| Marketplace bookings | **0% commission** (vs. ~20%/$30 cap) |
| Payment processing | Owner's choice of gateway; transparent rate, no proprietary lock-in |
| Contract | **None** (month-to-month), inherited from Taproot core |
| Tier-3 AI / dynamic pricing | Included or low flat add-on — explicitly *not* a premium paywall |

The entire pricing story is the marketing story: every line above is a direct rebuttal to a documented owner complaint about Mindbody/Mariana Tek.

---

## 9. Implementation phasing

**Phase 1 — Booking MVP (8–10 wks).** Catalog extensions; `class_template`/`class_session`; reservations; self-booking widget; check-in; reuse Taproot checkout. Goal: a studio can sell a drop-in and run a class.

**Phase 2 — Membership engine (6–8 wks).** Plans, packs, freezes, automated billing + dunning, waivers, multi-rate payroll, standard reports.

**Phase 3 — Differentiators (8–10 wks).** Spot booking, waitlist auto-promote + no-show engine, branded PWA, two-way SMS, marketing journeys, member 360.

**Phase 4 — Innovation (ongoing).** Counter Bridge, dynamic pricing, AI front desk, churn radar, engagement layer, warehouse export, wearables.

Build commercial rules → scheduling rules → member-facing flow → automations → reporting, in that order, per the recommended studio setup sequence.

---

## 10. Acceptance criteria (representative)

- A new studio can ingest a schedule and take its first booking in **under one day** of setup (auto-setup parity).
- A member can book, pick a spot, pre-order a smoothie, and check in — generating **one** payment and **one** bar ticket.
- A cancellation inside the cutoff auto-charges the configured fee and auto-promotes the top waitlister with an SMS, with no staff action.
- An owner can build a custom cross-location report and schedule it to email weekly **without external tooling**.
- An instructor who teaches two class lengths and works front desk is paid **three** correct rates from one payroll run.
- An owner can export their card vault and member data and leave **with no contract penalty**.

---

## Appendix A — Sourcing of demand signals

Feature demand in this spec was synthesized from public studio-owner sentiment on G2, Capterra, SoftwareAdvice, and 2026 studio-software buyer guides, plus the published feature sets of Mindbody and Xplor Mariana Tek. Recurring themes that shaped the tiers:

- **Loved/expected:** spot booking, waitlist-with-SMS, no-show automation, self-service mobile booking, automated billing + dunning, integrated POS, marketplace discovery, branded app, challenges/milestones.
- **Complained about (→ Tier 2):** fee/tier creep, processor lock-in, weak custom reporting (external warehouse needed), one-rate payroll, simplistic retail/inventory, hard membership transfers, reliability/migration failures, restrictive contracts.
- **Emerging/expected-soon (→ Tier 3):** AI front desk/receptionist, dynamic & predictive pricing, churn prediction, deeper engagement/community, wearable data.

*This is a draft architecture document, not legal, financial, or PCI-compliance guidance. Payment-vault export, card tokenization portability, and processor switching each carry PCI-DSS and contractual obligations that should be reviewed with a qualified compliance advisor before implementation.*
