# Taproot v2 Studio Platform — Activation Runbook

> The exact, ordered, **human-run** sequence to take the v2 studio platform live.
> Tonight's prep (branch `activation/v2-prep`) did the safe work + proved the wired API
> boots locally. The Tier-3 steps below are **NOT done** — they run **supervised**, with
> Jake, against prod. Each step has command → verify → rollback.

---

## ⚠️ CRITICAL: deploy `activation/v2-prep`, NOT `v2`
`v2` contains the studio CODE but: (a) the route files are **not wired** into index.ts,
(b) it carries a **latent route-path collision** (studio booking declared `/api/v1/reservations`,
which collides with the existing restaurant reservations — Fastify crashes at boot the moment
the routes are wired), and (c) it has **no** payment grantCredits hook.
`activation/v2-prep` = `v2` **+** the collision fix **+** the 7 route registrations **+** the
payment seam, and is the **only boot-verified** artifact. Deploy `activation/v2-prep` (or merge
it into `v2` first, then deploy `v2`). Deploying `v2` as-is = studio inert; wiring `v2`'s routes
without the fix = **boot crash**.

---

## Pre-flight (done tonight — for your confidence)
- **Killer-hunt:** found ONE boot-crasher — `POST/DELETE /api/v1/reservations` collided with
  `reservation.routes` (restaurant table booking). **FIXED** on `activation/v2-prep` by
  namespacing studio paths → `/api/v1/class-reservations|class-sessions|class-waitlist` (api +
  web client; restaurant `/reservations` untouched). Content-type parsers in studio files: **zero**.
  Decorator/plugin collisions: **none**. Auth: studio routes inherit the global auth+subscription
  preHandler like every `/api/v1/*` route. Duplicate-path re-scan after fix: **clean**.
- **Local boot test:** `npm run dev` with all 7 studio routes wired → **Fastify reached
  "Server listening at http://127.0.0.1:3001"** with no duplicate-route/parser error (the
  admin-seed warning after listen is expected without a local DB — services graceful-guard).
  Re-ran with the payment seam → still boots. tsc 0 both apps.
- **Branch state:** `activation/v2-prep` @ `d7f9be1` (off `v2`). Wiring + fix + seam committed
  to the branch ONLY. **Nothing pushed. No migration run. main untouched.**

---

## STEP 1 — Migrations (run in Railway, IN ORDER, two-step each)
**Dependency: 032 → 033 → 034.** (033 adds `members` + `products.item_type`; 034's
`class_reservations` FKs `members`.) The v2 code is graceful-guarded, so running migrations
before OR after deploy is safe — **recommended: migrations first.**

**Method A (recommended) — node-pg-migrate from a shell with the prod `DATABASE_URL`:**
```bash
# pre-flight: confirm what's already applied
psql "$PROD_DATABASE_URL" -c "SELECT name FROM pgmigrations ORDER BY run_on DESC LIMIT 6;"
# runs every pending migration from the canonical files in order (incl. 031 if pending):
DATABASE_URL="$PROD_DATABASE_URL" npx node-pg-migrate up --migrations-dir migrations
```
**Method B (Railway Data tab) — run each file's `exports.up` SQL, then record it:**
`INSERT INTO pgmigrations (name, run_on) VALUES ('032_org_capabilities', now()) ON CONFLICT DO NOTHING;` (repeat per migration name).

### 032_org_capabilities  (short — inline)
```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE organizations SET capabilities =
  '{"food_service":true,"studio":false,"retail":false,"billing_models":{"drop_in":false,"class_packs":false,"free_trial":false,"memberships":false,"classpass":false}}'::jsonb
 WHERE capabilities = '{}'::jsonb;
```
- **Verify:** `SELECT id, capabilities->>'food_service' AS fs FROM organizations LIMIT 5;` → all `true`.
- **Down:** `ALTER TABLE organizations DROP COLUMN IF EXISTS capabilities;`

