import { jest } from '@jest/globals';

// ─── offline.service.ts — unit tests ─────────────────────────────────────────
// Tests AES-256-GCM encryption/decryption roundtrip, queueOfflinePayment,
// processOfflineQueue (success, retry, dead-letter), and getOfflineQueueStatus.

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
jest.mock('../../db/client', () => ({ query: mockQuery }));

// Redis mock — simulates a real in-memory store
const redisStore: Map<string, { value: string; ttl: number }> = new Map();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = jest.Mock<() => Promise<any>>;

const mockRedis = {
  set: (jest.fn() as unknown as AnyFn).mockImplementation(
    async (...args: unknown[]) => {
      const [key, value, ...rest] = args as [string, string, ...unknown[]];
      const exIdx = rest.findIndex((a) => a === 'EX');
      const ttl   = exIdx >= 0 ? Number(rest[exIdx + 1]) : Infinity;
      const nx    = rest.includes('NX');
      if (nx && redisStore.has(key)) return null;
      redisStore.set(key, { value, ttl });
      return 'OK';
    },
  ),
  get: (jest.fn() as unknown as AnyFn).mockImplementation(
    async (...args: unknown[]) => {
      const [key] = args as [string];
      return redisStore.get(key)?.value ?? null;
    },
  ),
  del: (jest.fn() as unknown as AnyFn).mockImplementation(
    async (...keys: unknown[]) => {
      let count = 0;
      for (const k of keys as string[]) { if (redisStore.delete(k)) count++; }
      return count;
    },
  ),
  ttl: (jest.fn() as unknown as AnyFn).mockResolvedValue(86400),
  scan: (jest.fn() as unknown as AnyFn).mockResolvedValue(['0', []]),
};

jest.mock('../../db/redis', () => ({
  getPublisher: () => mockRedis,
  CHANNELS:     { offlineQueue: 'taproot:offline_payments' },
}));

// Stripe mock
const mockPaymentIntentsCreate = jest.fn<() => Promise<any>>();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockPaymentIntentsCreate },
  })),
);

// Config with valid 64-hex-char key and test Stripe key
jest.mock('../../config', () => ({
  config: {
    OFFLINE_ENCRYPTION_KEY:      '0000000000000000000000000000000000000000000000000000000000000000',
    STRIPE_SECRET_KEY:           'sk_test_fake',
    TAPROOT_APPLICATION_FEE_RATE: 0.003,
  },
}));

import {
  queueOfflinePayment,
  processOfflineQueue,
  getOfflineQueueStatus,
} from '../../payments/offline.service';
import { ValidationError, NotFoundError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetRedis() {
  redisStore.clear();
  mockRedis.set.mockClear();
  mockRedis.get.mockClear();
  mockRedis.del.mockClear();
  mockRedis.scan.mockClear();
  mockRedis.ttl.mockClear();
}

function mockOrderExists(status = 'open') {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', status }] });
}

function mockOrgActive() {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      stripe_connect_account_id: 'acct_test',
      payment_processing_enabled: true,
    }],
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockPaymentIntentsCreate.mockReset();
  resetRedis();
});

// ─── queueOfflinePayment ──────────────────────────────────────────────────────

