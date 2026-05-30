import path from 'path';
import runner from 'node-pg-migrate';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL is not set');

const migrationsDir = path.resolve(__dirname, '../../../../migrations');

async function runMigrations(direction: 'up' | 'down' = 'up', count?: number) {
  await runner({
    databaseUrl: dbUrl!,
    dir: migrationsDir,
    direction,
    count,
    migrationsTable: 'pgmigrations',
    log: (msg) => console.log('[migrate]', msg),
  });
}

const cmd = process.argv[2] as 'up' | 'down' | 'seed' | undefined;

if (cmd === 'down') {
  runMigrations('down', 1).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  runMigrations('up').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