### 033_member_catalog  (DDL in `migrations/033_member_catalog.js` `exports.up`)
Creates `members`, `member_credits`, `member_subscriptions`, and `ALTER TABLE products ADD
COLUMN IF NOT EXISTS item_type varchar(50) NOT NULL DEFAULT 'food', ADD COLUMN studio_meta jsonb` + a CHECK.
- ⚠️ **The `products` ALTER on the live ~85-product menu:** `ADD COLUMN … DEFAULT 'food'` is
  **metadata-only** in Postgres 11+ (no full table rewrite). The CHECK constraint takes a brief
  ACCESS EXCLUSIVE lock to validate ~85 rows (all `'food'` → passes) — milliseconds. Safe under
  light load; if you want zero lock, run during a quiet minute.
- **Verify:** `SELECT to_regclass('public.members'), to_regclass('public.member_credits');`
  and `SELECT count(*) FROM products WHERE item_type <> 'food';` → `0`.
- **Down:** the file's `exports.down` (drops the 3 tables + the 2 product columns + CHECK).

### 034_scheduling  (DDL in `migrations/034_scheduling.js` `exports.up`)
Creates `studio_rooms`, `class_templates`, `class_sessions`, `class_reservations`, `class_waitlist`.
- **Verify (incl. the existing restaurant table is untouched):**
  `SELECT to_regclass('public.class_sessions'), to_regclass('public.class_reservations'), to_regclass('public.reservations');`
  → first two non-null (new), third still non-null (the EXISTING restaurant `reservations` table survives).
- **Down:** the file's `exports.down` (drops the 5 studio tables).

> Migrations DON'T revert with `git`. To roll back, run the `down` SQL above (reverse order: 034 → 033 → 032).

---

## STEP 2 — Deploy (human, AFTER migrations verified)
Deploy `activation/v2-prep` (the boot-verified artifact). Recommended: merge it into `v2` so v2
is canonical, then fast-forward `main`:
```bash
git checkout v2 && git merge --ff-only activation/v2-prep        # v2 now carries fix+wiring+seam
git checkout main && git merge v2                                # ⚠️ pushing main deploys Vercel + Railway
git push origin main
```
- ⚠️ **This single push deploys the frontend (Vercel) AND the API (Railway) simultaneously.**
- **Tag a rollback point first:** `git tag pre-v2-activation v1.9.0-or-current-main-sha` before merging.

---

## STEP 3 — Boot-path verification (human watches — index.ts changed)
Immediately after deploy, poll health 5×:
```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "try $i: HTTP %{http_code}\n" --max-time 10 \
  https://taproot-production-3d63.up.railway.app/api/health; sleep 5; done
curl -s https://taproot-production-3d63.up.railway.app/api/health | python3 -m json.tool
```
- **Healthy:** all 200; `status:"ok"`; db/redis/stripe ok; fresh `uptime` (just booted).
- **Crash-loop:** 502 / 000 / connection refused, or uptime never climbs. → **IMMEDIATE REVERT** (Step Rollback).
  The local boot test makes a route-registration crash unlikely, but prod env differs — watch it live.

---

