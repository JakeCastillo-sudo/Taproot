# Taproot POS — API Reference

Base URL: `http://localhost:3001` (dev) / `https://your-domain.com` (prod)

All authenticated routes require `Authorization: Bearer <accessToken>`.
All responses include `X-Request-ID` for tracing.

---

## Rate Limits

| Route group       | Limit            |
|-------------------|------------------|
| Global (default)  | 200 / minute     |
| `POST /auth/login` | 5 / 15 min      |
| `POST /auth/login/mfa` | 3 / 5 min  |
| `POST /auth/refresh` | 20 / min     |
| `POST /auth/password/reset/*` | 3–5 / 15 min |
| `POST /imports/upload` | 20 / hour  |
| `POST /ai/nl-query` | 30 / hour     |
| `POST /webhooks/*` | 1 000 / min    |

Rate limit errors return HTTP 429:
```json
{ "code": "RATE_LIMITED", "message": "Too many requests. Retry after 30 seconds.", "retryAfter": 30 }
```

---

## Auth

### POST /api/v1/auth/login
Authenticate with email + password. Returns access + refresh tokens.

**Headers**: `X-Organization-Slug: <slug>`  
**Body**: `{ "email": "string", "password": "string", "locationId"?: "uuid" }`  
**Response 200**: `{ "accessToken": "string", "refreshToken": "string", "employee": {...} }`  
**Response 401**: Invalid credentials (timing-safe — identical response for all failures)

```bash
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "X-Organization-Slug: demo-restaurant" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"password123"}'
```

### POST /api/v1/auth/login/mfa
Complete MFA challenge with TOTP or backup code.

**Body**: `{ "mfaToken": "string", "totpCode": "string" }`  
**Response 200**: Same as /login

### POST /api/v1/auth/login/pin
PIN-based login for cashier quick-switch.

**Body**: `{ "pin": "string", "employeeId": "uuid", "locationId": "uuid" }`

### POST /api/v1/auth/refresh
Exchange a refresh token for a new access token.

**Body**: `{ "refreshToken": "string" }`  
**Response 200**: `{ "accessToken": "string", "refreshToken": "string" }`

### POST /api/v1/auth/logout
Revoke the current refresh token.

**Auth**: Required

### POST /api/v1/auth/password/reset/request
Request a password reset email.

**Body**: `{ "email": "string" }`  
**Response 200**: Always returns 200 (prevents email enumeration)

### POST /api/v1/auth/password/reset/confirm
Complete password reset with token.

**Body**: `{ "token": "string", "newPassword": "string" }`

---

## Products

**Permission required**: `PRODUCTS_VIEW` (read), `PRODUCTS_MANAGE` (write)

### GET /api/v1/products
List products with optional filtering.

**Query**: `categoryId`, `search`, `isActive`, `page`, `perPage`  
**Response 200**: `{ "products": [...], "total": 0, "page": 1 }`

### GET /api/v1/products/:id
Get a single product with variants.

### GET /api/v1/products/barcode/:barcode
Look up a product by barcode.

### GET /api/v1/categories
List all categories.

**Response 200**: `{ "categories": [{ "id": "uuid", "name": "string", "color": "string|null" }] }`

---

## Inventory

**Permission required**: `INVENTORY_VIEW` (read), `INVENTORY_MANAGE` (write)

### GET /api/v1/locations/:locationId/inventory
List inventory levels with optional search and filtering.

**Query**: `search`, `belowReorderPoint`, `page`, `limit`  
**Response 200**: `{ "levels": [...], "total": 0 }`

### POST /api/v1/locations/:locationId/inventory/adjust
Adjust inventory for a single product.

**Body**: `{ "productId": "uuid", "variantId"?: "uuid|null", "quantityDelta": -5, "reason": "string", "notes"?: "string" }`

### POST /api/v1/locations/:locationId/inventory/count
Record a stock count (cycle count or opening count).

**Body**: `{ "counts": [{ "productId": "uuid", "countedQuantity": 10 }], "isOpeningCount": false }`

### GET /api/v1/locations/:locationId/inventory/:productId/movements
Get stock movement history for a product.

**Query**: `variantId`, `limit`

### GET /api/v1/locations/:locationId/forecast
Get stock depletion forecast.

**Query**: `windowHours` (default 24)  
**Response 200**: `{ "items": [{ "productId": "uuid", "urgency": "critical|warning|ok", ... }] }`

---

## Orders

**Permission required**: `ORDERS_CREATE`, `ORDERS_VIEW`, `ORDERS_MANAGE`

### POST /api/v1/locations/:locationId/orders
Create a new order.

