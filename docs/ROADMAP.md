# Taproot POS — Full Production Roadmap
# Version 1.0 | June 2026
# Author: Jake Castillo + Claude

---

## CONTEXT & BASELINE

Built in 2 active build sessions (~48 hours).
73 commits. ~28,000 lines of code.
Live at taproot-pos.com as of June 4, 2026.

### Velocity Baseline (measured)
- Simple bug fix: 20-30 minutes per prompt
- Medium feature (1-2 components): 1-2 hours per prompt
- Complex feature (DB + API + UI): 2-4 hours per prompt
- Full system (multi-file, migrations, tests): 4-6 hours per prompt

### Daily Session Assumptions
- Dedicated build day: 4-6 prompts = 4-8 hours of active work
- Casual build day: 1-2 prompts = 1-2 hours
- Solo founder working alongside other responsibilities
- Assume 3 dedicated build days per week, 2 casual days
- Each "sprint" is one week (5 working days)

---

## THE FULL VISION

> Taproot is the first POS system that gets smarter every day —
> learning your restaurant, predicting your needs, and running
> like a silent business partner that never sleeps, never quits,
> and never charges you a surprise fee.

### Core Promises
- No contracts. Cancel anytime.
- No hidden fees. $199/month flat.
- Any hardware. iPad, Android, any browser.
- 10-minute setup with AI menu import.
- Your data, always. One-click export anytime.
- Support during service hours, not 3 days later.

---

## SPRINT 1 — BETA 1.1: Settings & Admin ✅ COMPLETE (v0.2.0-beta-1.1)
### Week of June 9, 2026

**S1-01** ✅ Product Management UI — /settings/products, create/edit/delete, day-parts
**S1-02** ✅ Category Management UI — /settings/categories, drag reorder, color/icon
**S1-03** ✅ Modifier Group Management — /settings/modifiers, groups + options, assign to products
**S1-04** ✅ Business Settings — /settings/business, configurable tax (replaced hardcoded 8.5%), receipt
**S1-05** ✅ Employee Management — /settings/employees, PIN login lock screen, roles, deactivate
**S1-06** ✅ Settings Shell + Navigation — /settings root, left nav, mobile tab bar, permission guard
**S1-07** ✅ Payments & Stripe Settings — Stripe Connect status, payment methods toggle, fee display
**S1-08** ✅ Sprint 1 Integration Test + Deploy — v0.2.0-beta-1.1 tag

---

## SPRINT 2 — BETA 1.2: Transaction Management ✅ COMPLETE (v0.3.0-beta-1.2)
### Week of June 16, 2026

**S2-01** ✅ Order History Screen — /orders, filter/search, detail drawer
**S2-02** ✅ Void & Refund — order void + full/partial/by-item refund, Stripe-aware
**S2-03** ✅ Tip Management — tip entry, adjust-tip, tip reports (fixed tip double-count)
**S2-04** ✅ Cash Drawer Management — open/close/drop, discrepancy (migration 015)
**S2-05** ✅ End of Day Report — one-click EOD, CSV, print
**S2-06** ✅ Split Check — even + custom (by-item deferred)
**S2-07** ✅ Sprint 2 Integration + Deploy — fixed BUG-ORD-001 (order-create contract); v0.3.0-beta-1.2

---

## SPRINT 3 — BETA 1.3: Table Service
### Week of June 23, 2026

**S3-01** Floor Plan Editor — /settings/floor-plan, drag-drop canvas, table shapes, sections
**S3-02** Table Service POS Mode — table view, status colors, server assignment, course firing
**S3-03** QR Code Ordering — public menu URL, customer scans to order, Stripe payment
**S3-04** Kitchen Display System — /kitchen full-screen, real-time orders, bump/complete
**S3-05** Waitlist & Reservations — /reservations, SMS notifications via Twilio
**S3-06** Sprint 3 Integration Test + Deploy — v0.4.0-beta-1.3 tag

---

## SPRINT 4 — BETA 1.4: Online Ordering & Customer Engagement
### Week of June 30, 2026

**S4-01** Public Online Menu — taproot-pos.com/order/[slug], Stripe payment, pickup/delivery
**S4-02** Online Ordering Settings — enable/disable, pickup times, delivery radius/fee
**S4-03** Loyalty Program — points config, tier thresholds, POS checkout integration
**S4-04** Gift Cards — sell/redeem at POS, digital delivery, balance management
**S4-05** Discount Code Engine — %, fixed, BOGO, happy hour, validation, reporting
**S4-06** Customer Management — /customers, profiles, lifetime value, tags, CSV export
**S4-07** Sprint 4 Integration Test + Deploy — v0.5.0-beta-1.4 tag

---

## SPRINT 5 — BETA 1.5: AI Intelligence Layer
### Week of July 7, 2026