## STEP 4 — Restaurant regression check (human clicks — what health MISSES)
Log in as a **restaurant** user (the demo org). A health check won't catch a white-screen or a
broken payment. Verify, by clicking:
1. POS register loads; product grid populates; **nav is unchanged** (no Classes/Members/Studio items — demo org has `studio:false`).
2. Create a test order → take a **cash** payment → receipt renders. (Confirms the payment seam didn't disturb the path.)
3. Open the KDS → the order's ticket appears, can be bumped.
4. Settings → Capabilities page loads and shows food_service on, studio off.
- Any white screen / 500 / payment failure → **REVERT**.

---

## STEP 5 — Activate studio (human — on a THROWAWAY org ONLY)
- Create a **NEW test org** via the normal register flow (NOT demo, NOT a real customer).
- Flip its studio capability (either path):
  - **UI:** log in as that org's owner → Settings → Capabilities → toggle **Studio** on → Save.
  - **SQL:** `UPDATE organizations SET capabilities = jsonb_set(capabilities,'{studio}','true') WHERE id = '<test-org-id>';`
- ⚠️ **Do NOT flip studio on the demo org or any real org.** Verify the org id twice.

---

## STEP 6 — End-to-end smoke test (human, eyes open — the moat demo)
As the test org (studio on):
1. **Studio Catalog** → create an `add_on` item "Recovery Smoothie" ($8) and a `class_pack` "10-Pack" (credits 10).
   → DB: `SELECT name,item_type,studio_meta FROM products WHERE item_type IN ('add_on','class_pack');`
2. **Members** → add a member; optionally link a customer. Grant a 10-credit pack (or buy the class_pack to trigger the seam).
   → DB: `SELECT total FROM` … or `SELECT credits_remaining FROM member_credits WHERE member_id='…';` → 10.
3. **Classes** → create a class (weekly, a day+time, capacity, 1 credit) → **Generate** sessions (next 2 weeks).
   → DB: `SELECT count(*) FROM class_sessions WHERE template_id='…';` → > 0; check `starts_at` is the right local time.
4. **Book** the member into a session → credit deducts.
   → DB: `SELECT state, credit_txn_id FROM class_reservations WHERE member_id='…';` → `booked`, credit_txn_id set; member balance now 9.
5. **Pre-order add-on** (☕ in the roster) → the Smoothie.
   → DB: `SELECT add_on_order_id FROM class_reservations WHERE …;` set; `SELECT status FROM orders WHERE id=<that>;` → **`parked`**.
6. **Check the member in.** → the panel flips to "fired to the counter".
   → DB: `SELECT status FROM orders WHERE id=<add_on_order_id>;` → **`open`** (parked→open = fired). The Smoothie now appears on the café KDS.
7. **Pay** the smoothie at the counter (normal POS) → bump. (If you bought the class_pack via checkout, confirm the seam granted credits: `SELECT * FROM member_credits WHERE source_ref LIKE '<orderId>:%';`.)
- **Success:** one reservation, one linked order, parked→open at check-in, credit deducted on book, café ticket fired. That's the moat.

---

## Rollback playbook (reverse order of apply)
1. **Code (fastest):** `git checkout main && git reset --hard pre-v2-activation && git push --force-with-lease origin main` (redeploys v1.9.0). OR `git revert <merge-sha> && git push`.
2. **Studio data:** flip the test org back (`…'{studio}','false'…`) — studio UI/routes go inert immediately (no deploy needed).
3. **Migrations (only if you must fully undo):** run each `down` in REVERSE: 034 down → 033 down → 032 down. (Dropping these tables is safe — they're studio-only and isolated; the restaurant `reservations`/`tables` are never touched.)
- Migrations do NOT auto-revert with git. Code revert + leaving the (unused) studio tables in place is the usual, lowest-risk rollback — the columns/tables are inert when the v2 code isn't deployed.

---

## GO / NO-GO assessment
**Verdict: GO for supervised activation.**
- Boot test: **PASS** (Fastify "listening" with all 7 routes; no dup/parser crash). The single most
  likely prod-killer (route collision) was found and fixed.
- Killers: **clean** after the fix (zero parsers, zero decorate collisions, auth inherited correctly).
- Payment seam: **safe** — fire-and-forget, studio-gated + table-guarded inside (restaurant returns
  after one cached read), reuses v2.1 grantCredits, idempotent. Restaurant payment path byte-identical.
- tsc 0 both apps; lint 0 errors.

**Remaining unknowns for Jake to weigh:**
1. Prod env differs from local (real DB/Redis, real traffic) — the live boot-poll (Step 3) is the real test; have the revert ready.
2. Deploy the **right artifact** (`activation/v2-prep`, not bare `v2`).
3. `33`'s products CHECK constraint briefly locks the products table (ms on 85 rows) — trivial, but run in a quiet minute if cautious.
