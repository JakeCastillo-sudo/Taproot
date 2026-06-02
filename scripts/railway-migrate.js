#!/usr/bin/env node
/**
 * railway-migrate.js — Pre-deployment migration runner for Railway.
 *
 * This script is run as Railway's `releaseCommand` immediately after the build
 * completes and before the new deployment goes live.  If it exits non-zero,
 * Railway cancels the deploy and keeps the previous version serving traffic.
 *
 * It uses the already-compiled apps/api/dist/db/migrate.js produced during the
 * Nixpacks build phase so that ts-node is NOT required at runtime.
 *
 * Usage (automatic — set in railway.json):
 *   node scripts/railway-migrate.js
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATE_JS = path.join(ROOT, 'apps', 'api', 'dist', 'db', 'migrate.js');

// ── Verify the compiled migrate entry-point exists ────────────────────────────
const fs = require('fs');
if (!fs.existsSync(MIGRATE_JS)) {
  console.error(`❌  Migration runner not found: ${MIGRATE_JS}`);
  console.error('   Make sure the build step ran before this release command.');
  process.exit(1);
}

// ── Run migrations ────────────────────────────────────────────────────────────
console.log('🛠   Railway release command — running database migrations');
console.log(`    DATABASE_URL: ${(process.env.DATABASE_URL || '(not set)').replace(/:\/\/.*@/, '://***@')}`);
console.log('');

try {
  execSync(`node "${MIGRATE_JS}"`, {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  console.log('');
  console.log('✅  Migrations complete — deployment will proceed.');
  process.exit(0);
} catch (err) {
  console.error('');
  console.error('❌  Migration failed — deployment will be cancelled.');
  console.error('   Fix the migration and push again to retry.');
  process.exit(1);
}
