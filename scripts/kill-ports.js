#!/usr/bin/env node
/**
 * kill-ports.js — Kill any processes occupying the Taproot dev ports
 * before starting the dev server.  Called by `npm run dev:clean`.
 */
const { execSync } = require('child_process');

const PORTS = [3001, 5173, 5174, 5175, 5176, 5177, 5178];

for (const port of PORTS) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: 'pipe',
      shell: true,
    });
    console.log(`  ✓  port ${port} cleared`);
  } catch {
    // Port was already free — nothing to do
  }
}

console.log('All dev ports cleared.\n');
