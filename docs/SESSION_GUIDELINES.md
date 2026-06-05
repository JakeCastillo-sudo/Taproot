# Session Guidelines

## Auth is the critical path — verify it first
After **any** autonomous build or deploy, verify authentication works **before** building anything
else. If login/registration is broken, nothing else matters. Run `scripts/morning-check.sh` (or the
lookback checklist) at the start of every session.

## Frontend ↔ backend wiring
- `apps/web/.env.production` `VITE_API_URL` **must** equal the live Railway API host
  (`https://taproot-production-3d63.up.railway.app`). Vercel may override it in the dashboard, but
  keep the committed file correct so a build without the override still works. (See BUG-AUTH-002.)
- When auth "works via curl but not on the live site", suspect the **frontend API base URL** or a
  **stale PWA service worker** before suspecting the backend. Check the deployed bundle:
  `curl -s https://taproot-pos.com/assets/<hash>.js | grep -oE 'taproot-[a-z0-9-]+\.up\.railway\.app'`.

## CORS
Production custom domains (`taproot-pos.com`, `www.taproot-pos.com`) are hardcoded in the CORS
allow-list in `apps/api/src/index.ts` — don't rely solely on `APP_URL`/`CORS_ORIGINS` env vars.

## Standard lookback checklist (every session)
- `curl https://taproot-production-3d63.up.railway.app/api/health` → `status: ok`
- auth check (see morning-check.sh) → `AUTH OK`
- `git log --oneline -5`
- `npx tsc --noEmit` in `apps/web` and `apps/api` → 0 errors
