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

## SPRINT 3 — BETA 1.3: Table Service ✅ COMPLETE (v0.4.0-beta-1.3)
### Week of June 23, 2026

**S3-01** ✅ Floor Plan Editor — drag-drop canvas, shapes, sections, undo/redo
**S3-02** ✅ Table Service POS Mode — table view, status colors, table assignment
**S3-03** ✅ QR Code Ordering — public menu URL, customer ordering (pay-at-counter); verified live
**S3-04** ✅ Kitchen Display System — /kitchen full-screen, polling, item-ready/bump
**S3-05** ✅ Waitlist & Reservations — /reservations, SMS notify (Twilio stub)
**S3-06** ✅ Sprint 3 Integration + Deploy — v0.4.0-beta-1.3 tag

---

## SPRINT 4 — BETA 1.4: Online Ordering & Customer Engagement ✅ COMPLETE (v0.5.0-beta-1.4)
### Week of June 30, 2026

**S4-01** ✅ Online Checkout — pickup/delivery + Stripe Connect pay-now / pay-at-counter
**S4-02** ✅ Online Ordering Settings — enable/disable, pickup prep, delivery radius/fee, min order
**S4-03** ✅ Loyalty Program — config + automatic accrual (verified live: 97 pts on $97.94)
**S4-04** ✅ Gift Cards — issue/list/deactivate + POS code redemption (real balance)
**S4-05** ✅ Discount Code Engine — %/fixed/BOGO/free, validate + report (verified live: 10% applied)
**S4-06** ✅ Customer Management — /customers profiles, LTV, tags, CSV; CustomerSearch + (BUG-QA-012)
**S4-07** ✅ Sprint 4 Integration + Deploy — full discount+loyalty lifecycle verified; v0.5.0-beta-1.4

---

## SPRINT 5 — BETA 1.5: AI Intelligence Layer ✅ COMPLETE (v0.6.0-beta-1.5)
### Week of July 7, 2026
Pattern: deterministic SQL compute + optional Claude narrative (graceful without API key).

**S5-01** ✅ Demand Forecasting — DOW-averaged 7-day forecast + AI narrative, 4h Redis cache
**S5-02** ✅ AI Staff Scheduling — forecast → staff + labor % alerts (>30%)
**S5-03** ✅ AI Menu Engineering — Stars/Plowhorses/Puzzles/Dogs + actions
**S5-04** ✅ AI Food Cost — food cost %, high-cost items, auto reorder draft
**S5-05** ✅ Daily Intelligence Feed — morning briefing + alerts (SMS/email stub)
**S5-06** ✅ Enhanced AI Copilot — multi-turn history, suggested questions, charts (+ fixed nl-query bug)
**S5-07** ✅ Sprint 5 Integration + Deploy — all endpoints verified live; v0.6.0-beta-1.5

---

## SPRINT 6 — BETA 2.0: Scale & Infrastructure ✅ COMPLETE (v0.7.0)
### Week of July 14, 2026

**S6-01** ✅ Multi-Location — location CRUD, POS switcher, cross-location reports filter
**S6-02** ✅ Offline Mode — IndexedDB order queue, auto-sync on reconnect, offline banner
**S6-03** ✅ ESC/POS Printer Support — standalone print server, thermal client + fallback, Hardware settings
**S6-04** ✅ Barcode Scanner Support — POS scan→cart (gated), scan-to-assign barcode on products
**S6-05** ✅ Advanced Reporting Suite — Heatmap tab (7×24), cross-location filter, CSV export
**S6-06** ✅ QuickBooks/Xero CSV export — daily sales CSV + /settings/integrations
**S6-07** ✅ Sprint 6 Integration + Deploy — endpoints verified live; v0.7.0

---

## SPRINT 7 — V1.0: Go-To-Market Polish ✅ COMPLETE (v1.0.0) 🌿
### Week of July 21, 2026

