# Taproot POS 🌿

> The POS built for independent restaurants.
> No contracts. No hidden fees. $99/month flat.

## Live Product
- **App:** https://taproot-pos.com
- **API:** https://taproot-production-3d63.up.railway.app
- **Demo:** `demo@taproot.pos` / `TaprootDemo2026!`

## What It Does

Taproot is an AI-native point-of-sale system for independent restaurants.
Upload your menu PDF and Taproot sets itself up in 10 minutes.

**Core features:**
- 🤖 AI menu import (upload PDF → done)
- 🏪 Full POS with modifiers and variants
- 📋 Kitchen display system
- 🪑 Table management and floor plans
- 🌐 Online ordering and QR codes
- 💳 Stripe Connect payments
- 👥 Employee management with PIN login
- 📊 Advanced reporting and analytics
- 🔮 AI demand forecasting
- 📅 AI staff scheduling
- 🍽️ Menu engineering recommendations
- ❤️ Loyalty program and gift cards
- 📦 Inventory tracking

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Backend | Node.js, TypeScript, Fastify |
| Database | PostgreSQL (Railway) |
| Cache | Redis (Railway) |
| Auth | JWT (access + refresh tokens) |
| Payments | Stripe Connect |
| AI | Anthropic Claude API |
| Deploy | Vercel (frontend) + Railway (backend) |
| State | Zustand + React Query |

## Project Structure

```
taproot/
├── apps/
│   ├── api/          # Fastify backend
│   │   └── src/
│   │       ├── routes/      # API endpoints
│   │       ├── services/    # Business logic
│   │       ├── middleware/  # Auth, CORS, etc
│   │       └── lib/         # Utilities
│   └── web/          # React frontend
│       └── src/
│           ├── pages/       # Route components
│           ├── components/  # Reusable UI
│           ├── store/       # Zustand state
│           └── lib/         # API client, utils
├── migrations/       # PostgreSQL migrations (node-pg-migrate)
├── packages/
│   └── shared/       # Shared TypeScript types (@taproot/shared)
└── docs/             # Documentation
```

## Local Development

```bash
# Clone
git clone https://github.com/JakeCastillo-sudo/Taproot
cd Taproot

# Install (npm workspaces — installs all apps)
npm install

# Environment
cp .env.example .env
# Fill in: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET,
#          STRIPE_SECRET_KEY, ANTHROPIC_API_KEY, CORS_ORIGINS

# Database
npx node-pg-migrate up --migrations-dir migrations

# Start both apps (builds @taproot/shared first)
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## Database Migrations

```bash
# Run all pending migrations
npx node-pg-migrate up --migrations-dir migrations

# Create a new migration
npx node-pg-migrate create migration-name --migrations-dir migrations
```

## Deployment

**Backend (Railway):** push to `main` → Railway auto-deploys. Migrations are run
manually via the Railway service console.

**Frontend (Vercel):** push to `main` → Vercel auto-deploys. Environment variables
are set in the Vercel dashboard (keep `apps/web/.env.production` in sync).

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full step-by-step guide.

## Environment Variables

See `.env.example` for the full list. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — access-token secret (32+ chars)
- `JWT_REFRESH_SECRET` — refresh-token secret
- `STRIPE_SECRET_KEY` — Stripe secret key
- `ANTHROPIC_API_KEY` — Claude API key (AI features degrade gracefully without it)
- `CORS_ORIGINS` — comma-separated allowed origins

## Documentation

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — step-by-step deploy guide
- [`docs/API.md`](docs/API.md) — API endpoint reference
- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — new-customer setup guide
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — product state machine, auth, multi-tenancy, AI caching
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — sprint history
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — bug backlog

## Build Stats (June 2026)

- **80+ commits** across 10 sprints
- **~35,000 lines** of TypeScript/TSX
- **20 database migrations**
- Built with Claude Code in autonomous build sessions

---

*Taproot POS — Built for the restaurant Toast forgot about.*