**Body**:
```json
{
  "customerId": "uuid|null",
  "orderType": "dine_in|takeout|delivery",
  "items": [{ "productId": "uuid", "variantId": "uuid|null", "quantity": 2, "unitPrice": 1200 }],
  "discountIds": [],
  "notes": ""
}
```
**Response 201**: Order object

```bash
curl -s -X POST http://localhost:3001/api/v1/locations/LOC_UUID/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderType":"takeout","items":[{"productId":"PROD_UUID","variantId":null,"quantity":1,"unitPrice":1200}]}'
```

### GET /api/v1/locations/:locationId/orders
List orders with optional filtering.

**Query**: `status`, `orderType`, `customerId`, `dateFrom`, `dateTo`, `page`, `perPage`

### GET /api/v1/locations/:locationId/orders/:orderId
Get a single order with line items and payments.

### PATCH /api/v1/locations/:locationId/orders/:orderId
Update an open order.

### POST /api/v1/locations/:locationId/orders/:orderId/void
Void an order.

**Body**: `{ "reason": "string" }`

### POST /api/v1/locations/:locationId/orders/:orderId/park
Park (suspend) an order.

### POST /api/v1/locations/:locationId/orders/:orderId/resume
Resume a parked order.

---

## Payments

**Permission required**: `PAYMENTS_PROCESS`

### POST /api/v1/locations/:locationId/orders/:orderId/payments
Process a payment for an order.

**Body**:
```json
{
  "paymentMethod": "cash|card|gift_card|account_credit|offline",
  "amount": 1296,
  "tipAmount": 200,
  "cashTendered": 2000
}
```

### POST /api/v1/payments/:paymentId/refund
Refund a payment.

**Body**: `{ "amount": 1296, "reason": "string" }`

### POST /api/v1/terminal/payment-intent
Create a Stripe Terminal payment intent.

**Body**: `{ "locationId": "uuid", "orderId": "uuid", "readerId": "string" }`

---

## Customers

**Permission required**: `CUSTOMERS_VIEW` (read), `CUSTOMERS_MANAGE` (write)

### GET /api/v1/customers/search
Search customers by name, email, or phone.

**Query**: `q` (min 2 chars), `limit`

### GET /api/v1/customers/:id
Get a customer with stats.

### POST /api/v1/customers
Create a new customer.

**Body**: `{ "firstName"?: "string", "lastName"?: "string", "email"?: "string", "phone"?: "string" }`

### PUT /api/v1/customers/:id
Update a customer.

### DELETE /api/v1/customers/:id
Soft-delete a customer. **Permission**: `CUSTOMERS_DELETE`

### POST /api/v1/customers/:id/merge
Merge two customer records (absorbs loyalty points, order history).

**Body**: `{ "secondaryCustomerId": "uuid" }`

### POST /api/v1/customers/:id/credit/add
Add account credit to a customer.

**Body**: `{ "amount": 500, "reason": "string" }`

### GET /api/v1/gift-cards/:code
Look up a gift card by code.

### POST /api/v1/gift-cards
Issue a new gift card.

**Body**: `{ "initialBalance": 5000, "customerId"?: "uuid" }`

---

## Reports

**Permission required**: `REPORTS_VIEW`

