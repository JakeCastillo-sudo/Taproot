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

// ─── S5-03: Menu Engineering ──────────────────────────────────────────────────

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';
const MENU_ACTION: Record<MenuClass, string> = {
  star:      'Feature prominently and protect quality — your winners.',
  plowhorse: 'Popular but thin margin — nudge price up or trim cost.',
  puzzle:    'High margin, low sales — promote or reposition on the menu.',
  dog:       'Low sales, low margin — consider reworking or removing.',
};

export interface MenuItem {
  id: string; name: string; units: number; revenue: number;
  marginPct: number; category: MenuClass; action: string;
}
export interface MenuEngineering {
  items: MenuItem[];
  counts: Record<MenuClass, number>;
  periodDays: number; narrative: string; aiUsed: boolean;
}

export async function getMenuEngineering(orgId: string, locationId: string | undefined, days = 90): Promise<MenuEngineering> {
  const params: unknown[] = [orgId];
  const lc = locClause(locationId, params);
  const { rows } = await query<{ id: string; name: string; cost_price: number; units: number; revenue: number; avg_price: number }>(
    `SELECT p.id, p.name, p.cost_price,
            SUM(li.quantity) AS units, SUM(li.total) AS revenue, AVG(li.unit_price) AS avg_price
       FROM order_line_items li
       JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
       JOIN products p ON p.id = li.product_id
      WHERE o.organization_id = $1 AND li.voided_at IS NULL
        AND o.created_at >= now() - ($${params.length + 1} || ' days')::interval ${lc}
      GROUP BY p.id, p.name, p.cost_price
      HAVING SUM(li.quantity) > 0`,
    [...params, String(days)],
  );

  const enriched = rows.map((r) => {
    const avgPrice = Number(r.avg_price) || 0;
    const cost = Number(r.cost_price) || 0;
    const marginPct = avgPrice > 0 ? ((avgPrice - cost) / avgPrice) * 100 : 0;
    return { id: r.id, name: r.name, units: Number(r.units), revenue: Math.round(Number(r.revenue)), marginPct: Math.round(marginPct * 10) / 10 };
  });

  const avgUnits = enriched.length ? enriched.reduce((s, x) => s + x.units, 0) / enriched.length : 0;
  const avgMargin = enriched.length ? enriched.reduce((s, x) => s + x.marginPct, 0) / enriched.length : 0;

  const classify = (popular: boolean, profitable: boolean): MenuClass =>
    popular && profitable ? 'star' : popular ? 'plowhorse' : profitable ? 'puzzle' : 'dog';

  const items: MenuItem[] = enriched.map((x) => {
    const category = classify(x.units >= avgUnits, x.marginPct >= avgMargin);
    return { ...x, category, action: MENU_ACTION[category] };
  }).sort((a, b) => b.revenue - a.revenue);

  const counts: Record<MenuClass, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
  for (const it of items) counts[it.category]++;

  let narrative = items.length
    ? `${counts.star} stars carry the menu; ${counts.dog} dogs are dragging it. Focus on converting plowhorses (${counts.plowhorse}) and promoting puzzles (${counts.puzzle}).`
    : 'Not enough sales history to engineer the menu yet.';
  let aiUsed = false;

  if (aiAvailable() && items.length >= 4) {
    const ai = await askClaudeText(
      'You are a menu-engineering consultant using the Stars/Plowhorses/Puzzles/Dogs framework. Given classified items (units, marginPct, category), write 2 sentences naming 1-2 specific items and a concrete action. No preamble.',
      JSON.stringify(items.slice(0, 25)),
      300,
    );
    if (ai) { narrative = ai; aiUsed = true; }
  }

  return { items, counts, periodDays: days, narrative, aiUsed };
}

// ─── S5-04: Food Cost Intelligence ────────────────────────────────────────────

const FOOD_COST_TARGET_PCT = 33;

export interface FoodCostItem { name: string; revenue: number; cogs: number; foodCostPct: number; flagged: boolean }
export interface ReorderSuggestion { productId: string; name: string; onHand: number; reorderPoint: number; suggestedQty: number }
export interface FoodCostIntelligence {
  foodCostPct: number; revenue: number; cogs: number; targetPct: number;
  byItem: FoodCostItem[]; reorderSuggestions: ReorderSuggestion[];
  narrative: string; aiUsed: boolean; periodDays: number;
}

