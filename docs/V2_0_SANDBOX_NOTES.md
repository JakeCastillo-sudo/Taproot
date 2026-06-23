# v2.0.0 Capability Foundation — Sandbox Review Notes

> **Branch:** `feat/v2-capabilities` · **LOCAL ONLY — never pushed.** Migration 032
> written, **NOT run.** Boot path (`apps/api/src/index.ts`), content-type parsers,
> and `app.listen` untouched. tsc 0 both apps. This is a reviewable sandbox, not a
> shipped feature.

This is the v2.0.0 "capability spine" from `docs/ROADMAP.md` — the per-org feature
flags the multi-vertical platform renders on. It is the `recipe_mode` pattern
generalized to the **org** level. It ships **no** studio/retail features yet — only
the spine + onboarding + settings + nav gate, all default-safe.

---

## 1. The capabilities JSONB shape (+ rationale)

Stored in a new `organizations.capabilities jsonb` column:

```json
{
  "food_service": true,
  "studio": false,
  "retail": false,
  "billing_models": {
    "drop_in": false, "class_packs": false, "free_trial": false,
    "memberships": false, "classpass": false
  }
}
```

- **Top-level verticals** (`food_service` / `studio` / `retail`) gate nav/routes/features.
- **`billing_models`** is the owner-configurable menu (ROADMAP "Billing Models"); the
  flags exist now but their *features* land v2.1–v2.6 (drop-in/packs first, memberships v2.5).
- **Rationale for JSONB** (not columns): matches the existing `organizations.settings`
  pattern, lets v2.1+ add sub-keys without a migration each time, and mirrors how
  `locations.tax_config` / `settings.loyalty` already work.

The **source of truth** for shape + defaults is
`apps/api/src/services/capability.service.ts` (`DEFAULT_CAPABILITIES`, `PRESETS`); the
TS type is `Capabilities` / `BillingModels` in `@taproot/shared`.

---

## 2. Files created / changed

**New (6):**
- `migrations/032_org_capabilities.js` — adds the JSONB column + backfills existing orgs to `food_service:true`. **NOT run.**
- `apps/api/src/services/capability.service.ts` — get/update/preset logic + graceful column guard + default-on.
- `apps/api/src/routes/capability.routes.ts` — `GET /capabilities`, `GET /capabilities/presets`, `PUT /capabilities`. **NOT wired into index.ts** (see §5).
- `apps/web/src/hooks/useCapabilities.ts` — fail-open React hook.
- `apps/web/src/pages/BusinessTypePage.tsx` — onboarding "what kind of business?" preset cards.
- `apps/web/src/pages/CapabilitiesSettingsPage.tsx` — Settings → Capabilities editor.

**Changed (5):**
- `packages/shared/src/types/index.ts` — added `Capabilities` + `BillingModels` interfaces (types only).
- `apps/web/src/lib/api.ts` — added `Capabilities` import + `capabilities` client + `CapabilitiesUpdate` type.
- `apps/web/src/components/layout/POSLayout.tsx` — `NavItem.cap?` field, `useCapabilities()`, nav gate filter, commented studio/retail nav seam.
- `apps/web/src/components/layout/SettingsLayout.tsx` — added the "Capabilities" settings nav item.
- `apps/web/src/App.tsx` — imports + `/onboarding/business-type` route + `/settings/capabilities` route.

**Build note:** `packages/shared/dist` is gitignored and was rebuilt locally
(`npm run build --workspace=@taproot/shared`) so `apps/api` tsc resolves the new type.
Jake's `npm run dev` / CI rebuilds it automatically — nothing to commit there.

---

## 3. Default-on / fail-open strategy (how restaurants are protected)

Four independent layers guarantee existing restaurants see **zero** change:

1. **Migration backfill** sets every existing org to `food_service:true`.
2. **`getCapabilities()`** returns `DEFAULT_CAPABILITIES` (food_service:true) when the
   column is absent (pre-migration), the row is missing, the value is empty `{}`, or
   the query errors — and **never throws** (mirrors `ingredientSystemReady` /
   `deadLetterTableReady` via `information_schema.columns`).
3. **`useCapabilities()`** fails **open**: loading / error / 404 / unwired route all
   resolve to `DEFAULT_CAPABILITIES`. A capability is only hidden when the backend
   *explicitly* says it's off — never due to a fetch failure.
4. **The nav gate is a no-op today**: it only drops items that declare `cap`, and **no
   current nav item declares one**. Studio/retail items attach later behind that gate.

Net: with the route unwired and the migration unrun, the app behaves byte-for-byte
like today's restaurant POS.

---