### GET /api/v1/reports/dashboard
Dashboard KPIs (today's orders, revenue, AOV, top product).

**Query**: `location_id`, `timezone` (IANA tz string)

### GET /api/v1/reports/sales
Sales summary aggregated by period.

**Query**: `from` (ISO 8601), `to`, `location_id`, `granularity` (day|week|month|year)

```bash
curl -s "http://localhost:3001/api/v1/reports/dashboard?location_id=LOC_UUID&timezone=America/New_York" \
  -H "Authorization: Bearer $TOKEN"
```

### GET /api/v1/reports/top-products
Top products by revenue.

**Query**: `from`, `to`, `location_id`, `limit`

### GET /api/v1/reports/top-customers
Top customers by spend.

### GET /api/v1/reports/payment-methods
Payment method breakdown with percentages.

### GET /api/v1/reports/employee-performance
Employee performance metrics.

### GET /api/v1/reports/hourly-heatmap
7×24 sales heatmap data.

---

## AI / NL Query

**Permission required**: `AI_REPORTS`  
**Rate limit**: 30 / hour

### POST /api/v1/ai/nl-query
Ask a natural language question about business data.

**Body**: `{ "query": "What were my top 5 products last week?", "locationId": "uuid" }`  
**Response 200**: `{ "answer": "string", "data": [...]|null, "chartType": "bar|line|donut|null" }`

---

## Imports

**Permission required**: `IMPORT_RUN`  
**Rate limit** (upload): 20 / hour

### POST /api/v1/imports/upload
Upload a document (PDF, image, CSV) for AI-powered import.

**Content-Type**: `multipart/form-data`  
**Body**: `file` (max 10 MB)  
**Response 202**: `{ "jobId": "uuid", "status": "pending" }`

```bash
curl -s -X POST http://localhost:3001/api/v1/imports/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@menu.pdf"
```

### GET /api/v1/imports/:jobId
Get job status and preview data.

**Response 200**: ImportJob object with `status`, `preview_data`, `mapping_config`

### POST /api/v1/imports/:jobId/confirm
Confirm and apply a document import.

**Body**: `{ "locationId": "uuid", "confirmedMapping"?: {...} }`

### GET /api/v1/imports
List recent import jobs.

**Query**: `status`, `importType`, `limit`, `offset`

---

## Migrations

**Permission required**: `IMPORT_RUN`

### POST /api/v1/migrations/square
Start a Square POS migration (catalog + customers).

**Body**: `{ "locationId": "uuid", "accessToken": "string", "squareLocationId"?: "string" }`  
**Response 202**: `{ "job": ImportJob }`

### POST /api/v1/migrations/shopify
Start a Shopify migration (products + customers).

**Body**: `{ "locationId": "uuid", "shopDomain": "my-shop.myshopify.com", "accessToken": "string" }`

### POST /api/v1/migrations/toast
Start a Toast POS migration (menus + employees).

**Body**: `{ "locationId": "uuid", "clientId": "string", "clientSecret": "string", "restaurantGuid": "string" }`

### POST /api/v1/migrations/lightspeed
Start a Lightspeed R-Series migration.

**Body**: `{ "locationId": "uuid", "apiKey": "string", "accountId": "string" }`

### POST /api/v1/migrations/clover
Start a Clover migration.

**Body**: `{ "locationId": "uuid", "accessToken": "string", "merchantId": "string" }`

### POST /api/v1/migrations/csv
Import a CSV file (products, customers, or inventory).

**Body**: `{ "locationId": "uuid", "fileUrl": "string", "targetSchema": "products|customers|inventory", "rawCsv": "string" }`

### POST /api/v1/migrations/:jobId/apply
Apply a confirmed migration to the Taproot database.

**Body**: `{ "locationId": "uuid", "importProducts"?: true, "importCustomers"?: true, "importLoyaltyPoints"?: false, "overwriteExisting"?: false }`  
**Response 200**: `{ "result": { "categories": 5, "products": 42, "customers": 120, "failed": 0, "errors": [] } }`

### GET /api/v1/migrations
List migration jobs for this organization.

### POST /api/v1/migrations/test/square
Test Square credentials without importing.

**Body**: `{ "accessToken": "string" }`  
**Response 200**: `{ "ok": true, "locationCount": 2 }`

### POST /api/v1/migrations/test/shopify
Test Shopify credentials. **Response**: `{ "ok": true, "shopName": "string" }`

### POST /api/v1/migrations/test/clover
Test Clover credentials. **Response**: `{ "ok": true, "merchantName": "string" }`

---

## Webhooks

### POST /api/v1/webhooks/stripe/connect
Stripe Connect account events (account.updated, deauthorized, capability.updated).

**Headers**: `Stripe-Signature: whsec_…`  
**Rate limit**: 1 000 / min

### POST /api/v1/webhooks/stripe/terminal
Stripe Terminal + payment events.

**Headers**: `Stripe-Signature: whsec_…`

---

## Health

### GET /api/health
System health check. Returns `200 ok` or `503 degraded`.

```bash
curl -s http://localhost:3001/api/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-06-01T00:00:00.000Z",
  "checks": { "database": "ok", "redis": "ok", "stripe": "ok" },
  "uptime": 3600
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable description",
  "requestId": "uuid",
  "details": {}
}
```

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `VALIDATION_ERROR` | Invalid request body / params |
| 400 | `INVALID_PARAM` | Route param is not a valid UUID |
| 401 | `INVALID_CREDENTIALS` | Login failed |
| 401 | `TOKEN_EXPIRED` | Access token has expired — refresh it |
| 401 | `TOKEN_INVALID` | Malformed token |
| 402 | `PAYMENT_ERROR` | Stripe charge failed |
| 403 | `FORBIDDEN` | Missing required permission |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate record / unique constraint |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds 1 MB |
| 422 | `UNPROCESSABLE` | Referenced resource missing (FK violation) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
