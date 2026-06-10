# Hour 3 — Database + Redis + Security Report
**Date:** 2026-06-10 16:39 PDT

> Verification only — no code changed. All results are live curl tests against
> production. Two prompt-script assumptions were wrong and are corrected below;
> one "CRITICAL" security flag was a **false positive** from flawed test logic and
> is debunked with a proper test.

## Database Health
| Check | Result |
|---|---|
| Products | ✅ 50 returned / **84 total**, **all priced (0 at $0)**, 3 with modifiers |
| Categories | ✅ 16 (Food, Beverages, Alcohol, Merchandise, Modifiers, …) |
| Orders (list) | ✅ 5 returned |
| Order creation | ✅ **works** (see path correction) — created `T-2026-000008`, total $11.98 |
| Payment completion | ✅ **completed** — cash $20.00 on $11.98, payment record `status: completed` |
| End-of-day report | ✅ works — gross $0.00 / 0 orders for today (no completed sales today) |
| AI forecast | ✅ works — returns `predictedRevenue`, `predictedOrders`, `predictedTopItems`, `prepRecommendations`, `confidence` |

### ⚠️ Endpoint path corrections (prompt script was wrong)
The prompt's Test 4 used **non-existent** routes and 404'd. Actual routes (from
`apps/api/src/routes/order.routes.ts`):

| Prompt used (404) | Actual working route |
|---|---|
| `POST /api/v1/orders` | `POST /api/v1/locations/:locationId/orders` |
| `POST /api/v1/orders/:id/payment` | `POST /api/v1/locations/:locationId/orders/:orderId/payments` |

- `GET /api/v1/orders` exists (org-wide history) but there is **no POST** there.
- Body shape: `{ orderType, lineItems:[{ productId, variantId, quantity }] }` (field is
  **`lineItems`**, not `items`; price is resolved server-side from the product).
- `orders.source` has a CHECK constraint — only specific values allowed (e.g. `pos`);
  arbitrary values 500 with `orders_source_check`.

Order creation + payment are **not broken** — they work once the correct routes/shape
are used. The POS frontend uses these location-scoped routes.

## Redis
| Check | Result |
|---|---|
| Health check | ✅ `redis: ok` |
| Rate limiting | ✅ **FIRES** — repeated logins returned `HTTP 429 RATE_LIMITED` with `retryAfter: 636`s |
| Normal usage | ✅ 5 sequential product reads all **HTTP 200** (no false positives) |
| Caching (cold vs warm) | ⚠️ **No measurable delta** — cold 2.06s ≈ warm 2.06s/2.14s |

**Caching note:** from this network vantage, ~2s round-trip latency to Railway dominates
any server-side cache benefit, so a cold/warm delta isn't observable here. Redis itself is
healthy and rate limiting (which uses Redis) demonstrably works. A representative cache
benchmark would need to run server-side, not over the public internet.

## Registration Workflow
| Check | Result |
|---|---|
| New account creation | ✅ works — returns `accessToken`, `employee` (role **owner**), `org`, `location`, `trialDays: 14`, `nextStep` |
| Field names (`businessName`/`businessType`) | ✅ accepted |
| New org isolation | ✅ new org has **0 products, 1 location** (auto-created) |

## Security
| Test | Result |
|---|---|
| Cross-tenant isolation | ✅ **SECURE** (see analysis) |
| SQL injection (`'; DROP TABLE products; --`) | ✅ sanitized — parameterized queries; products table intact (200 after) |
| Tampered JWT | ✅ rejected — **HTTP 401** |

### Cross-tenant isolation — "CRITICAL" was a FALSE POSITIVE
The prompt's Test 1 sent the **demo token** + a bogus `X-Organization-Slug` header and saw
50 products, flagging "wrong org returned data." That logic is flawed: tenancy is enforced
by the **JWT `orgId` claim**, not the header — so the demo token correctly returned **its own**
org's products. The 50 products were demo's own data, not a leak.

Proper isolation tests (definitive):
- **Org B's token + demo's slug → 0 products** (B's own), NOT demo's 50.
- **Org B reads a specific demo product by id → HTTP 404.**
- Control: demo token + nonexistent slug → still its own 50 (confirms the header is *not* the
  tenancy control — and therefore cannot be spoofed to switch tenants, which is a good property).

**Conclusion: cross-tenant isolation holds. No breach.**

## Test data created (for cleanup)
Live mutations performed during this audit, on production:
- Order `T-2026-000008` (`53182ec9-746e-43d7-a5b5-0401ae91024d`) on **demo-restaurant**, paid cash.
- Org `hour-3-test-restaurant` (registration test).
- Org `iso-test-1781134740` (isolation test).

These are safe to delete. The two test orgs are empty trial accounts; the test order is a
single paid $11.98 ticket that will show in demo sales until removed.

## Summary
- ✅ **Ready for Hour 4: YES**
- ❌ **P0 blockers: none.** No real security issues — the "critical" cross-tenant flag was a
  test-logic false positive, disproven by a proper different-org test.
- ⚠️ **Issues / notes:**
  1. The audit script's order endpoints were wrong (documented above) — fix the script, not the app.
  2. Login rate limiting is aggressive enough that repeated automated logins hit 429 (~10 min
     cooldown). Re-use tokens (15-min TTL) in test scripts instead of re-logging-in each call.
  3. 3 pieces of test data created on prod (listed above) — delete at your convenience.
