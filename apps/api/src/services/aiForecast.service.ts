/**
 * aiForecast.service — single-date AI demand forecast (S9-01).
 *
 * Deeper than intelligence.getDemandForecast (S5-01's 7-day strip): for one
 * target date it predicts a revenue RANGE, order count, per-item quantities,
 * and a prep checklist — Claude does the synthesis over 90 days of history,
 * with a pure-statistical fallback when the API is unavailable (confidence
 * 0.5, "Statistical estimate" note). Cached 4h per org/location/date.
 *
 * (NOTE: services/forecast.service.ts is the Prompt-04 INVENTORY forecaster —
 * different concern, hence this file's name.)
 */

import { query } from '../db/client';
import { askClaudeJSON, aiAvailable, cacheGet, cacheSet } from './ai.service';
import { ValidationError } from '../errors';

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface ForecastResult {
  date: string;
  dayOfWeek: string;
  predictedRevenue: { low: number; mid: number; high: number };  // cents
  predictedOrders: number;
  predictedTopItems: Array<{ name: string; predictedQuantity: number }>;
  prepRecommendations: string[];
  confidence: number;        // 0-1
  basedOnDays: number;       // days of history backing the forecast
  aiUsed: boolean;
  note: string | null;       // e.g. "Statistical estimate" on fallback
  generatedAt: string;
}

interface DowStats {
  avgRevenue: number;        // cents
  avgOrders: number;
  samples: number;
  topItems: Array<{ name: string; avgQuantity: number }>;
}

// ─── History assembly ─────────────────────────────────────────────────────────

async function buildSalesContext(orgId: string, locationId: string | undefined, timezone: string) {
  const params: unknown[] = [orgId, timezone];
  let lc = '';
  if (locationId) { params.push(locationId); lc = `AND o.location_id = $${params.length}`; }

  // Daily revenue/orders by DOW (last 90 days)
  const { rows: days } = await query<{ day: string; dow: number; sales: string; orders: string }>(
    `SELECT to_char(o.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
            EXTRACT(DOW FROM o.created_at AT TIME ZONE $2)::int AS dow,
            COALESCE(SUM(o.total) FILTER (WHERE o.status NOT IN ('voided','parked')), 0) AS sales,
            COUNT(*) FILTER (WHERE o.status NOT IN ('voided','parked')) AS orders
       FROM orders o
      WHERE o.organization_id = $1 AND o.created_at >= now() - interval '90 days' ${lc}
      GROUP BY day, dow ORDER BY day ASC`,
    params,
  );

  // Top items per DOW (avg units on days of that DOW)
  const { rows: itemRows } = await query<{ dow: number; name: string; total_units: string; day_count: string }>(
    `SELECT EXTRACT(DOW FROM o.created_at AT TIME ZONE $2)::int AS dow,
            li.name,
            SUM(li.quantity) AS total_units,
            COUNT(DISTINCT to_char(o.created_at AT TIME ZONE $2, 'YYYY-MM-DD')) AS day_count
       FROM order_line_items li
       JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
      WHERE o.organization_id = $1 AND li.voided_at IS NULL
        AND o.created_at >= now() - interval '90 days' ${lc}
      GROUP BY dow, li.name`,
    params,
  );

  // Assemble per-DOW stats
  const byDow = new Map<number, { sales: number[]; orders: number[] }>();
  for (const d of days) {
    const e = byDow.get(d.dow) ?? { sales: [], orders: [] };
    e.sales.push(Math.round(Number(d.sales)));
    e.orders.push(Number(d.orders));
    byDow.set(d.dow, e);
  }

  const itemsByDow = new Map<number, Array<{ name: string; avgQuantity: number }>>();
  // days of that DOW with any sales (denominator for avg units/day)
  const dowDayCounts = new Map<number, number>();
  for (const d of days) dowDayCounts.set(d.dow, (dowDayCounts.get(d.dow) ?? 0) + 1);
  for (const r of itemRows) {
    const denom = dowDayCounts.get(r.dow) || 1;
    const list = itemsByDow.get(r.dow) ?? [];
    list.push({ name: r.name, avgQuantity: Math.round((Number(r.total_units) / denom) * 10) / 10 });
    itemsByDow.set(r.dow, list);
  }
  for (const [dow, list] of itemsByDow) {
    itemsByDow.set(dow, list.sort((a, b) => b.avgQuantity - a.avgQuantity).slice(0, 10));
  }

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  const stats: Record<string, DowStats> = {};
  for (let dow = 0; dow < 7; dow++) {
    const e = byDow.get(dow);
    stats[DOW_FULL[dow]] = {
      avgRevenue: avg(e?.sales ?? []),
      avgOrders: avg(e?.orders ?? []),
      samples: e?.sales.length ?? 0,
      topItems: itemsByDow.get(dow) ?? [],
    };
  }

  // Recent trend
  const last7 = days.slice(-7).map((d) => Math.round(Number(d.sales)));
  const last30 = days.slice(-30).map((d) => Math.round(Number(d.sales)));
  const a7 = avg(last7); const a30 = avg(last30);
  const trend = a30 === 0 ? 'flat' : a7 > a30 * 1.08 ? 'up' : a7 < a30 * 0.92 ? 'down' : 'flat';

  return {
    historicalByDayOfWeek: stats,
    recentTrend: { last7Days: a7, last30Days: a30, trend },
    daysOfHistory: days.length,
  };
}

// ─── Statistical fallback ─────────────────────────────────────────────────────

