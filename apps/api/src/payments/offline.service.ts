/**
 * Offline payment queue — AES-256-GCM encrypted, Redis-backed.
 *
 * When network connectivity to Stripe is lost (or the merchant is operating
 * in "offline mode"), card transactions are queued locally. Once connectivity
 * is restored, processOfflineQueue() drains the queue and posts the charges
 * to Stripe.
 *
 * Security guarantees
 * ───────────────────
 * - Card numbers are NEVER stored. Only last4 + brand are kept.
 * - Every queue entry is encrypted with AES-256-GCM using OFFLINE_ENCRYPTION_KEY.
 * - The raw plaintext is never written to logs or the DB.
 * - Redis keys expire after 24 h (86400 s) to bound exposure.
 *
 * Redis key layout
 * ────────────────
 *   offline:payments:{orgId}:{paymentId}   — active queue entry  (TTL 86400 s)
 *   offline:payments:failed:{orgId}:{paymentId} — dead letter after 3 retries
 *
 * Retry policy
 * ────────────
 * Each processOfflineQueue() call increments an `attempts` counter inside the
 * encrypted payload. After MAX_ATTEMPTS (3) failures the entry is moved to the
 * dead-letter key and the active key is deleted. Dead-letter entries do NOT
 * expire automatically — they need manual review.
 *
 * Idempotency
 * ───────────
 * Stripe API calls use idempotency keys formatted as:
 *   taproot-{orgId}-{orderId}-{queuedAt timestamp}
 * so replaying the same offline entry never double-charges the customer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { query } from '../db/client';
import { getPublisher } from '../db/redis';
import { ValidationError, NotFoundError } from '../errors';
import { getMerchantStripeClient, TAPROOT_APPLICATION_FEE_RATE } from './stripe.config';
import { config } from '../config';

// ─── Constants ────────────────────────────────────────────────────────────────

const OFFLINE_TTL_SECONDS = 86_400; // 24 hours
const MAX_ATTEMPTS        = 3;
const KEY_PREFIX          = 'offline:payments';
const DEAD_LETTER_PREFIX  = 'offline:payments:failed';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfflinePaymentPayload {
  paymentId: string;
  orgId:     string;
  orderId:   string;
  amount:    number;
  currency:  string;
  last4:     string;
  brand:     string;
  queuedAt:  string; // ISO-8601
  attempts:  number;
}

export interface OfflineQueueStatus {
  orgId:         string;
  queuedCount:   number;
  failedCount:   number;
  oldestQueuedAt: string | null;
}

export interface ProcessResult {
  paymentId:  string;
  orderId:    string;
  status:     'processed' | 'failed' | 'dead_lettered';
  error?:     string;
}

// ─── Encryption helpers ───────────────────────────────────────────────────────

function encryptPayload(payload: OfflinePaymentPayload): string {
  const key        = Buffer.from(config.OFFLINE_ENCRYPTION_KEY, 'hex');
  const iv         = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext  = JSON.stringify(payload);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag();
  // Format: iv_hex:tag_hex:ciphertext_hex
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptPayload(encryptedStr: string): OfflinePaymentPayload {
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid offline payment payload format');

  const [ivHex, tagHex, ciphertextHex] = parts;
  const key        = Buffer.from(config.OFFLINE_ENCRYPTION_KEY, 'hex');
  const iv         = Buffer.from(ivHex, 'hex');
  const tag        = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  return JSON.parse(plaintext) as OfflinePaymentPayload;
}

// ─── Redis key helpers ────────────────────────────────────────────────────────

function activeKey(orgId: string, paymentId: string): string {
  return `${KEY_PREFIX}:${orgId}:${paymentId}`;
}

function deadLetterKey(orgId: string, paymentId: string): string {
  return `${DEAD_LETTER_PREFIX}:${orgId}:${paymentId}`;
}

// ─── queueOfflinePayment ──────────────────────────────────────────────────────

/**
 * Encrypt and enqueue an offline payment for later processing.
 *
 * @param orgId    Organisation ID
 * @param orderId  Order being paid
 * @param amount   Amount in smallest currency unit (cents)
 * @param currency ISO-4217 lowercase (e.g. 'usd')
 * @param last4    Last 4 digits of the card (never the full number)
 * @param brand    Card brand (visa, mastercard, etc.)
 * @returns        The generated paymentId (UUID)
 */
