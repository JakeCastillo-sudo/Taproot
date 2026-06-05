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

// ─── S5-02: AI Staff Scheduling ───────────────────────────────────────────────

const SHIFT_HOURS = 8;
const SALES_PER_STAFF_SHIFT = 90000;   // $900 in sales handled per staffer per shift
const DEFAULT_HOURLY_RATE_CENTS = 1500; // $15/hr fallback when no hourly_rate data
const LABOR_TARGET_PCT = 30;

export interface StaffingDay {
  date: string; dow: string; predictedSales: number; recommendedStaff: number;
  laborCostCents: number; laborPct: number; alert: boolean;
}
export interface StaffingPlan {
  days: StaffingDay[]; avgHourlyRateCents: number; targetPct: number;
  narrative: string; aiUsed: boolean;
}

async function avgHourlyRateCents(orgId: string): Promise<number> {
  try {
    const { rows } = await query<{ avg: string | null }>(
      `SELECT AVG(hourly_rate) AS avg FROM employees
        WHERE organization_id = $1 AND deleted_at IS NULL AND hourly_rate IS NOT NULL AND hourly_rate > 0`,
      [orgId],
    );
    const dollars = Number(rows[0]?.avg ?? 0);
    return dollars > 0 ? Math.round(dollars * 100) : DEFAULT_HOURLY_RATE_CENTS;
  } catch {
    return DEFAULT_HOURLY_RATE_CENTS; // hourly_rate column may not be migrated yet
  }
}

export async function getStaffingPlan(orgId: string, locationId: string | undefined, timezone = 'UTC'): Promise<StaffingPlan> {
  const forecast = await getDemandForecast(orgId, locationId, timezone);
  const rate = await avgHourlyRateCents(orgId);

  const days: StaffingDay[] = forecast.forecast.map((f) => {
    const recommendedStaff = Math.max(2, Math.ceil(f.predictedSales / SALES_PER_STAFF_SHIFT));
    const laborCostCents = recommendedStaff * SHIFT_HOURS * rate;
    const laborPct = f.predictedSales > 0 ? (laborCostCents / f.predictedSales) * 100 : 0;
    return {
      date: f.date, dow: f.dow, predictedSales: f.predictedSales,
      recommendedStaff, laborCostCents, laborPct: Math.round(laborPct * 10) / 10,
      alert: laborPct > LABOR_TARGET_PCT,
    };
  });

  const flagged = days.filter((d) => d.alert);
  let narrative = flagged.length
    ? `${flagged.length} day(s) project labor above the ${LABOR_TARGET_PCT}% target — consider trimming a shift on ${flagged.map((d) => d.dow).join(', ')}.`
    : `Staffing looks balanced — projected labor stays under the ${LABOR_TARGET_PCT}% target all week.`;
  let aiUsed = false;

  if (aiAvailable()) {
    const ai = await askClaudeText(
      `You are a restaurant scheduling assistant. Given a 7-day staffing plan with predicted sales (cents), recommended staff, and labor %, write 2 short sentences with one concrete scheduling action. Labor target is ${LABOR_TARGET_PCT}%. No preamble.`,
      JSON.stringify(days),
      256,
    );
    if (ai) { narrative = ai; aiUsed = true; }
  }

  return { days, avgHourlyRateCents: rate, targetPct: LABOR_TARGET_PCT, narrative, aiUsed };
}
