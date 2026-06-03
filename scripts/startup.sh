#!/bin/sh
# Taproot API startup script — used as Railway's startCommand.
#
# Runs database migrations, checks/seeds demo data, then execs the server.
# Never exits non-zero — all pre-flight failures are warnings so Railway's
# restart policy (not a failed exit) handles any transient DB outage.

set -e

echo "=== Taproot API Startup ==="
echo "[startup] NODE_ENV: ${NODE_ENV}"
echo "[startup] DATABASE_URL: $(echo "${DATABASE_URL}" | sed 's|://[^@]*@|://***@|')"

# ── Migrations ────────────────────────────────────────────────────────────────
# NODE_TLS_REJECT_UNAUTHORIZED=0 is required because node-pg-migrate creates its
# own pg connection from the raw DATABASE_URL and does not pick up the Pool-level
# ssl:{rejectUnauthorized:false} option we set in db/client.ts.  This flag only
# applies to this single child process — the API server runs without it.
echo "[startup] Running database migrations..."
if NODE_TLS_REJECT_UNAUTHORIZED=0 node apps/api/dist/db/migrate.js; then
  echo "[startup] Migrations complete."
else
  echo "[startup] Migration warning — continuing anyway (server will start, migrations may be pending)."
fi

# ── Demo data seed check ──────────────────────────────────────────────────────
echo "[startup] Checking demo data..."
if node scripts/check-and-seed.js; then
  echo "[startup] Seed check complete."
else
  echo "[startup] Seed check warning — continuing anyway."
fi

# ── Server ────────────────────────────────────────────────────────────────────
echo "[startup] Starting API server..."
exec node apps/api/dist/index.js