export async function queueOfflinePayment(
  orgId:    string,
  orderId:  string,
  amount:   number,
  currency: string,
  last4:    string,
  brand:    string,
): Promise<string> {
  if (!config.OFFLINE_ENCRYPTION_KEY) {
    throw new ValidationError('OFFLINE_ENCRYPTION_KEY is not configured — cannot queue offline payments');
  }
  if (amount <= 0) {
    throw new ValidationError('Payment amount must be greater than 0');
  }
  if (!/^\d{4}$/.test(last4)) {
    throw new ValidationError('last4 must be exactly 4 digits');
  }

  // Validate order exists and belongs to org
  const { rows: [order] } = await query<{ id: string; status: string }>(
    `SELECT id, status FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'voided')    throw new ValidationError('Cannot queue payment for a voided order');
  if (order.status === 'completed') throw new ValidationError('Order is already completed');

  const paymentId = crypto.randomUUID();
  const payload: OfflinePaymentPayload = {
    paymentId,
    orgId,
    orderId,
    amount,
    currency,
    last4,
    brand,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };

  const encrypted = encryptPayload(payload);
  const redis     = getPublisher();
  await redis.set(activeKey(orgId, paymentId), encrypted, 'EX', OFFLINE_TTL_SECONDS);

  // Create a DB record in 'offline_queued' status so the cashier sees it
  await query(
    `INSERT INTO payments
       (id, order_id, payment_method, amount, tip_amount, status,
        processor, processor_payment_id, processor_response, refunded_amount)
     VALUES ($1, $2, 'credit_card', $3, 0, 'offline_queued', 'stripe_terminal', $4, $5, 0)
     ON CONFLICT DO NOTHING`,
    [
      paymentId,
      orderId,
      amount,
      null,
      JSON.stringify({ queuedAt: payload.queuedAt, last4, brand, currency }),
    ],
  );

  return paymentId;
}

// ─── processOfflineQueue ──────────────────────────────────────────────────────

/**
 * Drain the offline queue for an organisation. Each entry is decrypted,
 * submitted to Stripe, and the DB record is promoted to 'completed' on success.
 *
 * After MAX_ATTEMPTS failures the entry moves to the dead-letter namespace.
 *
 * @returns Array of per-payment results
 */
export async function processOfflineQueue(orgId: string): Promise<ProcessResult[]> {
  if (!config.OFFLINE_ENCRYPTION_KEY) {
    throw new ValidationError('OFFLINE_ENCRYPTION_KEY is not configured');
  }

  // Fetch the organisation's Stripe account
  const { rows: [org] } = await query<{
    stripe_connect_account_id: string | null;
    payment_processing_enabled: boolean;
  }>(
    `SELECT stripe_connect_account_id, payment_processing_enabled
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  if (!org) throw new NotFoundError('Organization');
  if (!org.stripe_connect_account_id || !org.payment_processing_enabled) {
    throw new ValidationError(
      'Organization Stripe account is not active — cannot process offline queue',
    );
  }

  const redis   = getPublisher();
  const pattern = `${KEY_PREFIX}:${orgId}:*`;

  // SCAN instead of KEYS to avoid blocking Redis on large key spaces
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    // Exclude dead-letter keys from active scan
    keys.push(...batch.filter((k) => !k.startsWith(DEAD_LETTER_PREFIX)));
  } while (cursor !== '0');

  if (keys.length === 0) return [];

  const merchantStripe = getMerchantStripeClient(org.stripe_connect_account_id);
  const results: ProcessResult[] = [];

  for (const key of keys) {
    const encrypted = await redis.get(key);
    if (!encrypted) continue; // expired between scan and get — skip

    let payload: OfflinePaymentPayload;
    try {
      payload = decryptPayload(encrypted);
    } catch (decryptErr) {
      // Corrupted entry — move directly to dead letter
      await redis.set(
        deadLetterKey(orgId, key.split(':').pop()!),
        encrypted,
      );
      await redis.del(key);
      results.push({
        paymentId: key.split(':').pop()!,
        orderId:   '',
        status:    'dead_lettered',
        error:     'Decryption failed — payload may be corrupted',
      });
      continue;
    }

    payload.attempts += 1;

    try {
      const applicationFeeAmount = Math.floor(payload.amount * TAPROOT_APPLICATION_FEE_RATE);
      // Idempotency key: taproot-{orgId}-{orderId}-{queuedAt}
      const idempotencyKey = `taproot-${payload.orgId}-${payload.orderId}-${new Date(payload.queuedAt).getTime()}`;

      const pi: any = await merchantStripe.paymentIntents.create(
        {
          amount:   payload.amount,
          currency: payload.currency,
          payment_method_types:   ['card_present'],
          capture_method:         'automatic',
          application_fee_amount: applicationFeeAmount,
          metadata: {
            taprootOrderId:    payload.orderId,
            taprootOrgId:      payload.orgId,
            taprootPaymentId:  payload.paymentId,
            offlineQueuedAt:   payload.queuedAt,
          },
        },
        { idempotencyKey },
      );

      // Mark DB record completed
      await query(
        `UPDATE payments
         SET status             = 'completed',
             processor_payment_id = $1,
             processor_response = $2,
             updated_at         = now()
         WHERE id = $3`,
        [
          pi.id,
          JSON.stringify({
            paymentIntentId:     pi.id,
            applicationFeeAmount,
            processedAt:         new Date().toISOString(),
            last4:               payload.last4,
            brand:               payload.brand,
          }),
          payload.paymentId,
        ],
      );

      // Remove from queue on success
      await redis.del(key);

      results.push({ paymentId: payload.paymentId, orderId: payload.orderId, status: 'processed' });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (payload.attempts >= MAX_ATTEMPTS) {
        // Move to dead letter
        const dlKey     = deadLetterKey(payload.orgId, payload.paymentId);
        const dlPayload = encryptPayload(payload); // re-encrypt with updated attempts
        await redis.set(dlKey, dlPayload); // no TTL — needs manual review
        await redis.del(key);

        await query(
          `UPDATE payments
           SET status             = 'failed',
               processor_response = processor_response || $1::jsonb,
               updated_at         = now()
           WHERE id = $2`,
          [
            JSON.stringify({
              deadLetteredAt: new Date().toISOString(),
              lastError:      errorMsg,
              attempts:       payload.attempts,
            }),
            payload.paymentId,
          ],
        );

        results.push({
          paymentId: payload.paymentId,
          orderId:   payload.orderId,
          status:    'dead_lettered',
          error:     errorMsg,
        });
      } else {
        // Re-encrypt with incremented attempts and write back
        const updated = encryptPayload(payload);
        // Preserve remaining TTL
        const ttl = await redis.ttl(key);
        const remainingTtl = ttl > 0 ? ttl : OFFLINE_TTL_SECONDS;
        await redis.set(key, updated, 'EX', remainingTtl);

        results.push({
          paymentId: payload.paymentId,
          orderId:   payload.orderId,
          status:    'failed',
          error:     errorMsg,
        });
      }
    }
  }

  return results;
}

