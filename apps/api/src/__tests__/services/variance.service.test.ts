import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
const mockWithTransaction = jest.fn<() => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

jest.mock('../../auth/audit', () => ({
  createAuditLog: jest.fn(),
}));

jest.mock('../../services/recipe.service', () => ({
  getTheoreticalUsage: jest.fn(),
}));

import { getVarianceReport, listVarianceReports, finalizeVarianceReport } from '../../services/variance.service';
import { getTheoreticalUsage } from '../../services/recipe.service';
import { NotFoundError, ValidationError } from '../../errors';

const mockGetTheoreticalUsage = getTheoreticalUsage as jest.MockedFunction<typeof getTheoreticalUsage>;

// ─── getVarianceReport ────────────────────────────────────────────────────────

describe('getVarianceReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws NotFoundError when report does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      getVarianceReport('org-1', 'report-missing'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns report with lines', async () => {
    const report = {
      id: 'report-1', organization_id: 'org-1', location_id: 'loc-1',
      period_start: '2025-01-01', period_end: '2025-01-07',
      status: 'draft', generated_by: 'emp-1',
      created_at: '2025-01-08', updated_at: '2025-01-08',
    };
    const lines = [
      { id: 'line-1', report_id: 'report-1', product_id: 'prod-1', variance_pct: 15, is_flagged: true },
    ];
    mockQuery.mockResolvedValueOnce({ rows: [report] });
    mockQuery.mockResolvedValueOnce({ rows: lines });

    const result = await getVarianceReport('org-1', 'report-1');
    expect(result.id).toBe('report-1');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].is_flagged).toBe(true);
  });
});

// ─── finalizeVarianceReport ───────────────────────────────────────────────────

describe('finalizeVarianceReport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws NotFoundError when report does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      finalizeVarianceReport('org-1', 'missing', 'emp-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when already finalized', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', status: 'finalized' }],
    });

    await expect(
      finalizeVarianceReport('org-1', 'r1', 'emp-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('finalizes draft report and returns updated report', async () => {
    // First call: fetch report
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', status: 'draft' }] });
    // Second call: UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // getVarianceReport calls: fetch report + fetch lines
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r1', organization_id: 'org-1', status: 'finalized',
        period_start: '2025-01-01', period_end: '2025-01-07',
        created_at: '2025-01-08', updated_at: '2025-01-08',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // lines

    const result = await finalizeVarianceReport('org-1', 'r1', 'emp-1');
    expect(result.status).toBe('finalized');
  });
});

// ─── listVarianceReports ──────────────────────────────────────────────────────

describe('listVarianceReports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty results when none found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listVarianceReports('org-1');
    expect(result.total).toBe(0);
    expect(result.reports).toHaveLength(0);
  });

  it('returns paginated results', async () => {
    const reports = [
      { id: 'r1', status: 'draft', period_start: '2025-01-01' },
      { id: 'r2', status: 'finalized', period_start: '2024-12-01' },
    ];
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    mockQuery.mockResolvedValueOnce({ rows: reports });

    const result = await listVarianceReports('org-1');
    expect(result.total).toBe(2);
    expect(result.reports).toHaveLength(2);
  });

  it('filters by status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r2', status: 'finalized' }] });

    const result = await listVarianceReports('org-1', undefined, 'finalized');
    expect(result.total).toBe(1);
    expect(result.reports[0].status).toBe('finalized');
  });

  it('filters by locationId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', location_id: 'loc-2' }] });

    const result = await listVarianceReports('org-1', 'loc-2');
    expect(result.total).toBe(1);
  });

  it('caps limit at 100', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listVarianceReports('org-1', undefined, undefined, 500);

    // Verify the SQL calls received — limit should be capped
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockQuery.mock.calls as any[][];
    const listCall = calls[1];
    // The params array last two entries are limit and offset
    const params = listCall[1] as unknown[];
    expect(params[params.length - 2]).toBe(100); // capped limit
  });
});
