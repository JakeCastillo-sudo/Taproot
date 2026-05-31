import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<(fn: any) => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({ createAuditLog: jest.fn() }));

jest.mock('../../services/realtime.service', () => ({
  publishOrderEvent: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
  buildEvent: jest.fn().mockReturnValue({ type: 'order:created', locationId: 'loc-1', payload: {}, timestamp: '' }),
}));

import {
  createOrder,
  getOrder,
  listOrders,
  voidOrder,
  parkOrder,
  resumeOrder,
  updateOrder,
} from '../../services/order.service';
import { ValidationError, NotFoundError, ForbiddenError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sets up mockWithTransaction to execute the callback with a mock client.
 * `responses` are drained in call order.
 */
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
    employee_id: 'emp-1',
    customer_id: null,
    order_number: 'T-2026-000001',
    status: 'open',
    order_type: 'in_store',
    table_id: null,
    subtotal: 1000,
    discount_total: 0,
    tax_total: 80,
    tip_total: 0,
    total: 1080,
    amount_paid: 0,
    change_due: 0,
    notes: null,
    source: 'pos',
    fulfilled_at: null,
    voided_at: null,
    void_reason: null,
    metadata: {},
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
    ...overrides,
  };
}

// ─── createOrder ──────────────────────────────────────────────────────────────

