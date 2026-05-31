import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWithTransaction = jest.fn<(fn: any) => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({
  createAuditLog: jest.fn(),
}));

jest.mock('../../services/recipe.service', () => ({
  calculateDepletionForSale: jest.fn(),
}));

import {
  adjustInventory,
  transferStock,
  getInventoryLevel,
} from '../../services/inventory.service';
import {
  InsufficientStockError,
  InventoryLevelError,
  ValidationError,
} from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLevel(qty: number, id = 'level-1') {
  return { id, quantity_on_hand: qty };
}

/**
 * Sets up mockWithTransaction to execute the callback with a mock client.
 * Responses are drained in order for each client.query() call.
 */
function setupTransaction(responses: Array<{ rows: unknown[] }>) {
  let idx = 0;
  const clientQuery = jest.fn<() => Promise<any>>().mockImplementation(() => {
    const r = responses[idx++] ?? { rows: [] };
    return Promise.resolve(r);
  });
  mockWithTransaction.mockImplementation((fn: (c: { query: typeof clientQuery }) => Promise<unknown>) => {
    return fn({ query: clientQuery });
  });
  return clientQuery;
}

// ─── adjustInventory ──────────────────────────────────────────────────────────

describe('adjustInventory', () => {
  const ORG = 'org-1';
  const LOC = 'loc-1';
  const PROD = 'prod-1';

  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError when delta is zero', async () => {
    await expect(
      adjustInventory(ORG, LOC, { productId: PROD, delta: 0 }, 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ProductNotFoundError when product does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });     // product lookup

    const { ProductNotFoundError } = await import('../../errors');
    await expect(
      adjustInventory(ORG, LOC, { productId: 'missing', delta: 5 }, 'emp-1'),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('throws InsufficientStockError when removing more than on hand', async () => {
    // product lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROD, track_inventory: true, name: 'Vodka' }] });

    setupTransaction([
      // lockInventoryRow: SELECT ... FOR UPDATE
      { rows: [makeLevel(5)] },
    ]);

    await expect(
      adjustInventory(ORG, LOC, { productId: PROD, delta: -10 }, 'emp-1'),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('returns updated inventory level on success', async () => {
    // product lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: PROD, track_inventory: true, name: 'Vodka' }] });

    setupTransaction([
      { rows: [makeLevel(20)] },  // lockInventoryRow
      { rows: [] },               // UPDATE inventory_levels
      { rows: [] },               // INSERT inventory_movements
    ]);

    // Final SELECT after transaction
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'level-1', quantity_on_hand: 25 }] });

    const result = await adjustInventory(ORG, LOC, { productId: PROD, delta: 5 }, 'emp-1');
    expect(result).toMatchObject({ id: 'level-1', quantity_on_hand: 25 });
  });
});

// ─── transferStock ────────────────────────────────────────────────────────────

describe('transferStock', () => {
  const ORG = 'org-1';
  const FROM = 'loc-from';
  const TO = 'loc-to';

  beforeEach(() => jest.clearAllMocks());

  it('throws ValidationError when fromLocation === toLocation', async () => {
    await expect(
      transferStock(ORG, FROM, FROM, [{ productId: 'p1', quantity: 1 }], 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns immediately when items array is empty', async () => {
    await expect(
      transferStock(ORG, FROM, TO, [], 'emp-1'),
    ).resolves.toBeUndefined();
  });

  it('throws ValidationError when item quantity <= 0', async () => {
    // location lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FROM }, { id: TO }] });
    // gen_random_uuid
    mockQuery.mockResolvedValueOnce({ rows: [{ ref: 'ref-uuid' }] });

    setupTransaction([
      // lockInventoryRow source — validation happens inside transaction
      { rows: [makeLevel(10)] },
    ]);

    await expect(
      transferStock(ORG, FROM, TO, [{ productId: 'p1', quantity: 0 }], 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws InsufficientStockError when source has less than requested', async () => {
    // location lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FROM }, { id: TO }] });
    // gen_random_uuid
    mockQuery.mockResolvedValueOnce({ rows: [{ ref: 'ref-uuid' }] });

    setupTransaction([
      { rows: [makeLevel(3)] },                // source locked with qty=3
      { rows: [{ name: 'Vodka' }] },           // product name lookup
    ]);

    await expect(
      transferStock(ORG, FROM, TO, [{ productId: 'p1', quantity: 10 }], 'emp-1'),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });
});

// ─── getInventoryLevel ────────────────────────────────────────────────────────

describe('getInventoryLevel', () => {
  const ORG = 'org-1';
  const LOC = 'loc-1';

  beforeEach(() => jest.clearAllMocks());

  it('returns inventory level when found', async () => {
    const level = { id: 'lvl-1', quantity_on_hand: 42 };
    mockQuery.mockResolvedValueOnce({ rows: [level] });

    const result = await getInventoryLevel(ORG, LOC, 'prod-1');
    expect(result).toEqual(level);
  });

  it('throws InventoryLevelError when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      getInventoryLevel(ORG, LOC, 'missing-prod'),
    ).rejects.toBeInstanceOf(InventoryLevelError);
  });
});
