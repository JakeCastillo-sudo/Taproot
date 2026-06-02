#!/usr/bin/env node
/**
 * migrate-safe.js — Safe migration runner for CI/CD pipelines.
 *
 * Differences from npm run db:migrate:
 *  1. Shows pending migrations before running
 *  2. In production: prompts operator to abort (10-second window)
 *  3. Exits non-zero on any error so deploy pipelines fail fast
 *
 * Usage:
 *   NODE_ENV=staging node scripts/migrate-safe.js
 *   NODE_ENV=production node scripts/migrate-safe.js
 */

'use strict';

const { execSync } = require('child_process');

const NODE_ENV  = process.env.NODE_ENV ?? 'development';
const isProd    = NODE_ENV === 'production';

console.log('\n─────────────────────────────────────────────');
console.log(` Taproot safe migration runner — ${NODE_ENV}`);
console.log('─────────────────────────────────────────────\n');

// ── 1. Show pending migrations ────────────────────────────────────────────────
console.log('Checking pending migrations…\n');
try {
  const status = execSync('npm run db:migrate -- status 2>&1 || true', {
    encoding: 'utf-8',
    stdio:    ['pipe', 'pipe', 'pipe'],
  });
  console.log(status.trim() || '(no pending migrations found)');
} catch {
  // Status check failure is non-fatal
  console.log('(could not determine pending migrations — proceeding)');
}

console.log('');

// ── 2. Production abort window ────────────────────────────────────────────────
if (isProd) {
  console.log('⚠️   PRODUCTION MIGRATION');
  console.log('    Ensure a full database backup is complete before proceeding.');
  console.log('    Waiting 10 seconds — Ctrl+C to abort.\n');

  // Simple sleep without a sleep dependency
  const deadline = Date.now() + 10_000;
  let remaining = 10;
  const tick = setInterval(() => {
    remaining--;
    process.stdout.write(`\r    ${remaining}s remaining…  `);
    if (Date.now() >= deadline) {
      clearInterval(tick);
      process.stdout.write('\r    Proceeding…          \n\n');
    }
  }, 1_000);

  // Block synchronously via a tight loop (safe in a one-off script)
  while (Date.now() < deadline) {
    // intentional busy-wait for the abort window
  }
  clearInterval(tick);
}

// ── 3. Run migrations ─────────────────────────────────────────────────────────
console.log('Running migrations…\n');
try {
  execSync('npm run db:migrate', { stdio: 'inherit' });
  console.log('\n✅  Migrations complete.\n');
} catch (err) {
  console.error('\n❌  Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