async function resolveLocation(orgId: string, locationId?: string): Promise<string | null> {
  if (locationId) return locationId;
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM locations WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`, [orgId]);
  return rows[0]?.id ?? null;
}

export async function getFoodCostIntelligence(orgId: string, locationId: string | undefined, days = 30): Promise<FoodCostIntelligence> {
  // Overall + per-item food cost
  const params: unknown[] = [orgId];
  const lc = locClause(locationId, params);
  const periodIdx = params.length + 1;

  const [totals, byItemRows] = await Promise.all([
    query<{ revenue: string; cogs: string }>(
      `SELECT COALESCE(SUM(li.total),0) AS revenue, COALESCE(SUM(li.cost_price * li.quantity),0) AS cogs
         FROM order_line_items li
         JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
        WHERE o.organization_id = $1 AND li.voided_at IS NULL
          AND o.created_at >= now() - ($${periodIdx} || ' days')::interval ${lc}`,
      [...params, String(days)],
    ),
    query<{ name: string; revenue: string; cogs: string }>(
      `SELECT p.name, SUM(li.total) AS revenue, SUM(li.cost_price * li.quantity) AS cogs
         FROM order_line_items li
         JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
         JOIN products p ON p.id = li.product_id
        WHERE o.organization_id = $1 AND li.voided_at IS NULL
          AND o.created_at >= now() - ($${periodIdx} || ' days')::interval ${lc}
        GROUP BY p.name HAVING SUM(li.total) > 0
        ORDER BY SUM(li.cost_price * li.quantity) DESC LIMIT 20`,
      [...params, String(days)],
    ),
  ]);

  const revenue = Math.round(Number(totals.rows[0]?.revenue ?? 0));
  const cogs = Math.round(Number(totals.rows[0]?.cogs ?? 0));
  const foodCostPct = revenue > 0 ? Math.round((cogs / revenue) * 1000) / 10 : 0;

  const byItem: FoodCostItem[] = byItemRows.rows.map((r) => {
    const rev = Math.round(Number(r.revenue)); const c = Math.round(Number(r.cogs));
    const pct = rev > 0 ? Math.round((c / rev) * 1000) / 10 : 0;
    return { name: r.name, revenue: rev, cogs: c, foodCostPct: pct, flagged: pct > FOOD_COST_TARGET_PCT };
  });

  // Reorder suggestions (auto-PO draft) from inventory below reorder point
  const loc = await resolveLocation(orgId, locationId);
  let reorderSuggestions: ReorderSuggestion[] = [];
  if (loc) {
    const { rows } = await query<{ product_id: string; name: string; on_hand: number; reorder_point: number; reorder_quantity: number | null }>(
      `SELECT il.product_id, p.name, il.quantity_on_hand AS on_hand, il.reorder_point, il.reorder_quantity
         FROM inventory_levels il JOIN products p ON p.id = il.product_id
        WHERE il.organization_id = $1 AND il.location_id = $2 AND p.deleted_at IS NULL
          AND il.reorder_point IS NOT NULL AND il.reorder_point > 0
          AND il.quantity_on_hand <= il.reorder_point
        ORDER BY (il.reorder_point - il.quantity_on_hand) DESC LIMIT 20`,
      [orgId, loc],
    );
    reorderSuggestions = rows.map((r) => ({
      productId: r.product_id, name: r.name,
      onHand: Math.round(Number(r.on_hand)), reorderPoint: Math.round(Number(r.reorder_point)),
      suggestedQty: Math.max(1, Math.round(Number(r.reorder_quantity ?? (Number(r.reorder_point) - Number(r.on_hand))))),
    }));
  }

  let narrative = revenue > 0
    ? `Food cost is ${foodCostPct}% vs a ${FOOD_COST_TARGET_PCT}% target. ${byItem.filter((i) => i.flagged).length} item(s) run high; ${reorderSuggestions.length} item(s) need reordering.`
    : 'Not enough sales with cost data to compute food cost yet.';
  let aiUsed = false;

  if (aiAvailable() && revenue > 0) {
    const ai = await askClaudeText(
      `You are a restaurant food-cost analyst. Target food cost is ${FOOD_COST_TARGET_PCT}%. Given overall food cost %, high-cost items, and reorder suggestions, write 2 sentences with one concrete cost-saving action. No preamble.`,
      JSON.stringify({ foodCostPct, flagged: byItem.filter((i) => i.flagged).slice(0, 10), reorder: reorderSuggestions.slice(0, 10) }),
      300,
    );
    if (ai) { narrative = ai; aiUsed = true; }
  }

  return { foodCostPct, revenue, cogs, targetPct: FOOD_COST_TARGET_PCT, byItem, reorderSuggestions, narrative, aiUsed, periodDays: days };
}

// ─── S5-05: Daily Intelligence Feed ───────────────────────────────────────────

export interface FeedAlert { type: string; severity: 'info' | 'warning' | 'critical'; message: string }
export interface DailyFeed {
  date: string;
  yesterday: { sales: number; orders: number; avgTicket: number; topItem: string | null };
  alerts: FeedAlert[];
  briefing: string;
  aiUsed: boolean;
}

export async function getDailyFeed(orgId: string, locationId: string | undefined, timezone = 'UTC'): Promise<DailyFeed> {
  const params: unknown[] = [orgId, timezone];
  const lc = locClause(locationId, params);
  // Yesterday (local day window)
  const { rows: [y] } = await query<{ sales: string; orders: string; avg: string }>(
    `SELECT COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END),0) AS sales,
            COUNT(*) FILTER (WHERE o.status NOT IN ('voided','parked')) AS orders,
            COALESCE(AVG(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total END),0) AS avg
       FROM orders o
      WHERE o.organization_id = $1
        AND o.created_at >= (date_trunc('day', now() AT TIME ZONE $2) - interval '1 day') AT TIME ZONE $2
        AND o.created_at <  date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2 ${lc}`,
    params,
  );
  const { rows: [top] } = await query<{ name: string }>(
    `SELECT li.name FROM order_line_items li
       JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
      WHERE o.organization_id = $1 AND li.voided_at IS NULL
        AND o.created_at >= (date_trunc('day', now() AT TIME ZONE $2) - interval '1 day') AT TIME ZONE $2
        AND o.created_at <  date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2 ${lc}
      GROUP BY li.name ORDER BY SUM(li.quantity) DESC LIMIT 1`,
    params,
  );

  const yesterday = {
    sales: Math.round(Number(y?.sales ?? 0)),
    orders: Number(y?.orders ?? 0),
    avgTicket: Math.round(Number(y?.avg ?? 0)),
    topItem: top?.name ?? null,
  };

  // Alerts from the other intelligence functions
  const alerts: FeedAlert[] = [];
  const [foodCost, staffing] = await Promise.all([
    getFoodCostIntelligence(orgId, locationId, 7),
    getStaffingPlan(orgId, locationId, timezone),
  ]);
  if (foodCost.revenue > 0 && foodCost.foodCostPct > foodCost.targetPct) {
    alerts.push({ type: 'food_cost', severity: 'warning', message: `Food cost is ${foodCost.foodCostPct}% (target ${foodCost.targetPct}%).` });
  }
  if (foodCost.reorderSuggestions.length > 0) {
    alerts.push({ type: 'reorder', severity: 'info', message: `${foodCost.reorderSuggestions.length} item(s) at or below reorder point.` });
  }
  const todayDow = DOW_NAMES[new Date().getDay()];
  const todayPlan = staffing.days.find((d) => d.dow === todayDow);
  if (todayPlan?.alert) {
    alerts.push({ type: 'labor', severity: 'warning', message: `Today's projected labor is ${todayPlan.laborPct}% (target ${staffing.targetPct}%).` });
  }
  if (yesterday.orders === 0) {
    alerts.push({ type: 'no_sales', severity: 'info', message: 'No recorded sales yesterday.' });
  }

  let briefing = `Yesterday: ${yesterday.orders} orders for $${(yesterday.sales / 100).toFixed(0)}${yesterday.topItem ? `, top seller "${yesterday.topItem}"` : ''}. ${alerts.length} alert(s) need attention today.`;
  let aiUsed = false;
  if (aiAvailable()) {
    const ai = await askClaudeText(
      'You are a restaurant GM assistant writing a brief morning briefing (3 sentences max). Summarize yesterday and call out the most important action for today. Friendly, concrete, no preamble.',
      JSON.stringify({ yesterday, alerts }),
      300,
    );
    if (ai) { briefing = ai; aiUsed = true; }
  }

  return { date: new Date().toISOString().slice(0, 10), yesterday, alerts, briefing, aiUsed };
}
