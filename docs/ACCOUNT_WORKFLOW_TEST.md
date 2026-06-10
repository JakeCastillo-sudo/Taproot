# New Account Creation Workflow — End-to-End Test

**Date:** 2026-06-09 · **Target:** live prod (taproot-production-3d63.up.railway.app)
**Result: 8/8 PASS** — a brand-new restaurant owner can go from sign-up to a completed cash sale.

| Step | Result | Detail |
|---|---|---|
| 1. Registration | ✅ PASS | `POST /register` → 201, `accessToken`, `employee.role=owner`, org + slug + location returned |
| 2. Login (new account) | ✅ PASS | `POST /auth/login` → 200 + token |
| 3. New org starts empty | ✅ PASS | `GET /products` → 0 products |
| 4. Create first product | ✅ PASS | `POST /products` (with `locationId`) → 201, product id + Default variant created |
| 5. Product in list, correct price | ✅ PASS | `GET /products` → "Test Product" present, price = 1299 ($12.99) |
| 6. Create first order | ✅ PASS | `POST /locations/:id/orders` → 201, total 1299 |
| 7. Cash payment | ✅ PASS | `POST /locations/:id/orders/:id/payments` → 201 |
| 8. Receipt | ✅ PASS | `GET /orders/:id/receipt` → 200, 1 line item, total 1299, change 0 |

## Important notes (not bugs — test-payload corrections)

The workflow spec in the prompt had two incorrect payloads that would make a literal
copy-paste fail; the **app behavior is correct**:

1. **Registration fields.** The app requires `businessName` + `businessType`, **not**
   `organizationName`. A payload with `organizationName` returns `400 VALIDATION_ERROR`
   (`businessName`/`businessType` required). The web RegisterPage sends the correct fields.
2. **`POST /products` requires `locationId`.** The spec's product payload omitted it, yielding
   `400 LOCATION_REQUIRED`. This is correct multi-location behavior — `locationId` belongs in the
   product body (the web ProductsSettingsPage passes the active location). With it included, product
   creation returns 201.
3. **Order/payment endpoints** are location-scoped: `POST /locations/:id/orders` and
   `POST /locations/:id/orders/:id/payments` (not `/orders` / `/orders/:id/payment` as the spec
   wrote). The location-scoped routes work; `orders.create` in the web client targets them.

## Conclusion
No application bugs in the new-owner account-creation → first-sale flow. All 9 logical steps
succeed against production with correct payloads. (Test created throwaway orgs
`flow…@testrestaurant.com` etc. on the backend — separate orgs, no impact on the demo.)
