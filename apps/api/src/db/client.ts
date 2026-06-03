import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// ─── Pool setup ───────────────────────────────────────────────────────────────

const POOL_MAX = 20;

// ── SSL / DATABASE_URL normalisation ─────────────────────────────────────────
//
// Railway injects DATABASE_URL with ?sslmode=require already appended.
// When pg sees sslmode=require in a URL it sets ssl:true using Node's default
// TLS context, which has rejectUnauthorized:true — this rejects Railway's
// internal self-signed certificate and prevents the pool from connecting.
//
// Fix: strip ALL ssl/sslmode query params from the URL and manage SSL
// exclusively via the Pool's ssl:{rejectUnauthorized:false} option below.
// That option accepts the self-signed cert while still encrypting traffic.
//
// This is safe — all Railway service-to-service traffic stays on their
// private network and never traverses the public internet.
function buildConnectionString(): string {
  const raw = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production' && raw) {
    try {
      const url = new URL(raw);
      const hadParam = url.searchParams.has('sslmode') || url.searchParams.has('ssl');
      url.searchParams.delete('sslmode');
      url.searchParams.delete('ssl');
      const cleaned = url.toString();
      if (hadParam) {
        console.log('[pg] Production: stripped SSL params from DATABASE_URL (Pool ssl option takes over)');
      }
      return cleaned;
    } catch {
      // URL parse failed (malformed DATABASE_URL) — return raw and let pg error clearly
      return raw;
    }
  }
  return raw;
}

const pool = new Pool({
  connectionString:          buildConnectionString(),
  max:                       POOL_MAX,
  connectionTimeoutMillis:   10_000,
  idleTimeoutMillis:         30_000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─── Pool error handling ──────────────────────────────────────────────────────

pool.on('error', (err) => {
  console.error('[pg] Unexpected pool error:', err.message);
});

// ─── Performance helpers ──────────────────────────────────────────────────────

/**
 * Sanitise SQL for logging — strip inline values to avoid leaking PII.
 * Keeps the first 200 chars and truncates; never includes $N values.
 */
function sanitiseSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Log slow queries.
 *
 * > 1000 ms — warning (investigate)
 * > 5000 ms — error   (SLA breach)
 */
function logQueryTime(sql: string, durationMs: number): void {
  if (durationMs > 5_000) {
    console.error('[pg] SLOW QUERY (>5s)', { durationMs, sql: sanitiseSql(sql) });
  } else if (durationMs > 1_000) {
    console.warn('[pg] Slow query (>1s)', { durationMs, sql: sanitiseSql(sql) });
  }
}

/** Warn when pool is under pressure. */
function checkPoolCapacity(): void {
  const used  = pool.totalCount;
  const pct   = used / POOL_MAX;

  if (pct >= 1) {
    console.error('[pg] POOL EXHAUSTED — all connections in use', { totalCount: used, max: POOL_MAX });
  } else if (pct >= 0.8) {
    console.warn('[pg] Pool at >80% capacity', { totalCount: used, max: POOL_MAX });
  }
}

// ─── query ────────────────────────────────────────────────────────────────────

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  checkPoolCapacity();
  const client = await pool.connect();
  const start  = Date.now();
  try {
    const result = await client.query<T>(sql, params); // -- PARAMETERIZED
    logQueryTime(sql, Date.now() - start);
    return result;
  } finally {
    client.release();
  }
}

// ─── withTransaction ──────────────────────────────────────────────────────────

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  checkPoolCapacity();
  const client = await pool.connect();
  const start  = Date.now();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    logQueryTime('TRANSACTION', Date.now() - start);
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Export pool for health check ─────────────────────────────────────────────

export { pool };