**S5-01** Demand Forecasting Engine — Claude-powered sales forecast, cached 4 hours
**S5-02** AI Staff Scheduling — forecast → staffing recommendation, labor cost % alerts
**S5-03** AI Menu Engineering — Stars/Plowhorses/Puzzles/Dogs matrix, suggested actions
**S5-04** AI Food Cost Intelligence — real-time food cost %, ingredient price alerts, auto PO drafts
**S5-05** Daily Intelligence Feed — morning summary, real-time alerts, SMS/email delivery
**S5-06** Enhanced AI Copilot — conversation history, suggested questions, chart output
**S5-07** Sprint 5 Integration Test + Deploy — v0.6.0-beta-1.5 tag

---

## SPRINT 6 — BETA 2.0: Scale & Infrastructure
### Week of July 14, 2026

**S6-01** Multi-Location Dashboard — location switcher, cross-location reports, push menu update
**S6-02** Offline Mode — IndexedDB queue, conflict resolution, sync log
**S6-03** ESC/POS Printer Support — Epson/Star thermal, cash drawer kick, print server app
**S6-04** Barcode Scanner Support — scan to add to cart, gift card scan, barcode assignment
**S6-05** DoorDash Drive Integration — driver request API, customer tracking SMS
**S6-06** QuickBooks/Xero Sync — daily sales sync, OAuth, chart of accounts mapping
**S6-07** Sprint 6 Integration Test + Deploy — v1.0.0 tag

---

## SPRINT 7 — V1.0: Go-To-Market Polish
### Week of July 21, 2026

**S7-01** AI Phone/Text Ordering — Twilio number, Claude parses SMS orders, confirmation text
**S7-02** Kiosk Mode — locked full-screen, customer-facing, upsell prompts, PIN exit
**S7-03** Onboarding Wizard Rewrite — 7-step guided setup, < 5 min per step
**S7-04** Product Hunt + Marketing Assets — landing page, pricing comparison, blog post

---

## SPRINT 8 — ENTERPRISE FOUNDATIONS
### Week of July 28, 2026

**S8-01** Franchise Mode — corporate menu propagation, roll-up reporting
**S8-02** Customer-Facing Display — second screen, real-time order confirmation
**S8-03** Advanced Reporting Suite — P&L, labor %, food cost trending, cohort analysis
**S8-04** API & Webhooks — public API, webhook subscriptions, developer docs

---

## FULL TIMELINE

| Sprint | Theme | Week | Release |
|--------|-------|------|---------|
| Sprint 1 | Settings & Admin | June 9-13 | Beta 1.1 |
| Sprint 2 | Transaction Mgmt | June 16-20 | Beta 1.2 |
| Sprint 3 | Table Service | June 23-27 | Beta 1.3 |
| Sprint 4 | Online Ordering | June 30-July 4 | Beta 1.4 |
| Sprint 5 | AI Intelligence | July 7-11 | Beta 1.5 |
| Sprint 6 | Scale & Infra | July 14-18 | Beta 2.0 |
| Sprint 7 | Go-To-Market | July 21-25 | V1.0 |
| Sprint 8 | Enterprise | July 28-Aug 1 | V1.1 |

**Target V1.0 launch: July 25, 2026 (8 weeks)**

---

## DAILY SCHEDULE TEMPLATE

### Dedicated Build Day (Mon/Tue/Fri)
```
09:00  Health check + git log + tsc checks (10 min)
09:10  Read CLAUDE.md — confirm current state
09:20  Begin Prompt 1 of the day
11:00  Break
11:15  Begin Prompt 2 of the day
13:00  Lunch
14:00  Begin Prompt 3 (if dedicated day)
16:00  Commit, push, verify Railway deploy
16:30  Update BACKLOG.md with any new issues found
16:45  Note next day's prompts in CLAUDE.md
17:00  Done
```

### Casual Build Day (Wed/Thu)
```
Open laptop at any point during day
Run lookback checklist (5 min)
Complete 1-2 prompts
Commit, push, done
```

### Session Start Checklist (every day)
1. curl https://taproot-production-3d63.up.railway.app/api/health
2. git log --oneline -5
3. npx tsc --noEmit in apps/web → 0 errors
4. npx tsc --noEmit in apps/api → 0 errors
5. Read CLAUDE.md — note current prompt number
6. Check BACKLOG.md — any P0 bugs? Fix first.

### Session End Checklist
1. All changes committed and pushed
2. Railway deploy successful (check health endpoint)
3. CLAUDE.md updated with prompts completed
4. BACKLOG.md updated with any new issues
5. Next session's prompts noted

---

## PRINCIPLES FOR BUILDING WITH AI

1. **Read before writing** — always read every file you'll change before changing it
2. **TypeScript is your test suite** — 0 errors before every commit
3. **Commit often** — one feature per commit, descriptive messages
4. **Safe defaults everywhere** — missing config should never crash the app
5. **Mobile first** — test at 1366x768 and on iPhone viewport
6. **The edit chain must be unbroken** — when data flows UI→API→DB, trace every link
7. **Migrations are one-way** — always write both up() and down()
8. **Never hardcode values** — tax rate, model name, URLs all belong in config/DB
9. **The POS is sacred** — payment flow must NEVER crash; add null guards everywhere
10. **Read CLAUDE.md first** — it is the single source of truth for project state