describe('queueOfflinePayment', () => {
  it('returns a UUID paymentId and writes an encrypted entry to Redis', async () => {
    mockOrderExists();
    // DB insert for payment record
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const paymentId = await queueOfflinePayment(
      'org-1', 'order-1', 1500, 'usd', '4242', 'visa',
    );

    expect(paymentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // Redis should have one key stored
    const storedKey = `offline:payments:org-1:${paymentId}`;
    expect(redisStore.has(storedKey)).toBe(true);
    // Value is encrypted — not plaintext
    const stored = redisStore.get(storedKey)!.value;
    expect(stored).not.toContain('org-1'); // payload is encrypted, not readable
  });

  it('throws ValidationError for amount <= 0', async () => {
    await expect(
      queueOfflinePayment('org-1', 'order-1', 0, 'usd', '4242', 'visa'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when last4 is not exactly 4 digits', async () => {
    await expect(
      queueOfflinePayment('org-1', 'order-1', 100, 'usd', '42', 'visa'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when order does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no order
    await expect(
      queueOfflinePayment('org-1', 'missing-order', 100, 'usd', '4242', 'visa'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError for voided order', async () => {
    mockOrderExists('voided');
    await expect(
      queueOfflinePayment('org-1', 'order-1', 100, 'usd', '4242', 'visa'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for already completed order', async () => {
    mockOrderExists('completed');
    await expect(
      queueOfflinePayment('org-1', 'order-1', 100, 'usd', '4242', 'visa'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── processOfflineQueue ──────────────────────────────────────────────────────

describe('processOfflineQueue', () => {
  it('returns empty array when queue is empty', async () => {
    mockOrgActive();
    mockRedis.scan.mockResolvedValue(['0', []]);

    const results = await processOfflineQueue('org-1');
    expect(results).toEqual([]);
  });

  it('successfully processes a queued payment and deletes the Redis key', async () => {
    // Set up org query
    mockOrgActive();
    // Set up order and insert for queueOfflinePayment
    mockOrderExists();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT payment

    // Queue a payment first
    const paymentId = await queueOfflinePayment(
      'org-1', 'order-1', 2000, 'usd', '1234', 'mastercard',
    );

    // Reset query mock for processOfflineQueue
    mockQuery.mockReset();
    mockOrgActive(); // org query in processOfflineQueue

    // Stripe returns a succeeded PI
    mockPaymentIntentsCreate.mockResolvedValueOnce({ id: 'pi_test_001', status: 'requires_capture' });

    // UPDATE payment query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Set up scan to return the queued key
    const activeKey = `offline:payments:org-1:${paymentId}`;
    mockRedis.scan.mockResolvedValueOnce(['0', [activeKey]]);

    const results = await processOfflineQueue('org-1');

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('processed');
    expect(results[0].paymentId).toBe(paymentId);

    // Key should be deleted
    expect(redisStore.has(activeKey)).toBe(false);
  });

  it('moves entry to dead letter after MAX_ATTEMPTS failures', async () => {
    // Queue a payment
    mockOrderExists();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const paymentId = await queueOfflinePayment(
      'org-1', 'order-1', 1000, 'usd', '9999', 'amex',
    );

    const activeKey    = `offline:payments:org-1:${paymentId}`;
    const deadLetterKey = `offline:payments:failed:org-1:${paymentId}`;

    // Simulate 3 failures (one processOfflineQueue call per attempt)
    for (let attempt = 1; attempt <= 3; attempt++) {
      mockQuery.mockReset();
      mockOrgActive();
      mockRedis.scan.mockResolvedValueOnce(['0', [activeKey]]);
      mockPaymentIntentsCreate.mockRejectedValueOnce(new Error('Stripe unavailable'));

      if (attempt === 3) {
        // UPDATE to failed status
        mockQuery.mockResolvedValueOnce({ rows: [] });
      }

      await processOfflineQueue('org-1');
    }

    // After 3 failures the active key should be gone
    expect(redisStore.has(activeKey)).toBe(false);
    // Dead letter key should exist
    expect(redisStore.has(deadLetterKey)).toBe(true);
  });

  it('throws ValidationError when org has no active Stripe account', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        stripe_connect_account_id: null,
        payment_processing_enabled: false,
      }],
    });

    await expect(processOfflineQueue('org-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when org does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(processOfflineQueue('org-missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── getOfflineQueueStatus ────────────────────────────────────────────────────

describe('getOfflineQueueStatus', () => {
  it('returns zero counts when queues are empty', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['0', []])  // active scan
      .mockResolvedValueOnce(['0', []]); // failed scan

    const status = await getOfflineQueueStatus('org-1');
    expect(status.orgId).toBe('org-1');
    expect(status.queuedCount).toBe(0);
    expect(status.failedCount).toBe(0);
    expect(status.oldestQueuedAt).toBeNull();
  });

  it('reports correct counts when entries exist', async () => {
    // Seed one active entry (scan returns it)
    mockRedis.scan
      .mockResolvedValueOnce(['0', ['offline:payments:org-1:pay-1']]) // active
      .mockResolvedValueOnce(['0', ['offline:payments:failed:org-1:pay-2']]); // failed

    // No active key in store — oldestQueuedAt will be null
    const status = await getOfflineQueueStatus('org-1');
    expect(status.queuedCount).toBe(1);
    expect(status.failedCount).toBe(1);
  });
});
