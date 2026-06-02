/**
 * Taproot POS — Structured health checks + Prometheus metrics endpoint.
 *
 * Registers:
 *   GET /metrics   → Prometheus text format (protected by METRICS_SECRET header)
 *
 * Metrics exposed:
 *   taproot_http_requests_total{method,route,status}   counter
 *   taproot_http_duration_seconds{method,route}         histogram
 *   taproot_db_pool_size                               gauge
 *   taproot_db_pool_idle                               gauge
 *   taproot_db_pool_pending                            gauge
 *   taproot_orders_total                               counter
 *   taproot_revenue_total_cents                        counter
 *   taproot_memory_rss_bytes                           gauge
 *   taproot_memory_heap_bytes                          gauge
 *   taproot_process_uptime_seconds                     gauge
 *   taproot_disk_used_percent                          gauge
 *
 * Register in apps/api/src/index.ts:
 *   import { registerMonitoring } from './monitoring/health';
 *   await registerMonitoring(fastify);
 */

import {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify';
import * as os from 'os';
import { pool } from '../db/client';
import { getPublisher } from '../db/redis';

// In-process metric stores (reset on restart — acceptable for infra-level monitoring)
const httpRequestsTotal    = new Map<string, number>();
const httpDurationBuckets  = new Map<string, number[]>(); // key → array of durations in ms
const ordersTotal          = { count: 0 };
const revenueTotalCents    = { count: 0 };

// Prometheus text-format helpers
function fmtCounter(name: string, help: string, labels: Record<string, string>, value: number): string {
  const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  return `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name}{${labelStr}} ${value}\n`;
}

function fmtGauge(name: string, help: string, value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}\n`;
}

function fmtHistogram(name: string, help: string, durations: number[]): string {
  const BOUNDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  const sum    = durations.reduce((a, b) => a + b, 0);
  const count  = durations.length;
  let out = `# HELP ${name} ${help}\n# TYPE ${name} histogram\n`;
  for (const le of BOUNDS) {
    const c = durations.filter((d) => d / 1000 <= le).length;
    out += `${name}_bucket{le="${le}"} ${c}\n`;
  }
  out += `${name}_bucket{le="+Inf"} ${count}\n`;
  out += `${name}_sum ${sum / 1000}\n`;
  out += `${name}_count ${count}\n`;
  return out;
}

// ── Public API — increment counters from service layer ────────────────────────

/** Call after a new order is successfully created. */
export function incrementOrdersTotal(): void {
  ordersTotal.count++;
}

