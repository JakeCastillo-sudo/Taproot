import { jest } from '@jest/globals';

// ─── customer.service.ts — unit tests ────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<(fn: any) => Promise<any>>();

jest.mock('../../db/client', () => ({
  query:           mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({ createAuditLog: jest.fn() }));

import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  searchCustomers,
  mergeCustomers,
  addAccountCredit,
  deductAccountCredit,
} from '../../services/customer.service';
import { ValidationError, NotFoundError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const EMP = 'emp-1';
const CID = 'cust-1';

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id:               CID,
    organization_id:  ORG,
    first_name:       'Alice',
    last_name:        'Smith',
    email:            'alice@example.com',
    phone:            '+15550001234',
    loyalty_points:   100,
    loyalty_tier:     'bronze',
    account_credit:   0,
    total_spend:      500,
    visit_count:      5,
    last_visit_at:    null,
    tags:             null,
    notes:            null,
    merged_into_id:   null,
    deleted_at:       null,
    created_at:       '2025-01-01T00:00:00Z',
    updated_at:       '2025-01-01T00:00:00Z',
    date_of_birth:    null,
    address:          null,
    marketing_opt_in: false,
    external_ids:     {},
    ...overrides,
  };
}

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

beforeEach(() => {
  mockQuery.mockReset();
  mockWithTransaction.mockReset();
});

// ─── createCustomer ───────────────────────────────────────────────────────────

