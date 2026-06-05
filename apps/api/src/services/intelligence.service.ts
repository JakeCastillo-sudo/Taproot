/**
 * intelligence.service — AI Intelligence layer (Sprint 5).
 *
 * Every function computes deterministic numbers from SQL, then optionally adds a
 * Claude-generated narrative/recommendation. Results degrade gracefully when the
 * Anthropic key is absent (aiUsed=false). Expensive results are cached in Redis.
 */

import { query } from '../db/client';
import { askClaudeJSON, askClaudeText, aiAvailable, cacheGet, cacheSet } from './ai.service';

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function locClause(locationId: string | undefined, params: unknown[], col = 'o.location_id'): string {
  if (!locationId) return '';
  params.push(locationId);
  return `AND ${col} = $${params.length}`;
}

// ─── S5-01: Demand Forecasting ────────────────────────────────────────────────

export interface ForecastDay { date: string; dow: string; predictedSales: number; predictedOrders: number; confidence: 'high' | 'medium' | 'low' }
export interface DemandForecast {
  history: Array<{ day: string; sales: number; orders: number }>;
  forecast: ForecastDay[];
  narrative: string;
  aiUsed: boolean;
  generatedAt: string;
}

export async function getDemandForecast(orgId: string, locationId: string | undefined, timezone = 'UTC'): Promise<DemandForecast> {
  const cacheKey = `intel:forecast:${orgId}:${locationId ?? 'all'}:${timezone}`;
  const cached = await cacheGet<DemandForecast>(cacheKey);
  if (cached) return cached;

  const params: unknown[] = [orgId, timezone];
  const lc = locClause(locationId, params);
  const { rows } = await query<{ day: string; dow: number; sales: number; orders: number }>(
    `SELECT to_char(o.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
            EXTRACT(DOW FROM o.created_at AT TIME ZONE $2)::int AS dow,
            COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END),0) AS sales,
            COUNT(*) FILTER (WHERE o.status NOT IN ('voided','parked')) AS orders
       FROM orders o
      WHERE o.organization_id = $1 AND o.created_at >= now() - interval '56 days' ${lc}
      GROUP BY day, dow ORDER BY day ASC`,
    params,
  );

  const history = rows.map((r) => ({ day: r.day, sales: Math.round(Number(r.sales)), orders: Number(r.orders) }));

  // Deterministic forecast: average of historical same-day-of-week values (recent-weighted).
  const byDow = new Map<number, { sales: number[]; orders: number[] }>();
  for (const r of rows) {
    const e = byDow.get(r.dow) ?? { sales: [], orders: [] };
    e.sales.push(Math.round(Number(r.sales)));
    e.orders.push(Number(r.orders));
    byDow.set(r.dow, e);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);

  const forecast: ForecastDay[] = [];
  const today = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const dow = d.getDay();
    const e = byDow.get(dow);
    const n = e?.sales.length ?? 0;
    forecast.push({
      date: d.toISOString().slice(0, 10),
      dow: DOW_NAMES[dow],
      predictedSales: avg(e?.sales ?? []),
      predictedOrders: avg(e?.orders ?? []),
      confidence: n >= 6 ? 'high' : n >= 3 ? 'medium' : 'low',
    });
  }

  let narrative = forecast.length
    ? `Next 7 days project ~$${(forecast.reduce((s, f) => s + f.predictedSales, 0) / 100).toFixed(0)} in sales, peaking ${forecast.reduce((a, b) => b.predictedSales > a.predictedSales ? b : a).dow}.`
    : 'Not enough history yet to forecast — keep ringing up sales.';
  let aiUsed = false;

  if (aiAvailable() && history.length >= 7) {
    const ai = await askClaudeText(
      'You are a restaurant analytics assistant. Given historical daily sales (in cents) and a 7-day forecast, write 2 concise sentences highlighting the trend and the busiest upcoming day. No preamble.',
      `History (last days): ${JSON.stringify(history.slice(-21))}\nForecast: ${JSON.stringify(forecast)}`,
      256,
    );
    if (ai) { narrative = ai; aiUsed = true; }
  }

  const result: DemandForecast = { history, forecast, narrative, aiUsed, generatedAt: new Date().toISOString() };
  await cacheSet(cacheKey, result, 4 * 60 * 60); // 4 hours
  return result;
}
