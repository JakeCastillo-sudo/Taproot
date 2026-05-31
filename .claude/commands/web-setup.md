# Web Setup

Set up the Taproot POS development environment from scratch.

## Steps

1. **Install all workspace dependencies**
   Run `npm install` from the repo root (installs client, server, apps/api, packages/shared).

2. **Copy environment file if missing**
   Check if `apps/api/.env` exists. If not, create it with:
   ```
   DATABASE_URL=postgres://localhost:5432/taproot_dev
   JWT_SECRET=dev-secret-change-in-prod
   MFA_TOKEN_SECRET=dev-mfa-secret
   MFA_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
   REDIS_URL=redis://localhost:6379
   PORT=3001
   NODE_ENV=development
   ```

3. **Run database migrations**
   Run `npm run db:migrate` from the repo root.

4. **Start dev servers**
   Run `npm run dev` from the repo root to start both the Vite client (:5173) and the API (:3001) concurrently.

5. **Verify**
   - API health: http://localhost:3001/health
   - Client: http://localhost:5173
