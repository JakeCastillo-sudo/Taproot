#!/usr/bin/env node
/**
 * reseed.js — Wipe the demo org and re-run all migrations from scratch.
 *
 * Usage:  npm run db:reseed
 *
 * WARNING: This deletes ALL data for the demo-restaurant org.
 *          Never run against a production database.
 */
const { execSync } = require('child_process');
const path = require('path');

const DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/taproot_dev';

console.log('⚠️  Reseeding database:', DB_URL);
console.log('   Truncating organizations (CASCADE)...');

execSync(
  `psql "${DB_URL}" -c "TRUNCATE organizations CASCADE;"`,
  { stdio: 'inherit' },
);

console.log('   Re-running all migrations...');

execSync(
  `DATABASE_URL="${DB_URL}" npm run db:migrate`,
  {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  },
);

console.log('\n✅  Database reseeded successfully.');
console.log('   Login: demo@taproot.pos / TaprootDemo2026!\n');
