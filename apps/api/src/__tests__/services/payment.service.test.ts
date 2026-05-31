import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<(fn: any) => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({ createAuditLog: jest.fn() }));

// Mock stripe
const mockPaymentIntentsCreate = jest.fn<() => Promise<any>>();
const mockRefundsCreate = jest.fn<() => Promise<any>>();
const mockPaymentMethodsRetrieve = jest.fn<() => Promise<any>>();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockPaymentIntentsCreate },
    refunds: { create: mockRefundsCreate },
    paymentMethods: { retrieve: mockPaymentMethodsRetrieve },
  }));
});

// Mock redis for offline queue
jest.mock('../../db/redis', () => ({
  getPublisher: () => ({ rpush: jest.fn<() => Promise<any>>().mockResolvedValue(1) }),
  CHANNELS: { offlineQueue: 'taproot:offline_payments' },
}));

import {
  processPayment,
  refundPayment,
  getPayment,
  listPaymentsForOrder,
} from '../../services/payment.service';
import { ValidationError, NotFoundError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTransaction(responses: Array<{ rows: unknown[] }>) {
  let idx = 0;
  const clientQuery = jest.fn<() => Promise<any>>().mockImplementation(() => {
    const r = responses[idx++] ?? { rows: [] };
    return Promise.resolve(r);
  });
  mockWithTransaction.mockImplementation((fn: (c: { query: typeof clientQuery }) => Promise<unknown>) =>
    fn({ query: clientQuery }),
  );
  return clientQuery;
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    organization_id: 'org-1',
    location_id: 'loc-1',
    status: 'open',
    total: 1080,
    amount_paid: 0,
    customer_id: null,
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    order_id: 'order-1',
    payment_method: 'cash',
    amount: 1080,
    tip_amount: 0,
    status: 'completed',
    processor: null,
    processor_payment_id: null,
    processor_response: null,
    card_last4: null,
    card_brand: null,
    refunded_amount: 0,
    offline_queued_at: null,
    offline_synced_at: null,
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
    ...overrides,
  };
}

// ─── processPayment — cash ────────────────────────────────────────────────────

