# Taproot POS

A modern, full-featured point-of-sale system built for independent restaurants, cafés, and retail.
Works offline. Runs on iPad. Ships to production on AWS.

[![CI](https://github.com/your-org/taproot/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/taproot/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Features

| Module | Capabilities |
|--------|-------------|
| **POS Checkout** | Product grid, variants, modifiers, discounts, split-tender, offline mode |
| **Payments** | Cash, card (Stripe Terminal), gift cards, account credit, split payments |
| **Inventory** | Stock levels, recipes, variance reports, supplier purchase orders, forecasting |
| **Reporting** | Revenue dashboards, top products, heatmaps, employee performance |
| **Customers** | Profiles, loyalty tiers, account credit, merge duplicates |
| **AI Import** | Upload menus (PDF/CSV/image/URL) → Claude parses + maps to your catalog |
| **Migration** | One-click import from Square, Shopify, Toast, Lightspeed, Clover |
| **Onboarding** | 4-step wizard (menu → recipes → Stripe → launch) with confetti 🎉 |
| **Billing** | Stripe subscriptions, 14-day trial, partner code extensions |
| **Mobile** | Full PWA, iPad-optimized, swipe gestures, haptic feedback, offline-first |

---

## Tech Stack

```
Frontend   React 18 + Vite 5 + Tailwind 3 + Zustand 5 + React Query 5
Backend    Fastify 4 + TypeScript (strict) + Node 20
Database   PostgreSQL 15 (no ORM — raw pg Pool)
Cache      Redis 7 (sessions, rate limits, offline queue, pub/sub)
Auth       JWT (HS256) + bcrypt + TOTP (MFA) + AES-256-GCM
Payments   Stripe Terminal + Connect ISV
AI         Anthropic Claude (menu parsing, NL queries)
Infra      AWS CDK: ECS Fargate + RDS + ElastiCache + CloudFront + S3
CI/CD      GitHub Actions (typecheck, jest, ESLint, Docker build, deploy)
```

---

## Local Development

### Prerequisites
- Node 20+
- PostgreSQL 15 running locally
- Redis 7 running locally
- npm 10+

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-org/taproot
cd taproot
npm install

# 2. Create database
createdb taproot_dev

# 3. Configure environment
cp apps/api/.env.staging.example apps/api/.env
# Edit apps/api/.env — fill in DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY etc.
# Minimum for local dev (copy/generate these):
#   DATABASE_URL=postgres://localhost/taproot_dev
#   JWT_SECRET=<64+ random chars>
#   REDIS_URL=redis://localhost:6379
#   STRIPE_SECRET_KEY=sk_test_...
#   STRIPE_WEBHOOK_SECRET=whsec_test_...

# 4. Run migrations + seed data
npm run db:migrate      # from repo root
# or to reseed from scratch:
npm run db:reseed       # from apps/api/

# 5. Start dev servers
npm run dev             # starts api (3001) + web (5173) concurrently
# or if ports are stuck:
npm run dev:clean       # kills ports 3001/5173-5178 first
```

Open http://localhost:5173

**Demo credentials:** `demo@taproot.pos` / `TaprootDemo123`

### Running Tests

```bash
cd apps/api
npm test                # 206 tests (jest + ts-jest)
npm run typecheck       # TypeScript strict check

cd apps/web
npm run typecheck       # TypeScript strict check
npm run build           # Vite production build
```

### Docker Compose

```bash
docker compose up       # api + postgres:15 + redis:7
# App at http://localhost:3001 (API) — serve apps/web/dist separately
```

---

## Project Structure

```
taproot/
├── apps/
│   ├── api/               # Fastify backend
│   │   ├── src/
│   │   │   ├── auth/      # JWT, RBAC, MFA, audit log
│   │   │   ├── db/        # pg Pool, migrations, Redis
│   │   │   ├── payments/  # Stripe Terminal, Connect, offline queue
│   │   │   ├── queues/    # Bull queues (5 types)
│   │   │   ├── routes/    # All REST route handlers
│   │   │   ├── services/  # Business logic
│   │   │   └── index.ts   # Fastify app + startup
│   │   └── src/__tests__/ # Jest unit tests
│   └── web/               # React PWA frontend
│       └── src/
│           ├── components/ # UI components (pos/, inventory/, reports/, onboarding/, ui/)
│           ├── hooks/      # useBarcode, useSwipe, useHaptic, useKeyboard...
│           ├── lib/        # api.ts (typed client), queryClient.ts, analytics.ts
│           ├── pages/      # POS, Inventory, Reports, Onboarding, Register, Billing...
│           └── store/      # Zustand stores (pos.store, onboarding.store)
├── packages/
│   └── shared/            # Shared TypeScript types
├── migrations/            # node-pg-migrate SQL migrations (001–010)
├── docs/                  # API.md, QA_REPORT.md, DEPLOYMENT.md, BACKLOG.md...
├── infra/                 # AWS CDK stack (VPC, ECS, RDS, Redis, CloudFront)
└── .github/workflows/     # CI (ci.yml), Deploy (deploy.yml), Release (release.yml)
```

---

## API Overview

Base URL: `http://localhost:3001/api/v1` (dev)

All endpoints except `/health`, `/register`, `/auth/login`, and webhooks require a JWT Bearer token.

```
Auth           POST /auth/login  POST /auth/refresh  POST /auth/logout
Registration   POST /register    POST /register/check-email
Orders         GET/POST /locations/:id/orders    PATCH /locations/:id/orders/:id
Payments       POST /locations/:id/orders/:id/payments
Products       GET/POST /products    GET/PATCH/DELETE /products/:id
Inventory      GET /inventory/levels   POST /inventory/adjust   POST /inventory/count
Reports        GET /reports/dashboard  /sales  /top-products  /top-customers
               GET /reports/payment-methods  /employee-performance  /hourly-heatmap
Customers      GET/POST /customers   GET/PATCH/DELETE /customers/:id
AI Import      POST /imports/upload   GET /imports/:jobId   POST /imports/:jobId/confirm
Migration      POST /migrations/square|shopify|toast|lightspeed|clover|csv
Onboarding     GET/POST /onboarding/status   POST /onboarding/complete
Billing        GET /billing/subscription   POST /billing/subscribe   POST /billing/portal
```

Full API reference: [docs/API.md](docs/API.md)

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete guide.

Quick summary:
1. **Staging** — auto-deploys on push to `main` via GitHub Actions → ECS Fargate
2. **Production** — manual `workflow_dispatch` + GitHub environment approval
3. **Release** — push a `v*.*.*` tag → changelog generated → GitHub Release created → production deploy

Required GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `STAGING_HOST`, and all
app secrets listed in `.env.production.example`.

---

## Security

- All Stripe keys loaded from environment — startup fails fast if missing
- Offline card data encrypted AES-256-GCM — never plaintext in Redis
- Webhook signature verification — unsigned webhooks rejected with 400
- Idempotency keys on all Stripe API calls: `taproot-{orgId}-{orderId}-{timestamp}`
- Card numbers never logged, never in DB, never in audit logs — only last4 + brand stored
- BCrypt 12 rounds, TOTP MFA, JWT 15-min access / 30-day refresh
- RBAC: 5 roles × 43 permissions
- CSP headers, HSTS, Permissions-Policy enforced in production

---

## QA Status

See [docs/QA_REPORT.md](docs/QA_REPORT.md) for the full white-glove QA report.

**Beta verdict: ✅ READY** — 0 TypeScript errors, all P0/P1 bugs resolved, all flows tested.

---

## License

MIT © 2026 Taproot Systems