function statisticalForecast(
  targetDate: string,
  dayOfWeek: string,
  dowStats: DowStats,
  basedOnDays: number,
): ForecastResult {
  const mid = dowStats.avgRevenue;
  const topItems = dowStats.topItems.slice(0, 5).map((t) => ({
    name: t.name,
    predictedQuantity: Math.max(1, Math.round(t.avgQuantity)),
  }));
  const prep = topItems.slice(0, 3).map((t) =>
    `Prep for ~${t.predictedQuantity} × ${t.name} (avg on ${dayOfWeek}s)`);
  if (dowStats.avgOrders > 0) prep.push(`Expect roughly ${dowStats.avgOrders} orders — staff accordingly`);

  return {
    date: targetDate,
    dayOfWeek,
    predictedRevenue: { low: Math.round(mid * 0.8), mid, high: Math.round(mid * 1.2) },
    predictedOrders: dowStats.avgOrders,
    predictedTopItems: topItems,
    prepRecommendations: prep.length ? prep : ['Not enough history yet — keep ringing up sales to unlock forecasts.'],
    confidence: Math.min(0.5, dowStats.samples / 12),
    basedOnDays,
    aiUsed: false,
    note: 'Statistical estimate',
    generatedAt: new Date().toISOString(),
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

interface ClaudeForecastShape {
  predictedRevenue?: { low?: number; mid?: number; high?: number };
  predictedOrders?: number;
  predictedTopItems?: Array<{ name?: string; predictedQuantity?: number }>;
  prepRecommendations?: string[];
  confidence?: number;
}

export async function getForecast(
  orgId: string,
  locationId: string | undefined,
  targetDate: string,
  timezone = 'UTC',
): Promise<ForecastResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new ValidationError('date must be YYYY-MM-DD');
  }

  const cacheKey = `ai:forecast:${orgId}:${locationId ?? 'all'}:${targetDate}`;
  const cached = await cacheGet<ForecastResult>(cacheKey);
  if (cached) return cached;

  const dayOfWeek = DOW_FULL[new Date(`${targetDate}T12:00:00Z`).getUTCDay()];
  const ctx = await buildSalesContext(orgId, locationId, timezone);
  const dowStats = ctx.historicalByDayOfWeek[dayOfWeek];

  const fallback = statisticalForecast(targetDate, dayOfWeek, dowStats, ctx.daysOfHistory);

  // Not enough signal for the model to add value → fast statistical path
  if (!aiAvailable() || ctx.daysOfHistory < 7) {
    await cacheSet(cacheKey, fallback, 4 * 60 * 60);
    return fallback;
  }

  const salesContext = { targetDate, targetDayOfWeek: dayOfWeek, ...ctx };
  const ai = await askClaudeJSON<ClaudeForecastShape>(
    'You are a restaurant analytics expert. Given historical sales data, predict the target date\'s performance. Be specific and actionable. Return ONLY valid JSON.',
    `Here is sales history for this restaurant (all revenue values in CENTS):
${JSON.stringify(salesContext)}

Predict for ${targetDate} (${dayOfWeek}).
Return JSON matching this exact shape:
{
  "predictedRevenue": { "low": number, "mid": number, "high": number },
  "predictedOrders": number,
  "predictedTopItems": [{ "name": string, "predictedQuantity": number }],
  "prepRecommendations": [string],
  "confidence": number
}

Rules:
- All revenue values in cents.
- predictedTopItems: up to 5 items, only names that appear in the history.
- prepRecommendations: 3-5 specific actionable items, e.g. "Prep 40 burger patties (38 avg on Saturdays)".
- confidence: 0.0-1.0 based on data quantity/consistency (${ctx.daysOfHistory} days of history).`,
    1024,
  );

  // Validate shape — every field falls back to the statistical value
  const valid = ai && ai.predictedRevenue && typeof ai.predictedRevenue.mid === 'number';
  const result: ForecastResult = valid
    ? {
        date: targetDate,
        dayOfWeek,
        predictedRevenue: {
          low:  Math.max(0, Math.round(ai.predictedRevenue?.low  ?? fallback.predictedRevenue.low)),
          mid:  Math.max(0, Math.round(ai.predictedRevenue?.mid  ?? fallback.predictedRevenue.mid)),
          high: Math.max(0, Math.round(ai.predictedRevenue?.high ?? fallback.predictedRevenue.high)),
        },
        predictedOrders: Math.max(0, Math.round(ai.predictedOrders ?? fallback.predictedOrders)),
        predictedTopItems: (ai.predictedTopItems ?? [])
          .filter((t): t is { name: string; predictedQuantity: number } =>
            typeof t?.name === 'string' && typeof t?.predictedQuantity === 'number')
          .slice(0, 5)
          .map((t) => ({ name: t.name, predictedQuantity: Math.max(0, Math.round(t.predictedQuantity)) })),
        prepRecommendations: (ai.prepRecommendations ?? [])
          .filter((s): s is string => typeof s === 'string').slice(0, 5),
        confidence: Math.min(1, Math.max(0, Number(ai.confidence ?? 0.6))),
        basedOnDays: ctx.daysOfHistory,
        aiUsed: true,
        note: null,
        generatedAt: new Date().toISOString(),
      }
    : fallback;

  // Don't return an AI result with empty essentials
  if (result.aiUsed && (!result.predictedTopItems.length || !result.prepRecommendations.length)) {
    result.predictedTopItems = result.predictedTopItems.length ? result.predictedTopItems : fallback.predictedTopItems;
    result.prepRecommendations = result.prepRecommendations.length ? result.prepRecommendations : fallback.prepRecommendations;
  }

  await cacheSet(cacheKey, result, 4 * 60 * 60);
  return result;
}
