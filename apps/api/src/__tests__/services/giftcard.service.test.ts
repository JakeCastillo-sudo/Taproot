import { jest } from '@jest/globals';

// ─── giftcard.service.ts — unit tests ────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<(fn: any) => Promise<any>>();

jest.mock('../../db/client', () => ({
  query:           mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({ createAuditLog: jest.fn() }));

import {
  issueGiftCard,
  getGiftCard,
  getGiftCardById,
  reloadGiftCard,
  deactivateGiftCard,
  getGiftCardTransactions,
  listGiftCards,
} from '../../services/giftcard.service';
import { ValidationError, NotFoundError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG = 'org-1';
const EMP = 'emp-1';
const CARD_ID = 'card-1';

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id:                      CARD_ID,
    organization_id:         ORG,
    code:                    'ABCD-EFGH-IJKL-MNOP',
    initial_balance:         5000,
    current_balance:         5000,
    currency:                'USD',
    issued_to_customer_id:   null,
    issued_by_employee_id:   EMP,
    issued_at:               '2025-01-01T00:00:00Z',
    expires_at:              null,
    is_active:               true,
    created_at:              '2025-01-01T00:00:00Z',
    updated_at:              '2025-01-01T00:00:00Z',
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

// ─── issueGiftCard ────────────────────────────────────────────────────────────

describe('issueGiftCard', () => {
  it('issues a gift card and returns it', async () => {
    const card = makeCard();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // code uniqueness check
    setupTransaction([
      { rows: [card] }, // INSERT gift_card
      { rows: [] },     // INSERT transaction
    ]);

    const result = await issueGiftCard(ORG, EMP, { initialBalance: 5000 });
    expect(result.id).toBe(CARD_ID);
    expect(result.current_balance).toBe(5000);
  });

  it('throws ValidationError for zero or negative balance', async () => {
    await expect(
      issueGiftCard(ORG, EMP, { initialBalance: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates customer when issuedToCustomerId is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // customer check — not found
    ;

    await expect(
      issueGiftCard(ORG, EMP, { initialBalance: 1000, issuedToCustomerId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('includes customer id when valid', async () => {
    const card = makeCard({ issued_to_customer_id: 'cust-1' });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cust-1' }] }); // customer found
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // code uniqueness
    setupTransaction([
      { rows: [card] },
      { rows: [] },
    ]);

    const result = await issueGiftCard(ORG, EMP, {
      initialBalance:      1000,
      issuedToCustomerId:  'cust-1',
    });
    expect(result.issued_to_customer_id).toBe('cust-1');
  });
});

// ─── getGiftCard / getGiftCardById ────────────────────────────────────────────

describe('getGiftCard', () => {
  it('looks up card by code (case-insensitive)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCard()] });
    const card = await getGiftCard(ORG, 'abcd-efgh-ijkl-mnop');
    expect(card.id).toBe(CARD_ID);
  });

  it('throws NotFoundError when code not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getGiftCard(ORG, 'XXXX-XXXX-XXXX-XXXX')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('getGiftCardById', () => {
  it('looks up card by ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCard()] });
    const card = await getGiftCardById(ORG, CARD_ID);
    expect(card.id).toBe(CARD_ID);
  });

  it('throws NotFoundError for unknown ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(getGiftCardById(ORG, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── reloadGiftCard ───────────────────────────────────────────────────────────

describe('reloadGiftCard', () => {
  it('adds funds and writes a ledger entry', async () => {
    const before  = makeCard({ current_balance: 2000 });
    const after   = makeCard({ current_balance: 5000 });

    mockQuery.mockResolvedValueOnce({ rows: [before] }); // requireGiftCard
    setupTransaction([
      { rows: [after] }, // UPDATE gift_cards
      { rows: [] },      // INSERT transaction
    ]);

    const result = await reloadGiftCard(ORG, EMP, CARD_ID, 3000);
    expect(result.current_balance).toBe(5000);
  });

  it('throws ValidationError for zero reload amount', async () => {
    await expect(reloadGiftCard(ORG, EMP, CARD_ID, 0)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when card is inactive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCard({ is_active: false })] });
    await expect(reloadGiftCard(ORG, EMP, CARD_ID, 100)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── deactivateGiftCard ───────────────────────────────────────────────────────

describe('deactivateGiftCard', () => {
  it('deactivates an active card', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeCard()] }) // requireGiftCard
      .mockResolvedValueOnce({ rows: [] });          // UPDATE

    await expect(deactivateGiftCard(ORG, CARD_ID, EMP)).resolves.toBeUndefined();
  });

  it('throws ValidationError when card is already inactive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeCard({ is_active: false })] });
    await expect(deactivateGiftCard(ORG, CARD_ID, EMP)).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── getGiftCardTransactions ──────────────────────────────────────────────────

describe('getGiftCardTransactions', () => {
  it('returns transaction history', async () => {
    const txn = {
      id: 'txn-1', gift_card_id: CARD_ID, order_id: null,
      transaction_type: 'issue', amount: 5000, balance_before: 0, balance_after: 5000,
      employee_id: EMP, notes: null, created_at: '2025-01-01T00:00:00Z',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [makeCard()] }) // requireGiftCard
      .mockResolvedValueOnce({ rows: [txn] });       // SELECT transactions

    const txns = await getGiftCardTransactions(ORG, CARD_ID);
    expect(txns).toHaveLength(1);
    expect(txns[0].transaction_type).toBe('issue');
  });
});

// ─── listGiftCards ────────────────────────────────────────────────────────────

describe('listGiftCards', () => {
  it('returns paginated card list', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [makeCard(), makeCard({ id: 'card-2', code: 'XXXX-XXXX-XXXX-XXXX' })] });

    const result = await listGiftCards(ORG);
    expect(result.total).toBe(2);
    expect(result.cards).toHaveLength(2);
  });

  it('filters by customer id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [makeCard({ issued_to_customer_id: 'cust-1' })] });

    const result = await listGiftCards(ORG, { customerId: 'cust-1' });
    expect(result.cards[0].issued_to_customer_id).toBe('cust-1');
  });
});