describe('createOrder', () => {
  const ORG = 'org-1';
  const LOC = 'loc-1';
  const EMP = 'emp-1';

  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws ValidationError when lineItems is empty', async () => {
    setupTransaction([
      { rows: [{ id: LOC, is_active: true, deleted_at: null }] }, // location
      { rows: [{ id: EMP, is_active: true }] },                   // employee
    ]);

    await expect(
      createOrder(ORG, LOC, EMP, {
        orderType: 'in_store',
        lineItems: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when location is not active', async () => {
    setupTransaction([
      { rows: [] }, // location not found
    ]);

    await expect(
      createOrder(ORG, LOC, EMP, {
        orderType: 'in_store',
        lineItems: [{ productId: 'p-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when product does not exist', async () => {
    setupTransaction([
      { rows: [{ id: LOC, is_active: true, deleted_at: null }] }, // location
      { rows: [{ id: EMP, is_active: true }] },                   // employee
      { rows: [] },                                                // product not found
    ]);

    await expect(
      createOrder(ORG, LOC, EMP, {
        orderType: 'in_store',
        lineItems: [{ productId: 'p-missing', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when line item quantity is zero', async () => {
    setupTransaction([
      { rows: [{ id: LOC, is_active: true, deleted_at: null }] },
      { rows: [{ id: EMP, is_active: true }] },
    ]);

    await expect(
      createOrder(ORG, LOC, EMP, {
        orderType: 'in_store',
        lineItems: [{ productId: 'p-1', quantity: 0 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates an order and returns OrderWithRelations', async () => {
    const product = {
      id: 'p-1', category_id: null, name: 'Coffee', sku: 'COFFEE',
      cost_price: 200, is_active: true, deleted_at: null,
    };
    const defaultVariant = { id: 'v-1', name: 'Regular', sku: null, cost_price: 200 };
    const price = { price: 500 };
    const order = makeOrder({ subtotal: 500, total: 540 });
    const lineItem = {
      id: 'li-1', order_id: 'order-1', product_id: 'p-1', variant_id: 'v-1',
      name: 'Coffee', sku: null, quantity: 1, unit_price: 500, cost_price: 200,
      discount_amount: 0, tax_amount: 40, total: 540,
      modifiers: [], notes: null, voided_at: null, employee_id: EMP,
      created_at: '2026-05-31T00:00:00Z', updated_at: '2026-05-31T00:00:00Z',
    };

    setupTransaction([
      { rows: [{ id: LOC, is_active: true, deleted_at: null }] },  // location
      { rows: [{ id: EMP, is_active: true }] },                     // employee
      { rows: [product] },                                           // product
      { rows: [defaultVariant] },                                    // default variant
      { rows: [price] },                                             // price
      { rows: [] },                                                   // discounts (none)
      { rows: [{ rate: 0.08 }] },                                    // tax rates
      { rows: [order] },                                             // INSERT order
      { rows: [lineItem] },                                          // INSERT line item
    ]);

    const result = await createOrder(ORG, LOC, EMP, {
      orderType: 'in_store',
      lineItems: [{ productId: 'p-1', quantity: 1 }],
    });

    expect(result.id).toBe('order-1');
    expect(result.lineItems).toHaveLength(1);
    expect(result.payments).toHaveLength(0);
    expect(result.discounts).toHaveLength(0);
  });

  it('attaches customer and updates stats when customerId provided', async () => {
    const product = {
      id: 'p-1', category_id: null, name: 'Latte', sku: null,
      cost_price: 150, is_active: true, deleted_at: null,
    };
    const defaultVariant = { id: 'v-1', name: 'Default', sku: null, cost_price: 150 };
    const price = { price: 400 };
    const order = makeOrder({ customer_id: 'cust-1' });
    const lineItem = {
      id: 'li-1', order_id: 'order-1', product_id: 'p-1', variant_id: 'v-1',
      name: 'Latte', sku: null, quantity: 1, unit_price: 400, cost_price: 150,
      discount_amount: 0, tax_amount: 32, total: 432,
      modifiers: [], notes: null, voided_at: null, employee_id: EMP,
      created_at: '2026-05-31T00:00:00Z', updated_at: '2026-05-31T00:00:00Z',
    };

    const clientQuery = setupTransaction([
      { rows: [{ id: LOC, is_active: true, deleted_at: null }] }, // location
      { rows: [{ id: EMP, is_active: true }] },                    // employee
      { rows: [{ id: 'cust-1' }] },                                // customer verify
      { rows: [product] },                                          // product
      { rows: [defaultVariant] },                                   // default variant
      { rows: [price] },                                            // price
      { rows: [] },                                                  // discounts (none)
      { rows: [{ rate: 0.08 }] },                                   // tax rates
      { rows: [order] },                                            // INSERT order
      { rows: [lineItem] },                                         // INSERT line item
      { rows: [] },                                                  // UPDATE customer stats
    ]);

    const result = await createOrder(ORG, LOC, EMP, {
      orderType: 'in_store',
      customerId: 'cust-1',
      lineItems: [{ productId: 'p-1', quantity: 1 }],
    });

    expect(result.customer_id).toBe('cust-1');

    // Verify customer stats UPDATE was called
    const calls = clientQuery.mock.calls as any[][];
    const customerUpdateCall = calls.find((c) => {
      const sql = String(c[0]);
      return sql.includes('UPDATE customers') && sql.includes('visit_count');
    });
    expect(customerUpdateCall).toBeDefined();
  });
});

// ─── getOrder ────────────────────────────────────────────────────────────────

describe('getOrder', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('returns order with relations', async () => {
    const order = makeOrder();
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })           // order
      .mockResolvedValueOnce({ rows: [] })                 // lineItems
      .mockResolvedValueOnce({ rows: [] })                 // payments
      .mockResolvedValueOnce({ rows: [] });                // discounts

    const result = await getOrder('org-1', 'order-1');
    expect(result.id).toBe('order-1');
    expect(result.lineItems).toEqual([]);
    expect(result.payments).toEqual([]);
    expect(result.customer).toBeNull();
  });

  it('throws NotFoundError when order does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getOrder('org-1', 'missing-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when cashier tries to access another employees order', async () => {
    const order = makeOrder({ employee_id: 'emp-other' });
    mockQuery
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      getOrder('org-1', 'order-1', 'emp-self'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── listOrders ───────────────────────────────────────────────────────────────

describe('listOrders', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('returns paginated order list', async () => {
    const orders = [makeOrder(), makeOrder({ id: 'order-2' })];
    mockQuery
      .mockResolvedValueOnce({ rows: orders })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await listOrders('org-1', 'loc-1');
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('caps limit at 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listOrders('org-1', 'loc-1', { limit: 9999 });

    // The SQL should have LIMIT 200
    const calls = mockQuery.mock.calls as any[][];
    const listCall = calls[0];
    expect(String(listCall[0])).toContain('LIMIT 200');
  });

  it('applies restrictToEmployeeId filter for cashiers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listOrders('org-1', 'loc-1', { restrictToEmployeeId: 'emp-cashier' });

    const calls = mockQuery.mock.calls as any[][];
    const listCall = calls[0];
    expect(listCall[1]).toContain('emp-cashier');
  });
});

// ─── voidOrder ────────────────────────────────────────────────────────────────

describe('voidOrder', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('voids an open order', async () => {
    const order = makeOrder();
    const voided = makeOrder({ status: 'voided', voided_at: '2026-05-31T01:00:00Z', void_reason: 'test' });

    setupTransaction([
      { rows: [order] },          // SELECT FOR UPDATE
      { rows: [] },               // SELECT applied_discounts
      { rows: [] },               // UPDATE line items
      { rows: [voided] },         // UPDATE order status
    ]);

    const result = await voidOrder('org-1', 'loc-1', 'order-1', 'emp-1', 'test');
    expect(result.status).toBe('voided');
    expect(result.void_reason).toBe('test');
  });

  it('throws ValidationError when order is already voided', async () => {
    const order = makeOrder({ status: 'voided' });
    setupTransaction([{ rows: [order] }]);

    await expect(
      voidOrder('org-1', 'loc-1', 'order-1', 'emp-1', 'again'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when order is completed', async () => {
    const order = makeOrder({ status: 'completed' });
    setupTransaction([{ rows: [order] }]);

    await expect(
      voidOrder('org-1', 'loc-1', 'order-1', 'emp-1', 'reason'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── parkOrder ────────────────────────────────────────────────────────────────

describe('parkOrder', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('parks an open order', async () => {
    const parked = makeOrder({ status: 'parked' });
    mockQuery.mockResolvedValueOnce({ rows: [parked] });

    const result = await parkOrder('org-1', 'loc-1', 'order-1', 'emp-1');
    expect(result.status).toBe('parked');
  });

  it('throws ValidationError when order is in an unparkable status', async () => {
    // UPDATE returns 0 rows when status is not open/in_progress
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      parkOrder('org-1', 'loc-1', 'order-1', 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── resumeOrder ─────────────────────────────────────────────────────────────

describe('resumeOrder', () => {
  beforeEach(() => { mockQuery.mockReset(); mockWithTransaction.mockReset(); });

  it('throws ValidationError when order is not parked', async () => {
    const order = makeOrder({ status: 'open' });
    setupTransaction([{ rows: [order] }]);

    await expect(
      resumeOrder('org-1', 'loc-1', 'order-1', 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('resumes a parked order and re-fetches', async () => {
    const parked = makeOrder({ status: 'parked' });
    const lineItem = {
      id: 'li-1', variant_id: 'v-1', unit_price: 500, quantity: 1,
      product_id: 'p-1', discount_amount: 0, tax_amount: 40, total: 540,
      name: 'Coffee', sku: null, cost_price: 200, modifiers: [], notes: null,
    };
    const open = makeOrder({ status: 'open' });

    setupTransaction([
      { rows: [parked] },                                            // SELECT FOR UPDATE
      { rows: [lineItem] },                                          // current line items
      { rows: [{ price: 500 }] },                                    // price check
      { rows: [lineItem] },                                          // recalc items
      { rows: [] },                                                   // old discounts
      { rows: [] },                                                   // delete discounts
      { rows: [{ rate: 0.08 }] },                                    // tax rates
      { rows: [] },                                                   // UPDATE order totals
      { rows: [] },                                                   // UPDATE status
    ]);

    // fetchOrderWithRelations uses the module-level `query`
    mockQuery
      .mockResolvedValueOnce({ rows: [open] })
      .mockResolvedValueOnce({ rows: [lineItem] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await resumeOrder('org-1', 'loc-1', 'order-1', 'emp-1');
    expect(result.status).toBe('open');
  });
});