// ─── getOfflineQueueStatus ────────────────────────────────────────────────────

/**
 * Return a summary of the offline queue for an organisation.
 * Does NOT decrypt — just counts keys and reads the queuedAt timestamp
 * from the encrypted blobs (which would require decryption — so instead
 * we report what we can without touching plaintext).
 */
export async function getOfflineQueueStatus(orgId: string): Promise<OfflineQueueStatus> {
  const redis = getPublisher();

  // Count active queue keys
  const activePattern = `${KEY_PREFIX}:${orgId}:*`;
  const failedPattern = `${DEAD_LETTER_PREFIX}:${orgId}:*`;

  const activeKeys: string[] = [];
  const failedKeys: string[] = [];

  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', activePattern, 'COUNT', 100);
    cursor = nextCursor;
    activeKeys.push(...batch.filter((k) => !k.startsWith(DEAD_LETTER_PREFIX)));
  } while (cursor !== '0');

  cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', failedPattern, 'COUNT', 100);
    cursor = nextCursor;
    failedKeys.push(...batch);
  } while (cursor !== '0');

  // Decrypt first active entry to get oldest queuedAt — best-effort
  let oldestQueuedAt: string | null = null;
  if (activeKeys.length > 0 && config.OFFLINE_ENCRYPTION_KEY) {
    try {
      const encrypted = await redis.get(activeKeys[0]);
      if (encrypted) {
        const payload    = decryptPayload(encrypted);
        oldestQueuedAt   = payload.queuedAt;
      }
    } catch {
      // Non-fatal — just omit the timestamp
    }
  }

  return {
    orgId,
    queuedCount:    activeKeys.length,
    failedCount:    failedKeys.length,
    oldestQueuedAt,
  };
}
