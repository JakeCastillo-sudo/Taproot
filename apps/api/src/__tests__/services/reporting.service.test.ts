import { jest } from '@jest/globals';

// ─── reporting.service.ts — unit tests ───────────────────────────────────────
// Focus: each function calls query with correct SQL shape and returns
// correctly shaped response objects.

const mockQuery = jest.fn<() => Promise<any>>();
jest.mock('../../db/client', () => ({ query: mockQuery }));

import {
  getSalesSummary,
  getTopProducts,
  getTopCustomers,
  getPaymentMethodBreakdown,
  getEmployeePerformance,
  getHourlyHeatmap,
  getDashboardMetrics,
} from '../../services/reporting.service';

const ORG    = 'org-1';
const PARAMS = { from: '2025-01-01T00:00:00Z', to: '2025-02-01T00:00:00Z' };

beforeEach(() => mockQuery.mockReset());

// ─── getSalesSummary ──────────────────────────────────────────────────────────

describe('getSalesSummary', () => {
  it('returns sales rows', async () => {
    const row = {
      period:      '2025-01-01T00:00:00Z',
      order_count: 10,
      gross_sales: 5000,
      discounts:   200,
      net_sales:   4800,
      tax:         480,
      tips:        100,
      refunds:     0,
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const rows = await getSalesSummary(ORG, PARAMS, 'day');
    expect(rows).toHaveLength(1);
    expect(rows[0].gross_sales).toBe(5000);
  });

  it('passes granularity and timezone to query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getSalesSummary(ORG, { ...PARAMS, timezone: 'America/Chicago' }, 'week');

    const sql = (mockQuery.mock.calls[0] as any)[0] as string;
    expect(sql).toContain('date_trunc');
    const bindings = (mockQuery.mock.calls[0] as any)[1] as unknown[];
    expect(bindings).toContain('week');
    expect(bindings).toContain('America/Chicago');
  });

  it('applies locationId filter when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getSalesSummary(ORG, { ...PARAMS, locationId: 'loc-1' }, 'month');

    const sql = (mockQuery.mock.calls[0] as any)[0] as string;
    expect(sql).toContain('location_id');
  });
});

// ─── getTopProducts ───────────────────────────────────────────────────────────

describe('getTopProducts', () => {
  it('returns product rows ordered by gross_sales', async () => {
    const rows = [
      { product_id: 'p1', product_name: 'Latte', variant_name: null, qty_sold: 50, gross_sales: 250, order_count: 30 },
      { product_id: 'p2', product_name: 'Cappuccino', variant_name: null, qty_sold: 30, gross_sales: 150, order_count: 25 },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getTopProducts(ORG, PARAMS, 10);
    expect(result).toHaveLength(2);
    expect(result[0].product_name).toBe('Latte');
  });
});

// ─── getTopCustomers ──────────────────────────────────────────────────────────

describe('getTopCustomers', () => {
  it('returns top customers ordered by total_spend', async () => {
    const rows = [
      {
        customer_id:    'c1',
        customer_name:  'Alice Smith',
        email:          'alice@example.com',
        order_count:    15,
        total_spend:    1500,
        loyalty_points: 300,
        loyalty_tier:   'gold',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getTopCustomers(ORG, PARAMS);
    expect(result).toHaveLength(1);
    expect(result[0].customer_name).toBe('Alice Smith');
    expect(result[0].loyalty_tier).toBe('gold');
  });
});

// ─── getPaymentMethodBreakdown ────────────────────────────────────────────────

describe('getPaymentMethodBreakdown', () => {
  it('calculates percentages from raw rows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { payment_method: 'credit_card', transaction_count: '80', total_amount: '8000' },
        { payment_method: 'cash',        transaction_count: '20', total_amount: '2000' },
      ],
    });

    const result = await getPaymentMethodBreakdown(ORG, PARAMS);
    expect(result).toHaveLength(2);

    const creditCard = result.find((r) => r.payment_method === 'credit_card')!;
    expect(creditCard.percentage).toBe(80);

    const cash = result.find((r) => r.payment_method === 'cash')!;
    expect(cash.percentage).toBe(20);

    // Percentages should sum to 100
    const total = result.reduce((s, r) => s + r.percentage, 0);
    expect(total).toBe(100);
  });

  it('returns 0% for all methods when grand total is 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ payment_method: 'cash', transaction_count: '0', total_amount: '0' }],
    });

    const result = await getPaymentMethodBreakdown(ORG, PARAMS);
    expect(result[0].percentage).toBe(0);
  });
});

// ─── getEmployeePerformance ───────────────────────────────────────────────────

describe('getEmployeePerformance', () => {
  it('returns employee performance rows', async () => {
    const rows = [
      {
        employee_id:       'emp-1',
        employee_name:     'Bob Jones',
        order_count:       '42',
        gross_sales:       '4200',
        avg_order_value:   '100',
        refund_count:      '2',
        tips_collected:    '420',
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getEmployeePerformance(ORG, PARAMS);
    expect(result).toHaveLength(1);
    expect(result[0].employee_name).toBe('Bob Jones');
  });
});

// ─── getHourlyHeatmap ─────────────────────────────────────────────────────────

describe('getHourlyHeatmap', () => {
  it('returns 7×24 style rows', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      hour:        i + 8,
      day_of_week: 1,
      order_count: 10 + i,
      gross_sales: 100 + i * 10,
    }));
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await getHourlyHeatmap(ORG, PARAMS);
    expect(result).toHaveLength(5);
    expect(result[0].hour).toBe(8);
    expect(result[0].day_of_week).toBe(1);
  });
});

// ─── getDashboardMetrics ──────────────────────────────────────────────────────

describe('getDashboardMetrics', () => {
  it('returns structured dashboard object with today/yesterday/week/month', async () => {
    // Main aggregation query
    mockQuery.mockResolvedValueOnce({
      rows: [{
        today_sales:         '1000',
        today_orders:        '10',
        today_customers:     '5',
        yesterday_sales:     '900',
        yesterday_orders:    '9',
        yesterday_customers: '4',
        week_sales:          '5000',
        week_orders:         '50',
        month_sales:         '15000',
        month_orders:        '150',
      }],
    });
    // Top product query
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Espresso', qty: '20' }] });

    const metrics = await getDashboardMetrics(ORG);

    expect(metrics.today.gross_sales).toBe(1000);
    expect(metrics.today.order_count).toBe(10);
    expect(metrics.today.avg_order).toBe(100);
    expect(metrics.today.new_customers).toBe(5);

    expect(metrics.yesterday.gross_sales).toBe(900);
    expect(metrics.this_week.order_count).toBe(50);
    expect(metrics.this_month.gross_sales).toBe(15000);

    expect(metrics.top_product_today).toEqual({ name: 'Espresso', qty: 20 });
  });

  it('returns null top_product_today when no orders today', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        today_sales: '0', today_orders: '0', today_customers: '0',
        yesterday_sales: '0', yesterday_orders: '0', yesterday_customers: '0',
        week_sales: '0', week_orders: '0',
        month_sales: '0', month_orders: '0',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no top product

    const metrics = await getDashboardMetrics(ORG);
    expect(metrics.top_product_today).toBeNull();
  });

  it('avg_order is 0 when order count is 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        today_sales: '500', today_orders: '0', today_customers: '0',
        yesterday_sales: '0', yesterday_orders: '0', yesterday_customers: '0',
        week_sales: '0', week_orders: '0',
        month_sales: '0', month_orders: '0',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const metrics = await getDashboardMetrics(ORG);
    expect(metrics.today.avg_order).toBe(0);
  });
});
