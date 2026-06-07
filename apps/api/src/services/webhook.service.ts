/**
 * Webhook service (S8-04) — OUTBOUND event webhooks (merchant subscriptions).
 *
 * Not to be confused with routes/webhook.routes.ts, which receives INBOUND
 * Stripe webhooks. This service lets an org subscribe its own URLs to Taproot
 * events and signs deliveries with a per-webhook HMAC secret:
 *
 *   X-Taproot-Event:     order.completed
 *   X-Taproot-Signature: sha256=<hmac of raw body>
 *   X-Taproot-Delivery:  <uuid>
 *
 * Delivery: up to 3 attempts (1s/3s backoff), 10s timeout per attempt.
 * failure_count increments per failed delivery and resets on success;
 * a webhook auto-disables after 10 consecutive failures.
 *
 * deliverWebhook() is fire-and-forget from business code (`void deliver…`) —
 * it NEVER throws and no-ops while migration 018 is pending.
 */

import { createHmac, randomBytes, randomUUID } from 'crypto';
import { query } from '../db/client';
import { NotFoundError, ValidationError } from '../errors';
import { logger } from '../lib/logger';

export const WEBHOOK_EVENTS = [
  'order.completed',
  'order.voided',
  'payment.completed',
  'payment.refunded',
  'inventory.low_stock',
  'customer.created',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MIGRATION_MSG = 'Webhooks require migration 018 — ask your administrator to run pending migrations.';
const MAX_ATTEMPTS = 3;
const DISABLE_AFTER_FAILURES = 10;
const TIMEOUT_MS = 10_000;

// ─── Migration-pending resilience ─────────────────────────────────────────────

let _ready: boolean | null = null;

async function webhooksReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'webhooks'
     ) AS ready`,
  );
  _ready = Boolean(rows[0]?.ready);
  return _ready;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_triggered_at: string | null;
  failure_count: number;
  created_at: string;
}

export async function listWebhooks(orgId: string): Promise<WebhookRow[]> {
  if (!(await webhooksReady())) return [];
  const { rows } = await query<WebhookRow>(
    `SELECT id, url, events, is_active, last_triggered_at, failure_count, created_at
       FROM webhooks
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [orgId],
  );
  return rows;
}

export async function createWebhook(
  orgId: string,
  data: { url: string; events: string[] },
): Promise<WebhookRow & { secret: string }> {
  if (!(await webhooksReady())) throw new ValidationError(MIGRATION_MSG);

  let parsed: URL;
  try { parsed = new URL(data.url ?? ''); } catch { throw new ValidationError('A valid URL is required'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('Webhook URL must be http(s)');
  }

  const events = (data.events ?? []).filter((e): e is WebhookEvent =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw new ValidationError('At least one event is required');

  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const { rows: [row] } = await query<WebhookRow>(
    `INSERT INTO webhooks (organization_id, url, events, secret)
     VALUES ($1, $2, $3, $4)
     RETURNING id, url, events, is_active, last_triggered_at, failure_count, created_at`,
    [orgId, data.url, events, secret],
  );

  // Secret is returned once at creation (like API keys) for the receiver to verify signatures
  return { ...row, secret };
}

export async function deleteWebhook(orgId: string, webhookId: string): Promise<void> {
  if (!(await webhooksReady())) throw new ValidationError(MIGRATION_MSG);
  const { rowCount } = await query(
    `DELETE FROM webhooks WHERE id = $1 AND organization_id = $2`,
    [webhookId, orgId],
  );
  if (!rowCount) throw new NotFoundError('Webhook not found');
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function postWithTimeout(url: string, body: string, headers: Record<string, string>): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function deliverToEndpoint(
  hook: { id: string; url: string; secret: string; failure_count: number },
  event: string,
  payload: object,
): Promise<void> {
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });
  const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
  const headers = {
    'Content-Type':        'application/json',
    'X-Taproot-Event':     event,
    'X-Taproot-Signature': `sha256=${signature}`,
    'X-Taproot-Delivery':  randomUUID(),
  };

  let ok = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
    ok = await postWithTimeout(hook.url, body, headers);
    if (!ok && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, attempt * 2000 - 1000)); // 1s, 3s
    }
  }

  if (ok) {
    await query(
      `UPDATE webhooks SET last_triggered_at = NOW(), failure_count = 0 WHERE id = $1`,
      [hook.id],
    );
  } else {
    const failures = hook.failure_count + 1;
    await query(
      `UPDATE webhooks
          SET failure_count = $2,
              is_active = CASE WHEN $2 >= $3 THEN false ELSE is_active END
        WHERE id = $1`,
      [hook.id, failures, DISABLE_AFTER_FAILURES],
    );
    logger.warn('webhook delivery failed', { webhookId: hook.id, event, failures });
  }
}

/**
 * Deliver an event to every active subscription for the org. Fire-and-forget:
 * never throws, never blocks the business operation that emitted the event.
 */
export async function deliverWebhook(orgId: string, event: WebhookEvent, payload: object): Promise<void> {
  try {
    if (!(await webhooksReady())) return;
    const { rows: hooks } = await query<{ id: string; url: string; secret: string; failure_count: number }>(
      `SELECT id, url, secret, failure_count
         FROM webhooks
        WHERE organization_id = $1 AND is_active = true AND $2 = ANY(events)`,
      [orgId, event],
    );
    await Promise.allSettled(hooks.map((h) => deliverToEndpoint(h, event, payload)));
  } catch (err) {
    logger.warn('deliverWebhook error', { event, message: err instanceof Error ? err.message : 'unknown' });
  }
}

/** Send a sample payload to one webhook (Settings → Test). Returns success. */
export async function testWebhook(orgId: string, webhookId: string): Promise<{ delivered: boolean }> {
  if (!(await webhooksReady())) throw new ValidationError(MIGRATION_MSG);
  const { rows: [hook] } = await query<{ id: string; url: string; secret: string; failure_count: number }>(
    `SELECT id, url, secret, failure_count FROM webhooks
      WHERE id = $1 AND organization_id = $2`,
    [webhookId, orgId],
  );
  if (!hook) throw new NotFoundError('Webhook not found');

  const body = JSON.stringify({
    event: 'test.ping',
    createdAt: new Date().toISOString(),
    data: { message: 'Taproot webhook test — your endpoint is reachable 🌿' },
  });
  const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
  const delivered = await postWithTimeout(hook.url, body, {
    'Content-Type':        'application/json',
    'X-Taproot-Event':     'test.ping',
    'X-Taproot-Signature': `sha256=${signature}`,
    'X-Taproot-Delivery':  randomUUID(),
  });

  if (delivered) {
    await query(`UPDATE webhooks SET last_triggered_at = NOW(), failure_count = 0 WHERE id = $1`, [hook.id]);
  }
  return { delivered };
}