describe('createCustomer', () => {
  it('creates a customer and returns it', async () => {
    const newCust = makeCustomer();
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // email uniqueness
      .mockResolvedValueOnce({ rows: [] }) // phone uniqueness
      .mockResolvedValueOnce({ rows: [newCust] }); // INSERT

    const result = await createCustomer(ORG, EMP, {
      firstName: 'Alice',
      lastName:  'Smith',
      email:     'alice@example.com',
      phone:     '+15550001234',
    });

    expect(result.id).toBe(CID);
    expect(result.first_name).toBe('Alice');
  });

  it('throws ValidationError when no identifying info is provided', async () => {
    await expect(createCustomer(ORG, EMP, {})).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws ValidationError when email is already taken', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'other-cust' }] }); // duplicate

    await expect(
      createCustomer(ORG, EMP, { email: 'alice@example.com' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when phone is already taken', async () => {
    // No email provided → email check is skipped; only phone check runs
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] }); // phone taken

    await expect(
      createCustomer(ORG, EMP, { phone: '+15550001234' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── getCustomer ──────────────────────────────────────────────────────────────

describe('getCustomer', () => {
  it('returns the customer when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCustomer()] });
    const c = await getCustomer(ORG, CID);
    expect(c.id).toBe(CID);
  });

  it('throws NotFoundError when customer does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getCustomer(ORG, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── updateCustomer ───────────────────────────────────────────────────────────

describe('updateCustomer', () => {
  it('updates allowed fields and returns updated customer', async () => {
    const updated = makeCustomer({ first_name: 'Alicia' });
    mockQuery
      .mockResolvedValueOnce({ rows: [makeCustomer()] })    // requireCustomer
      .mockResolvedValueOnce({ rows: [updated] });          // UPDATE

    const result = await updateCustomer(ORG, CID, EMP, { firstName: 'Alicia' });
    expect(result.first_name).toBe('Alicia');
  });

  it('throws NotFoundError when customer missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateCustomer(ORG, 'missing', EMP, { firstName: 'Bob' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError on duplicate email', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeCustomer()] })      // requireCustomer
      .mockResolvedValueOnce({ rows: [{ id: 'other' }] });    // email duplicate check

    await expect(
      updateCustomer(ORG, CID, EMP, { email: 'taken@example.com' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── deleteCustomer ───────────────────────────────────────────────────────────

describe('deleteCustomer', () => {
  it('soft-deletes the customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeCustomer()] }) // requireCustomer
      .mockResolvedValueOnce({ rows: [] });              // UPDATE

    await expect(deleteCustomer(ORG, CID, EMP)).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundError for missing customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(deleteCustomer(ORG, 'ghost', EMP)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── listCustomers ────────────────────────────────────────────────────────────

describe('listCustomers', () => {
  it('returns paginated results', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '3' }] })
      .mockResolvedValueOnce({ rows: [makeCustomer(), makeCustomer(), makeCustomer()] });

    const result = await listCustomers(ORG, { page: 1, perPage: 25 });
    expect(result.total).toBe(3);
    expect(result.customers).toHaveLength(3);
    expect(result.page).toBe(1);
  });

  it('applies search filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [makeCustomer()] });

    await listCustomers(ORG, { search: 'alice' });

    const countSQL = (mockQuery.mock.calls[0] as any)[0] as string;
    expect(countSQL).toContain('ILIKE');
  });
});

// ─── searchCustomers ──────────────────────────────────────────────────────────

describe('searchCustomers', () => {
  it('returns empty array for query shorter than 2 chars', async () => {
    const results = await searchCustomers(ORG, 'a');
    expect(results).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('executes ILIKE search for longer query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCustomer()] });
    const results = await searchCustomers(ORG, 'alice', 5);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for empty string', async () => {
    const results = await searchCustomers(ORG, '');
    expect(results).toEqual([]);
  });
});

// ─── mergeCustomers ───────────────────────────────────────────────────────────

describe('mergeCustomers', () => {
  it('merges source into target and returns updated target', async () => {
    const source = makeCustomer({ id: 'src', loyalty_points: 50, account_credit: 10, total_spend: 200, visit_count: 2 });
    const target = makeCustomer({ id: 'tgt', loyalty_points: 100, account_credit: 20 });

    mockQuery
      .mockResolvedValueOnce({ rows: [source] }) // requireCustomer source
      .mockResolvedValueOnce({ rows: [target] }) // requireCustomer target
      .mockResolvedValueOnce({ rows: [target] }); // final requireCustomer after merge

    setupTransaction([
      { rows: [] }, // UPDATE orders
      { rows: [] }, // UPDATE loyalty_transactions
      { rows: [] }, // UPDATE customers (absorb)
      { rows: [] }, // UPDATE customers (soft-delete source)
    ]);

    const result = await mergeCustomers(ORG, 'src', 'tgt', EMP);
    expect(result.id).toBe('tgt');
  });

  it('throws ValidationError when source === target', async () => {
    await expect(mergeCustomers(ORG, CID, CID, EMP)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when source is already merged', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeCustomer({ id: 'src', merged_into_id: 'already-merged' })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [makeCustomer({ id: 'tgt' })] });

    await expect(mergeCustomers(ORG, 'src', 'tgt', EMP)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── addAccountCredit ─────────────────────────────────────────────────────────

describe('addAccountCredit', () => {
  it('adds credit and returns updated customer', async () => {
    const before  = makeCustomer({ account_credit: 0 });
    const after   = makeCustomer({ account_credit: 500 });

    mockQuery
      .mockResolvedValueOnce({ rows: [before] }) // requireCustomer
      .mockResolvedValueOnce({ rows: [after] }); // UPDATE

    const result = await addAccountCredit(ORG, CID, 500, 'refund', EMP);
    expect(result.account_credit).toBe(500);
  });

  it('throws ValidationError for zero or negative amount', async () => {
    await expect(addAccountCredit(ORG, CID, 0, 'test', EMP)).rejects.toBeInstanceOf(ValidationError);
    await expect(addAccountCredit(ORG, CID, -1, 'test', EMP)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── deductAccountCredit ──────────────────────────────────────────────────────

describe('deductAccountCredit', () => {
  it('deducts credit when sufficient balance', async () => {
    const before = makeCustomer({ account_credit: 1000 });
    const after  = makeCustomer({ account_credit: 500  });

    mockQuery
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [after]  });

    const result = await deductAccountCredit(ORG, CID, 500, 'order-1');
    expect(result.account_credit).toBe(500);
  });

  it('throws ValidationError when credit is insufficient', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCustomer({ account_credit: 100 })] });
    await expect(deductAccountCredit(ORG, CID, 500, 'order-1')).rejects.toBeInstanceOf(ValidationError);
  });
});
