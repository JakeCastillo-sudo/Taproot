// Load .env from apps/api/.env — must happen before any config reads.
// __dirname resolves to apps/api/src/db, so ../../.env = apps/api/.env
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

import path from 'path';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL is not set');

const migrationsDir = path.resolve(__dirname, '../../../../migrations');

// node-pg-migrate v8 exports 'runner' as a named export (not default).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runner } = require('node-pg-migrate') as {
  runner: (opts: Record<string, unknown>) => Promise<void>;
};

async function runMigrations(direction: 'up' | 'down' = 'up', count?: number): Promise<void> {
  await runner({
    databaseUrl:     dbUrl,
    dir:             migrationsDir,
    direction,
    count,
    migrationsTable: 'pgmigrations',
    // Allow migrations applied out of strict numerical order (002 was applied
    // after 003-006 due to an earlier manual seed run — this is fine for dev).
    checkOrder:      false,
    log: (msg: string) => console.log('[migrate]', msg),
  });
}

const cmd = process.argv[2];

if (cmd === 'down') {
  runMigrations('down', 1).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
} else {
  runMigrations('up').catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
