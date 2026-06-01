# Taproot POS — Bug Backlog

## P0 — Critical (blocks production)

### BUG-001: Anthropic API key not loading in document parser
- Symptom: 401 authentication_error from Anthropic API on file upload
- Route: POST /api/v1/imports/upload
- Likely cause: dotenv not loading before Anthropic SDK initializes
  in documentParser.service.ts — SDK may be instantiated at module
  load time before dotenv runs
- Fix: lazy-initialize the Anthropic client inside each function call
  rather than at module level, OR ensure dotenv loads before any
  service modules are imported in index.ts
- Impact: Document Intelligence pipeline (Prompt 11) non-functional
- Workaround: none until fixed

## P1 — High (degrades experience)

### BUG-002: Inventory table shows — for category names
- Symptom: Category column blank in inventory stock levels table
- Cause: products not linked to categories in seed data
- Fix: update seed data to set category_id on products

### BUG-003: Auth token not auto-refreshing in web app
- Symptom: "Token has expired" error after 15 minutes
- Fix: implement token refresh interceptor in apps/web/src/lib/api.ts

## P2 — Medium (polish)

### BUG-004: Multiple Vite ports in use
- Symptom: Web app increments port on each restart (5173→5178+)
- Fix: kill all node processes before starting dev server
- Workaround: lsof -ti:5173,5174,5175,5176 | xargs kill -9