describe('processPayment (cash)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws ValidationError when amount is zero', async () => {
    await expect(
      processPayment('org-1', 'order-1', 'emp-1', { paymentMethod: 'cash', amount: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for a voided order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeOrder({ status: 'voided' })] });

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', { paymentMethod: 'cash', amount: 1000 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates payment and marks order completed when fully paid', async () => {
    const order = makeOrder({ total: 1000 });
    const payment = makePayment({ amount: 1000 });

    mockQuery.mockResolvedValueOnce({ rows: [order] }); // load order

    setupTransaction([
      { rows: [payment] },                             // INSERT payment
      { rows: [{ amount_paid: 1000, total: 1000 }] }, // totals query
      { rows: [] },                                     // UPDATE order
    ]);

    const result = await processPayment('org-1', 'order-1', 'emp-1', {
      paymentMethod: 'cash',
      amount: 1000,
    });

    expect(result.payment_method).toBe('cash');
    expect(result.status).toBe('completed');
  });

  it('throws ValidationError for a completed order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeOrder({ status: 'completed' })] });

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', { paymentMethod: 'cash', amount: 500 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── processPayment — gift card ───────────────────────────────────────────────

describe('processPayment (gift_card)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws ValidationError when gift card code not provided', async () => {
    const order = makeOrder();
    mockQuery.mockResolvedValueOnce({ rows: [order] });

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', {
        paymentMethod: 'gift_card',
        amount: 500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when gift card not found', async () => {
    const order = makeOrder();
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })  // load order
      .mockResolvedValueOnce({ rows: [] });        // gift card not found

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', {
        paymentMethod: 'gift_card',
        amount: 500,
        giftCardCode: 'INVALID',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when gift card balance is insufficient', async () => {
    const order = makeOrder({ total: 1000 });
    const gc = {
      id: 'gc-1', code: 'GC100', current_balance: 200, is_active: true, expires_at: null,
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [gc] });

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', {
        paymentMethod: 'gift_card',
        amount: 500,
        giftCardCode: 'GC100',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── processPayment — credit card ────────────────────────────────────────────

describe('processPayment (credit_card)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws ValidationError when stripePaymentMethodId not provided', async () => {
    const order = makeOrder();
    mockQuery.mockResolvedValueOnce({ rows: [order] });

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', {
        paymentMethod: 'credit_card',
        amount: 1000,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('calls Stripe and creates payment when card charge succeeds', async () => {
    const order = makeOrder({ total: 1000 });
    const payment = makePayment({ payment_method: 'credit_card', processor: 'stripe' });

    mockQuery.mockResolvedValueOnce({ rows: [order] });

    mockPaymentIntentsCreate.mockResolvedValueOnce({
      id: 'pi_test123',
      status: 'succeeded',
      payment_method: 'pm_test123',
      client_secret: 'secret',
    } as any);

    mockPaymentMethodsRetrieve.mockResolvedValueOnce({
      card: { last4: '4242', brand: 'visa' },
    } as any);

    setupTransaction([
      { rows: [payment] },
      { rows: [{ amount_paid: 1000, total: 1000 }] },
      { rows: [] },
    ]);

    const result = await processPayment('org-1', 'order-1', 'emp-1', {
      paymentMethod: 'credit_card',
      amount: 1000,
      stripePaymentMethodId: 'pm_test123',
    });

    expect(mockPaymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(result.processor).toBe('stripe');
  });

  it('throws ValidationError when Stripe charge fails', async () => {
    const order = makeOrder();
    mockQuery.mockResolvedValueOnce({ rows: [order] });
    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error('Your card was declined') as any);

    await expect(
      processPayment('org-1', 'order-1', 'emp-1', {
        paymentMethod: 'credit_card',
        amount: 1000,
        stripePaymentMethodId: 'pm_declined',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── processPayment — offline mode ───────────────────────────────────────────

describe('processPayment (offline_queued)', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('creates an offline_queued payment without hitting Stripe', async () => {
    const order = makeOrder();
    const payment = makePayment({ status: 'offline_queued' });

    mockQuery.mockResolvedValueOnce({ rows: [order] });

    setupTransaction([
      { rows: [payment] },                                   // INSERT payment
      { rows: [] },                                           // UPDATE offline_queued_at
      { rows: [{ amount_paid: 1000, total: 1080 }] },       // totals query
      { rows: [] },                                           // UPDATE order
    ]);

    const result = await processPayment('org-1', 'order-1', 'emp-1', {
      paymentMethod: 'credit_card',
      amount: 1000,
      offlineMode: true,
    });

    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
    expect(result.status).toBe('offline_queued');
  });
});

// ─── refundPayment ────────────────────────────────────────────────────────────

describe('refundPayment', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws NotFoundError when payment not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      refundPayment('org-1', 'emp-1', { paymentId: 'pay-missing', amount: 100 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when payment is already fully refunded', async () => {
    const payment = makePayment({ status: 'refunded', refunded_amount: 1080 });
    mockQuery.mockResolvedValueOnce({ rows: [payment] });

    await expect(
      refundPayment('org-1', 'emp-1', { paymentId: 'pay-1', amount: 100 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when refund amount exceeds refundable amount', async () => {
    const payment = makePayment({ amount: 1000, refunded_amount: 800, status: 'partially_refunded' });
    mockQuery.mockResolvedValueOnce({ rows: [payment] });

    await expect(
      refundPayment('org-1', 'emp-1', { paymentId: 'pay-1', amount: 500 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('issues a partial refund for a cash payment without hitting Stripe', async () => {
    const payment = makePayment({ amount: 1000, refunded_amount: 0, status: 'completed', processor: null });
    const updated = makePayment({ amount: 1000, refunded_amount: 200, status: 'partially_refunded' });

    mockQuery
      .mockResolvedValueOnce({ rows: [payment] }) // load payment
      .mockResolvedValueOnce({ rows: [updated] }) // UPDATE payment
      .mockResolvedValueOnce({ rows: [] });         // UPDATE order

    const result = await refundPayment('org-1', 'emp-1', { paymentId: 'pay-1', amount: 200 });

    expect(mockRefundsCreate).not.toHaveBeenCalled();
    expect(result.status).toBe('partially_refunded');
    expect(result.refunded_amount).toBe(200);
  });

  it('calls Stripe refund for card payment', async () => {
    const payment = makePayment({
      amount: 1000, refunded_amount: 0, status: 'completed',
      processor: 'stripe', processor_payment_id: 'pi_test123',
    });
    const updated = makePayment({ amount: 1000, refunded_amount: 1000, status: 'refunded' });

    mockQuery
      .mockResolvedValueOnce({ rows: [payment] })
      .mockResolvedValueOnce({ rows: [updated] })
      .mockResolvedValueOnce({ rows: [] });

    mockRefundsCreate.mockResolvedValueOnce({ id: 're_test', status: 'succeeded' } as any);

    const result = await refundPayment('org-1', 'emp-1', { paymentId: 'pay-1', amount: 1000 });

    expect(mockRefundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_test123', amount: 1000 }),
    );
    expect(result.status).toBe('refunded');
  });
});

// ─── getPayment ───────────────────────────────────────────────────────────────

describe('getPayment', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('returns payment when found', async () => {
    const payment = makePayment();
    mockQuery.mockResolvedValueOnce({ rows: [payment] });

    const result = await getPayment('org-1', 'pay-1');
    expect(result.id).toBe('pay-1');
  });

  it('throws NotFoundError when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getPayment('org-1', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── listPaymentsForOrder ─────────────────────────────────────────────────────

describe('listPaymentsForOrder', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('returns all payments for an order', async () => {
    const payments = [makePayment(), makePayment({ id: 'pay-2', amount: 200 })];
    mockQuery.mockResolvedValueOnce({ rows: payments });

    const result = await listPaymentsForOrder('org-1', 'order-1');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no payments exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await listPaymentsForOrder('org-1', 'order-1');
    expect(result).toEqual([]);
  });
});
