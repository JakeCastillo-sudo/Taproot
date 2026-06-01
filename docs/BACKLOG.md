# Taproot POS — Bug Backlog

## P0 — Critical (blocks production)

### BUG-001: Anthropic API key not loading in document parser ✅ RESOLVED
- Symptom: 401 authentication_error from Anthropic API on file upload
- Route: POST /api/v1/imports/upload
- Root cause: Anthropic SDK instantiated at module level before dotenv ran
- Fix applied (Prompt 11): `getAnthropic()` lazy singleton in documentParser.service.ts
  ensures client is created on first call, after dotenv has loaded
- Fix applied (Prompt 13): ai.routes.ts now creates `new Anthropic()` inside the
  handler function — per-call instantiation with guaranteed dotenv load order
- Status: RESOLVED

## P1 — High (degrades experience)

### BUG-002: Inventory table shows — for category names ✅ RESOLVED
- Symptom: Category column blank in inventory stock levels table
- Root cause: products not linked to categories in seed data
- Fix applied (Prompt 14): 002_seed_data.js already had category_id on all products.
  Migration 008_demo_enrich added 12 more products all with correct category_id.
  Verified with psql: all 22 products show correct category names.
- Status: RESOLVED

### BUG-003: Auth token not auto-refreshing in web app ✅ RESOLVED
- Symptom: "Token has expired" error after 15 minutes
- Fix applied (Prompt 08 / api.ts): apiFetch() automatically calls
  POST /api/v1/auth/refresh on 401 response, stores new accessToken,
  retries the original request transparently. Falls back to /login redirect
  if refresh also fails. Deduplicates concurrent refresh calls.
- Status: RESOLVED

## P2 — Medium (polish)

### BUG-004: Multiple Vite ports in use ✅ RESOLVED
- Symptom: Web app increments port on each restart (5173→5178+)
- Fix applied (Prompt 14): Added `scripts/kill-ports.js` that kills any
  processes on ports 3001, 5173-5178 before starting. Use `npm run dev:clean`
  instead of `npm run dev` to start cleanly.
- Status: RESOLVED
