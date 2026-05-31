# Taproot POS — Claude Project State

## Stack
- **Frontend**: React + Vite + Tailwind (client/, port 5173)
- **Backend**: Fastify v4 + TypeScript strict, port 3001
- **Database**: PostgreSQL via pg Pool (no ORM)
- **Auth**: JWT (HS256/RS256), bcrypt, TOTP (otplib), AES-256-GCM
- **GraphQL**: Apollo Server 5 + @as-integrations/fastify
- **Testing**: Jest + ts-jest
- **Monorepo**: npm workspaces — client, server, apps/api, packages/shared
- **Migrations**: node-pg-migrate (migrations/)

## Completed Prompts

### Prompt 01 — Project scaffold + SQLite backend ✅
- React + Vite + Tailwind frontend (5 pages: Register, Dashboard, Products, Orders, Settings)
- Express + better-sqlite3 backend (server/)
- Fixed: better-sqlite3 native compile on Node v26, duplicate fmt identifiers, missing Package icon import

### Prompt 02 — PostgreSQL schema + seed data ✅
- 32-table production schema: migration 001_initial_schema.js
- Seed data: migration 002_seed_data.js
- DB client: apps/api/src/db/client.ts (Pool, query, withTransaction)
- Migration runner: apps/api/src/db/migrate.ts
- Shared types: packages/shared/src/types/index.ts
- **Known issue**: 002 seed data uses columns/values that don't match schema (slug on locations, 'pro' plan — needs a fix migration)

### Prompt 03 — Complete auth system ✅
- Fastify server: apps/api/src/index.ts
- Config + validation: apps/api/src/config.ts
- Error hierarchy: apps/api/src/errors.ts
- Crypto utilities: apps/api/src/auth/crypto.ts (bcrypt 12r/10r, SHA-256, TOTP, AES-256-GCM)
- JWT service: apps/api/src/auth/jwt.ts (access 15m, refresh 30d, MFA 5m)
- RBAC: apps/api/src/auth/permissions.ts (43 permissions, 5 roles)
- Audit: apps/api/src/auth/audit.ts
- Schemas: apps/api/src/auth/schemas.ts (Zod)
- Middleware: apps/api/src/auth/middleware.ts
- Routes: apps/api/src/auth/routes.ts (12 routes)
- Plugin: apps/api/src/auth/index.ts
- Migrations: 003_password_reset_tokens.js, 004_mfa_backup_codes.js
- **Known issue**: PAT lacks Contents:write — pushes fail with 403

### Prompt 04 — Product/variant/recipe/inventory data layer ✅
- Errors extended: ProductNotFoundError, VariantNotFoundError, RecipeNotFoundError, RecipeValidationError, CircularRecipeError, InsufficientStockError, InventoryLevelError, PricingError, PurchaseOrderError
- Shared types: packages/shared/src/types/index.ts — fully aligned with DB schema
- Services:
  - apps/api/src/services/product.service.ts — CRUD, list/search, SKU gen, barcode lookup
  - apps/api/src/services/variant.service.ts — CRUD, setPrices, getActivePrice
  - apps/api/src/services/recipe.service.ts — createOrUpdateRecipe, depletion formula, circular detection, theoretical usage
  - apps/api/src/services/inventory.service.ts — depleteForOrder, adjustInventory, transferStock, receiveStock, recordStockCount, getInventoryLevel, listInventoryLevels, getMovementHistory
  - apps/api/src/services/forecast.service.ts — getBurnRate, getTimeToStockout, getForecastDashboard
  - apps/api/src/services/variance.service.ts — generateVarianceReport, finalizeVarianceReport, getVarianceReport, listVarianceReports
- REST routes: apps/api/src/routes/inventory.routes.ts (registered in index.ts)
- GraphQL SDL: apps/api/src/graphql/schema/inventory.graphql
- Tests: 53 passing (recipe, inventory, forecast, variance services)
- Config: jest.config.ts, tsconfig.test.json, "test" script added to package.json
- Typecheck: 0 errors (tests excluded from main tsconfig, compiled by ts-jest via tsconfig.test.json)

## Key Schema Facts (do not guess — these are ground truth)
- Table names: `product_prices` (not prices), `order_line_items` (not order_items)
- `recipes`: keyed by `product_id` (not variant_id), has `yield_factor`, `version`, `is_active`, `deleted_at`
- `recipe_lines`: `ingredient_product_id` + `ingredient_variant_id` (not ingredient_id)
- `inventory_movements`: includes `quantity_before`, `quantity_after`, `reference_type`, `reference_id`
- `inventory_movements.movement_type` CHECK: `sale|return|waste|adjustment|transfer_in|transfer_out|po_receipt|opening_count|cycle_count`
- `products.product_type` CHECK: `standard|recipe|bundle|service|weight`
- `products.unit_of_measure` CHECK: `each|g|kg|ml|l|oz|lb|m|ft`
- `purchase_orders.status` CHECK: `draft|sent|confirmed|partially_received|received|cancelled`
- Employee roles CHECK: `owner|manager|cashier|kitchen|readonly`
- Org plan CHECK: `trial|starter|growth|enterprise`
- `inventory_levels` uses two partial unique indexes (variant_id NULL vs NOT NULL)

## Pending Issues
- Fix 002 seed data columns (slug on locations table doesn't exist, plan 'pro' fails CHECK)
- Configure PAT with Contents:write to unblock git push
- Set DATABASE_URL, JWT_SECRET, MFA_TOKEN_SECRET, MFA_ENCRYPTION_KEY env vars before running server

## Next Prompt
Prompt 05 — Order system + POS register flow