**S7-01** ✅ AI Text Ordering — Twilio SMS webhook, Claude parse + fuzzy match, TwiML reply (opt-in)
**S7-02** ✅ Kiosk Mode — full-screen self-serve, upsell, idle reset, PIN exit
**S7-03** ✅ Onboarding Wizard Rewrite — 7-step (welcome/menu/review/team/payments/tax/done)
**S7-04** ✅ Landing Page + Marketing — V1.0 hero, comparison table, FAQ
**S7-05** ✅ Error Monitoring + Analytics — logger, process handlers, ErrorBoundary, Plausible/Sentry
**S7-06** ✅ Performance + Polish Pass — favicon/PWA verified, build green, patterns confirmed
**S7-07** ✅ V1.0 Release — live verified (health v1.0.0), docs, LAUNCH.md, tag v1.0.0

---

## SPRINT 8 — V1.1: ENTERPRISE FOUNDATIONS ✅ COMPLETE (v1.1.0)
### Built June 7, 2026

**S8-01** ✅ Franchise Mode — org_type/parent_org/franchise_code (017), network dashboard, invite/join, corporate menu push + locks
**S8-02** ✅ Customer-Facing Display — /display second screen via BroadcastChannel, idle/cart/thank-you states
**S8-03** ✅ Advanced Analytics — /analytics: cohort retention, menu-engineering scatter, staff void-rates, peak-hours heatmap, customer insights
**S8-04** ✅ API & Webhooks — taproot_live_* keys (018, scoped, sha256), HMAC outbound webhooks w/ retries + auto-disable, /settings/api
**S8-05** ✅ Food Allergen System — FDA Big 9 on products + customers (019), POS allergen alert, kitchen-ticket warnings
**S8-06** ✅ Performance — composite indexes (020), Redis read-through cache + invalidation, React.lazy heavy pages
**S8-07** ✅ Integration + Release — 206/206 tests (fixed 7 stale loyalty mocks), live endpoint verification, v1.1.0 tag

---

## SPRINT 9 — V1.2: AI INTELLIGENCE LAYER ✅ COMPLETE (v1.2.0)
### Built June 7, 2026 — the competitive moat: AI that helps operators daily, useful from day one

**S9-01** ✅ AI Demand Forecasting — single-date forecast (revenue range, orders, per-item prep quantities, checklist) via Claude w/ statistical fallback; ForecastWidget on /reports
**S9-02** ✅ AI Staff Scheduling + Time Clock — migration 021, clock in/out (PIN-screen option + POS clock-out), /schedule week grid, AI schedule suggestion w/ labor tracker
**S9-03** ✅ AI Menu Engineering — per-item recommendations + suggested actions/prices, quick-win cards w/ one-click archive/reprice
**S9-04** ✅ Daily Intelligence Feed — owner landing view: yesterday vs last week, alerts, AI insight, prep checklist, reorder ETAs
**S9-05** ✅ Food Cost Intelligence — recipe-based plate costs vs target, AI fix suggestions, savings potential, 90d trend, Fix modal
**S9-06** ✅ Enhanced Copilot — context-aware suggested questions, action buttons, copy/CSV export, conversation mode
**S9-07** ✅ Integration + Release — 206/206 tests, live AI endpoint verification, v1.2.0 tag

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

---

## SPRINT 10 — V1.3.0: Launch Polish & Go-To-Market ✅ COMPLETE
### 2026-06-07 (ran in parallel with Sprint 9 AI; frontend/docs scope only)

**S10-01** ✅ Production landing page — 13 sections, $99 GTM, savings calculator, FAQ, demo modal
**S10-02** ✅ Auth pages polish — split-screen login/register (auth logic preserved)
**S10-03** ✅ PWA — SVG favicon, OG image, SEO/social meta tags (manifest already complete)
**S10-04** ✅ Observability — error-page support contact + login analytics (ErrorBoundary/PageSkeleton/Plausible/analytics already present)
**S10-05** ✅ Docs — production README + docs/ONBOARDING.md (DEPLOYMENT/API already present)
**S10-06** ✅ Launch assets — docs/LAUNCH.md rewritten to $99 V1.3 kit
**S10-07** ✅ Integration + release — tsc 0 errors both apps, web build green, tagged v1.3.0