## 4. Migration 032 — two-step Railway run (IF approved)

New nullable-with-default column on a populated table; safe, no precondition.

**STEP 1 — apply (Railway → Postgres → Data):**
```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE organizations
   SET capabilities = '{
     "food_service": true, "studio": false, "retail": false,
     "billing_models": {"drop_in": false,"class_packs": false,"free_trial": false,"memberships": false,"classpass": false}
   }'::jsonb
 WHERE capabilities = '{}'::jsonb;

INSERT INTO pgmigrations (name, run_on)
VALUES ('032_org_capabilities', now()) ON CONFLICT DO NOTHING;
```
(Alt: `npx node-pg-migrate up --migrations-dir migrations` — note this would also run
**031** if not yet applied; 031 is still pending from the WG-011 work.)

**STEP 2 — verify:**
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='organizations' AND column_name='capabilities';   -- 1 row
SELECT id, capabilities FROM organizations LIMIT 5;                  -- food_service:true
```

---

## 5. Seams left commented (and why)

- **Route registration seam** — `capability.routes.ts` is **not** registered. Route
  wiring is explicit in `index.ts` (the boot path), which the sandbox must not touch.
  To activate after review, add to `index.ts`:
  ```ts
  import capabilityRoutes from './routes/capability.routes';
  await fastify.register(capabilityRoutes);
  ```
  Until then the web fails open, so nothing breaks.
- **First-run onboarding seam** — `BusinessTypePage` is an additive opt-in route
  (`/onboarding/business-type`), NOT a forced redirect. Forcing *new* orgs through it
  would mean editing the post-login landing (LoginPage self-heals, POSLayout could
  intercept) — risky for the delicate login/redirect flow, so it's left as a note, not
  code. Suggested future insertion: in the `/` landing, redirect to the wizard when
  `capabilities` is unset AND the org has no products.
- **Studio/retail nav seam** — commented `NavItem` examples in `POSLayout` `NAV_ITEMS`
  show exactly where studio/retail items attach (with `cap: 'studio' | 'retail'`).

---

## 6. Decisions made / things to sanity-check

- **Type lives in `@taproot/shared`** (both apps import it) — convention-matching;
  required a local `shared` rebuild (dist gitignored).
- **`PUT /capabilities` accepts either** a partial patch **or** `{ "preset": "studio_cafe" }`.
- **`normalize()` treats empty `{}` as default-on** — important for un-backfilled orgs.
- **Onboarding persistence is best-effort** — on PUT failure the wizard still lands the
  user on the dashboard (never trapped).
- **One new runtime call for all users:** `POSLayout` now fires `GET /api/v1/capabilities`
  on mount. Until the route is wired it 404s → `retry:false`, fails open, no redirect, no
  UI effect. Benign, but worth knowing it's there.

---

## 7. Risk assessment

**Could existing behavior break? Very low.** The nav filter is a no-op (no item has
`cap`), `food_service` defaults true, every read fails open, the route is unwired, and
the migration is unrun. The only behavioral delta is one benign 404 on POSLayout mount.
The settings page and onboarding route are additive (reachable only by navigation). The
shared change is type-only.

**Where to look hardest in review:** (a) the `getCapabilities` default-on branches,
(b) the `POSLayout` nav-gate filter (confirm no current item is accidentally gated),
(c) the migration backfill `WHERE capabilities = '{}'` guard.

---

## 8. What is NOT done (deliberately — later versions)

- Studio/retail **features** (members, classes, booking, spot maps) — v2.1+.
- **Landing-zone differentiation** — all presets land on the existing dashboard for now.
- **Forced first-run** onboarding redirect — seam only (see §5).
- **Route wiring** into `index.ts` — left for review (boot path).
- **Running** migration 032 — left for Jake (Railway two-step).
- **Capabilities in the JWT/login payload** — the hook fetches separately instead (keeps
  auth untouched).

---

## 9. How to test locally

1. `npm run build --workspace=@taproot/shared` (or `npm run dev`, which does it first).
2. `cd apps/api && npx tsc --noEmit` → 0; `cd apps/web && npx tsc --noEmit` → 0.
3. **Web without backend wiring:** run the web app — nav is unchanged; `/settings/capabilities`
   renders (fails open to defaults; Save will error-toast since the route is unwired);
   `/onboarding/business-type` renders and "select a preset" proceeds to the dashboard.
4. **Full path (local dev DB only):** temporarily add the 2-line route registration to a
   LOCAL `index.ts` (do not commit), run migration 032 against a LOCAL dev DB, then
   `GET/PUT /api/v1/capabilities` and watch the nav gate + settings page persist.
