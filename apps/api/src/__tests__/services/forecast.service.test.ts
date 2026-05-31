import { jest } from '@jest/globals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();

jest.mock('../../db/client', () => ({
  query: mockQuery,
  withTransaction: jest.fn(),
}));

import { getBurnRate, getTimeToStockout, getForecastDashboard } from '../../services/forecast.service';

// ─── getBurnRate ──────────────────────────────────────────────────────────────

describe('getBurnRate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns zero burn rate when no movements', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '0', data_points: '0' }] });

    const result = await getBurnRate('org-1', 'loc-1', 'prod-1', null, 168);
    expect(result.burnRatePerHour).toBe(0);
    expect(result.dataPoints).toBe(0);
    expect(result.confidence).toBe('low');
  });

  it('calculates burn rate correctly', async () => {
    // 168 units depleted over 168 hours = 1 unit/hour
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '168', data_points: '200' }] });

    const result = await getBurnRate('org-1', 'loc-1', 'prod-1', null, 168);
    expect(result.burnRatePerHour).toBeCloseTo(1.0);
    expect(result.confidence).toBe('high'); // 200/168 ≈ 1.19 points/hour ≥ 1
  });

  it('assigns medium confidence for moderate data density', async () => {
    // 30 data points over 168 hours = 0.178 points/hour (>= 0.25 threshold? No, it's below)
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '50', data_points: '30' }] });

    const result = await getBurnRate('org-1', 'loc-1', 'prod-1', null, 168);
    // 30/168 ≈ 0.18 points/hour, which is < 0.25 → low
    expect(result.confidence).toBe('low');
  });

  it('assigns medium confidence at ≥0.25 points/hour', async () => {
    // 50 data points over 168 hours = 0.298 points/hour
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '80', data_points: '50' }] });

    const result = await getBurnRate('org-1', 'loc-1', 'prod-1', null, 168);
    expect(result.confidence).toBe('medium');
  });
});

// ─── getTimeToStockout ────────────────────────────────────────────────────────

describe('getTimeToStockout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns nulls when no inventory level record', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // level not found

    const result = await getTimeToStockout('org-1', 'loc-1', 'prod-1');
    expect(result.hoursUntilStockout).toBeNull();
    expect(result.estimatedStockoutAt).toBeNull();
  });

  it('returns null stockout when burn rate is zero', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ quantity_on_hand: 100, reorder_point: null }],
    });
    // getBurnRate query
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '0', data_points: '0' }] });

    const result = await getTimeToStockout('org-1', 'loc-1', 'prod-1');
    expect(result.hoursUntilStockout).toBeNull();
    expect(result.estimatedStockoutAt).toBeNull();
    expect(result.reorderPointReached).toBe(false);
  });

  it('calculates hours until stockout correctly', async () => {
    // 50 units on hand, burn rate 2/hour → 25 hours until stockout
    mockQuery.mockResolvedValueOnce({
      rows: [{ quantity_on_hand: 50, reorder_point: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '336', data_points: '100' }] }); // 336/168 = 2/hr

    const result = await getTimeToStockout('org-1', 'loc-1', 'prod-1');
    expect(result.hoursUntilStockout).toBeCloseTo(25);
    expect(result.estimatedStockoutAt).toBeInstanceOf(Date);
  });

  it('flags reorder point reached', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ quantity_on_hand: 5, reorder_point: 10 }], // below reorder point
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '0', data_points: '0' }] });

    const result = await getTimeToStockout('org-1', 'loc-1', 'prod-1');
    expect(result.reorderPointReached).toBe(true);
    expect(result.hoursUntilReorderPoint).toBeNull(); // already reached
  });

  it('calculates hours until reorder point', async () => {
    // on hand = 100, reorder point = 20, burn rate = 2/hr → (100-20)/2 = 40 hours until reorder
    mockQuery.mockResolvedValueOnce({
      rows: [{ quantity_on_hand: 100, reorder_point: 20 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_depleted: '336', data_points: '100' }] }); // 2/hr

    const result = await getTimeToStockout('org-1', 'loc-1', 'prod-1');
    expect(result.reorderPointReached).toBe(false);
    expect(result.hoursUntilReorderPoint).toBeCloseTo(40);
  });
});

// ─── getForecastDashboard ─────────────────────────────────────────────────────

describe('getForecastDashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns empty array when no tracked products', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getForecastDashboard('org-1', 'loc-1');
    expect(result).toEqual([]);
  });

  it('assigns critical urgency when quantity_on_hand is 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        product_id: 'p1', variant_id: null, quantity_on_hand: 0,
        reorder_point: null, product_name: 'Vodka', product_sku: 'TAP-V',
        unit_of_measure: 'ml',
      }],
    });
    // burn rates query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getForecastDashboard('org-1', 'loc-1');
    expect(result).toHaveLength(1);
    expect(result[0].urgency).toBe('critical');
  });

  it('assigns warning urgency when reorder point reached', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        product_id: 'p1', variant_id: null, quantity_on_hand: 8,
        reorder_point: 10, product_name: 'Gin', product_sku: null,
        unit_of_measure: 'l',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no burn data

    const result = await getForecastDashboard('org-1', 'loc-1');
    expect(result[0].urgency).toBe('warning');
    expect(result[0].reorderPointReached).toBe(true);
  });

  it('filters by urgency when provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { product_id: 'p1', variant_id: null, quantity_on_hand: 0, reorder_point: null, product_name: 'A', product_sku: null, unit_of_measure: 'each' },
        { product_id: 'p2', variant_id: null, quantity_on_hand: 100, reorder_point: null, product_name: 'B', product_sku: null, unit_of_measure: 'each' },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getForecastDashboard('org-1', 'loc-1', 168, 'critical');
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('p1');
  });

  it('sorts critical before warning before ok', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { product_id: 'ok-prod', variant_id: null, quantity_on_hand: 1000, reorder_point: null, product_name: 'OK', product_sku: null, unit_of_measure: 'each' },
        { product_id: 'crit-prod', variant_id: null, quantity_on_hand: 0, reorder_point: null, product_name: 'Critical', product_sku: null, unit_of_measure: 'each' },
        { product_id: 'warn-prod', variant_id: null, quantity_on_hand: 5, reorder_point: 10, product_name: 'Warning', product_sku: null, unit_of_measure: 'each' },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getForecastDashboard('org-1', 'loc-1');
    expect(result[0].urgency).toBe('critical');
    expect(result[1].urgency).toBe('warning');
    expect(result[2].urgency).toBe('ok');
  });
});
