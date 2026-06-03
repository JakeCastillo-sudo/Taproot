'use strict';
/**
 * check-and-seed.js — Verifies demo data is present in the database.
 *
 * Run automatically by scripts/startup.sh after migrations complete.
 * Exits 0 in all cases — failures are logged but never block server startup.
 *
 * Checks:
 *   1. organizations table has at least one row (seed ran)
 *   2. demo@taproot.pos employee has a valid bcrypt password hash
 *      — repairs it if the hash looks wrong (wrong length / not $2b$ prefix)
 */

const { Pool } = require('pg');
const { execSync } = require('child_process');
const bcrypt = require('bcrypt');

// Strip sslmode/ssl query params — we manage SSL via the Pool ssl option.
// Railway's DATABASE_URL arrives as: postgresql://...?sslmode=require
function cleanDbUrl(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    return url.toString();
  } catch {
    return raw;
  }
}

const connectionString = cleanDbUrl(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10_000,
});

async function main() {
  let client;

  try {
    client = await pool.connect();
  } catch (err) {
    console.error('[check-seed] Could not connect to database:', err.message);
    // Don't fail startup — server will surface the DB error via health check
    return;
  }

  try {
    // ── 1. Check whether the organizations table exists ──────────────────────
    const tableRes = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'organizations'
      ) AS exists
    `);

    if (!tableRes.rows[0].exists) {
      console.log('[check-seed] organizations table not found — migrations have not run yet, skipping.');
      return;
    }

    // ── 2. Check whether demo org exists ─────────────────────────────────────
    const countRes = await client.query('SELECT COUNT(*)::int AS count FROM organizations');
    const count = countRes.rows[0].count;

    if (count === 0) {
      console.log('[check-seed] Database is empty — re-running migrations to seed demo data...');
      execSync('NODE_TLS_REJECT_UNAUTHORIZED=0 node apps/api/dist/db/migrate.js', {
        stdio: 'inherit',
        env: process.env,
      });
      console.log('[check-seed] Seed migrations complete.');
    } else {
      console.log(`[check-seed] ${count} organization(s) found — seed already applied.`);
    }

    // ── 3. Verify / repair demo employee password hash ───────────────────────
    const empRes = await client.query(
      "SELECT id, password_hash FROM employees WHERE email = 'demo@taproot.pos' LIMIT 1",
    );

    if (empRes.rows.length === 0) {
      console.log('[check-seed] demo@taproot.pos employee not found — skipping password check.');
      return;
    }

    const { id, password_hash: hash } = empRes.rows[0];
    const isValidHash = typeof hash === 'string' && hash.startsWith('$2') && hash.length >= 55;

    if (!isValidHash) {
      console.log('[check-seed] demo@taproot.pos has invalid password hash — regenerating...');
      const newHash = await bcrypt.hash('TaprootDemo2026!', 12);
      await client.query('UPDATE employees SET password_hash = $1 WHERE id = $2', [newHash, id]);
      console.log('[check-seed] Password hash repaired.');
    } else {
      console.log('[check-seed] demo@taproot.pos password hash is valid.');
    }
  } catch (err) {
    console.error('[check-seed] Error during seed check:', err.message);
    // Do NOT exit non-zero — let the server start regardless
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[check-seed] Unexpected error:', err.message);
  process.exit(0); // Always exit 0 — seed errors must not block server startup
});
