import path from 'path';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL is not set');

const migrationsDir = path.resolve(__dirname, '../../../../migrations');

// node-pg-migrate uses package.json `exports` which requires node16/bundler moduleResolution.
// Using require() here keeps the rest of the project on classic node resolution.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const runnerModule = require('node-pg-migrate');
const runner = (runnerModule.default ?? runnerModule) as (
  opts: Record<string, unknown>
) => Promise<void>;

async function runMigrations(direction: 'up' | 'down' = 'up', count?: number): Promise<void> {
  await runner({
    databaseUrl: dbUrl,
    dir: migrationsDir,
    direction,
    count,
    migrationsTable: 'pgmigrations',
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