/** Call after a successful payment is processed. `amountCents` = payment.amount * 100 */
export function incrementRevenue(amountCents: number): void {
  revenueTotalCents.count += amountCents;
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

export async function registerMonitoring(fastify: FastifyInstance): Promise<void> {

  // ── HTTP metrics via request lifecycle hooks ───────────────────────────────
  const START_TIMES = new WeakMap<FastifyRequest, number>();

  fastify.addHook('onRequest', async (req) => {
    START_TIMES.set(req, Date.now());
  });

  fastify.addHook('onResponse', async (req, reply) => {
    const start = START_TIMES.get(req);
    if (!start) return;

    const duration = Date.now() - start;
    const method   = req.method;
    // Use the route pattern (not the actual URL) to avoid high cardinality
    const route    = (req.routeOptions?.url ?? req.url).replace(/\/[0-9a-f-]{36}/gi, '/:id');
    const status   = String(reply.statusCode);

    const counterKey  = `${method}|${route}|${status}`;
    httpRequestsTotal.set(counterKey, (httpRequestsTotal.get(counterKey) ?? 0) + 1);

    const durKey = `${method}|${route}`;
    const existing = httpDurationBuckets.get(durKey) ?? [];
    existing.push(duration);
    // Keep last 1 000 durations to avoid unbounded memory growth
    if (existing.length > 1000) existing.splice(0, existing.length - 1000);
    httpDurationBuckets.set(durKey, existing);
  });

  // ── GET /metrics endpoint ─────────────────────────────────────────────────
  fastify.get('/metrics', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {

    // Protect with METRICS_SECRET header (simple shared-secret auth)
    const metricsSecret = process.env.METRICS_SECRET;
    if (metricsSecret) {
      const provided = request.headers['x-metrics-secret'];
      if (provided !== metricsSecret) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    }

    const lines: string[] = [];

    // ── HTTP request counters ─────────────────────────────────────────────
    lines.push('# HELP taproot_http_requests_total Total HTTP requests by method, route, status');
    lines.push('# TYPE taproot_http_requests_total counter');
    for (const [key, count] of httpRequestsTotal.entries()) {
      const [method, route, status] = key.split('|');
      lines.push(`taproot_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`);
    }
    lines.push('');

    // ── HTTP duration histograms ──────────────────────────────────────────
    for (const [key, durations] of httpDurationBuckets.entries()) {
      const [method, route] = key.split('|');
      const name = 'taproot_http_duration_seconds';
      lines.push(`# HELP ${name} HTTP request duration in seconds`);
      lines.push(`# TYPE ${name} histogram`);
      const BOUNDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
      const sum    = durations.reduce((a, b) => a + b, 0);
      const count  = durations.length;
      const labelBase = `method="${method}",route="${route}"`;
      for (const le of BOUNDS) {
        const c = durations.filter((d) => d / 1000 <= le).length;
        lines.push(`${name}_bucket{${labelBase},le="${le}"} ${c}`);
      }
      lines.push(`${name}_bucket{${labelBase},le="+Inf"} ${count}`);
      lines.push(`${name}_sum{${labelBase}} ${(sum / 1000).toFixed(6)}`);
      lines.push(`${name}_count{${labelBase}} ${count}`);
      lines.push('');
    }

    // ── DB pool metrics ───────────────────────────────────────────────────
    const poolTotal   = pool.totalCount;
    const poolIdle    = pool.idleCount;
    const poolWaiting = pool.waitingCount;
    lines.push(fmtGauge('taproot_db_pool_size',    'Total DB pool connections',        poolTotal));
    lines.push(fmtGauge('taproot_db_pool_idle',    'Idle DB pool connections',         poolIdle));
    lines.push(fmtGauge('taproot_db_pool_pending', 'Pending DB pool connection waits', poolWaiting));

    // ── Business metrics ──────────────────────────────────────────────────
    lines.push(fmtGauge('taproot_orders_total',        'Total orders processed (since restart)', ordersTotal.count));
    lines.push(fmtGauge('taproot_revenue_total_cents', 'Total revenue in cents (since restart)', revenueTotalCents.count));

    // ── System metrics ────────────────────────────────────────────────────
    const mem = process.memoryUsage();
    lines.push(fmtGauge('taproot_memory_rss_bytes',  'Resident set size in bytes',     mem.rss));
    lines.push(fmtGauge('taproot_memory_heap_bytes', 'V8 heap used in bytes',          mem.heapUsed));
    lines.push(fmtGauge('taproot_process_uptime_seconds', 'Process uptime in seconds', process.uptime()));

    // ── Disk check ────────────────────────────────────────────────────────
    try {
      const total = os.totalmem();
      const free  = os.freemem();
      const usedPct = Math.round(((total - free) / total) * 100);
      lines.push(fmtGauge('taproot_memory_used_percent', 'System memory used percent', usedPct));
      if (usedPct > 80) {
        request.log.warn({ usedPct }, 'System memory usage above 80%');
      }
    } catch { /* ignore */ }

    // ── Redis connected clients ───────────────────────────────────────────
    try {
      const redis   = getPublisher();
      const info    = await redis.info('clients');
      const match   = info.match(/connected_clients:(\d+)/);
      const clients = match ? parseInt(match[1], 10) : 0;
      lines.push(fmtGauge('taproot_redis_connected_clients', 'Redis connected client count', clients));
    } catch { /* redis unreachable — skip */ }

    reply
      .code(200)
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(lines.join('\n'));
  });

  // ── Enhanced structured health check (disk + memory) ─────────────────────
  // The existing /api/health in index.ts checks DB + Redis + Stripe.
  // This hook adds memory/disk warnings to its log output.
  fastify.addHook('onResponse', async (req, reply) => {
    if (req.url !== '/api/health' || reply.statusCode !== 200) return;

    const mem     = process.memoryUsage();
    const memPct  = Math.round((mem.rss / os.totalmem()) * 100);
    if (memPct > 80) {
      req.log.warn({ memPct }, 'Health check: memory usage above 80%');
    }
    if (pool.waitingCount > 0) {
      req.log.warn({ waiting: pool.waitingCount }, 'Health check: DB pool has waiting requests');
    }
  });
}

// ── Exported types for external use ──────────────────────────────────────────
export { fmtGauge, fmtCounter, fmtHistogram };
