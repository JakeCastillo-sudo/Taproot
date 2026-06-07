/**
 * Analytics service (S8-03) — advanced analytics beyond the basic report suite.
 *
 * All numbers deterministic SQL (pattern from reporting/intelligence services):
 *   - cohort retention      (customer signup month × active-month grid)
 *   - menu engineering      (popularity × margin quadrants, custom date range)
 *   - staff performance     (revenue / voids / tips per employee)
 *   - peak hours            (7×24 day-hour heatmap + peak/slow callouts)
 *   - customer insights     (new vs returning, churn risk, top customers)
 *
 * Money: cents everywhere (numeric columns hold cent values; Number() coerced).
 * hoursWorked/revenuePerHour are null — no time-clock table yet (documented).
 */

import { query } from '../db/client';

// ─── Shared helpers ───────────────────────────────────────────────────────────

export interface RangeParams {
  from: string;          // ISO-8601
  to: string;            // ISO-8601
  locationId?: string;
  timezone?: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

/** $3 = location_id (nullable) appended by callers using this WHERE fragment. */
const LOC_FILTER = `AND ($4::uuid IS NULL OR o.location_id = $4)`;

// ─── Cohort analysis ──────────────────────────────────────────────────────────

export interface CohortRow {
  month: string;                 // "2026-01"
  newCustomers: number;
  retention: { month1: number; month2: number; month3: number; month6: number };
}

export async function getCohortAnalysis(
  orgId: string,
  months: number,
  locationId?: string,
): Promise<{ cohorts: CohortRow[] }> {
  const m = Math.min(Math.max(Math.trunc(months) || 6, 1), 24);

  // Cohort sizes: customers by signup month
  const { rows: sizes } = await query<{ month: string; new_customers: string | number }>(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
            COUNT(*) AS new_customers
       FROM customers
      WHERE organization_id = $1 AND deleted_at IS NULL
        AND created_at >= date_trunc('month', NOW()) - ($2 || ' months')::interval
      GROUP BY 1 ORDER BY 1`,
    [orgId, String(m - 1)],
  );

  // Retention pairs: distinct customers active (completed order) K months after signup
  const { rows: pairs } = await query<{ month: string; mdiff: number; active: string | number }>(
    `SELECT to_char(date_trunc('month', cu.created_at), 'YYYY-MM') AS month,
            ((EXTRACT(YEAR FROM o.created_at) - EXTRACT(YEAR FROM cu.created_at)) * 12
              + (EXTRACT(MONTH FROM o.created_at) - EXTRACT(MONTH FROM cu.created_at)))::int AS mdiff,
            COUNT(DISTINCT o.customer_id) AS active
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id AND cu.deleted_at IS NULL
      WHERE o.organization_id = $1
        AND o.status = 'completed'
        AND cu.created_at >= date_trunc('month', NOW()) - ($2 || ' months')::interval
        AND ($3::uuid IS NULL OR o.location_id = $3)
      GROUP BY 1, 2`,
    [orgId, String(m - 1), locationId ?? null],
  );

  const byMonth = new Map<string, Map<number, number>>();
  for (const p of pairs) {
    if (!byMonth.has(p.month)) byMonth.set(p.month, new Map());
    byMonth.get(p.month)!.set(Number(p.mdiff), Number(p.active));
  }

  const cohorts: CohortRow[] = sizes.map((s) => {
    const size = Number(s.new_customers);
    const act = byMonth.get(s.month);
    const pct = (k: number) => (size > 0 && act?.get(k) ? Math.round((act.get(k)! / size) * 100) : 0);
    return {
      month: s.month,
      newCustomers: size,
      retention: { month1: pct(1), month2: pct(2), month3: pct(3), month6: pct(6) },
    };
  });

  return { cohorts };
}

// ─── Menu engineering matrix ──────────────────────────────────────────────────

export type Quadrant = 'star' | 'plow_horse' | 'puzzle' | 'dog';

export interface MenuItemAnalytics {
  productId: string;
  name: string;
  category: string;
  salesCount: number;
  revenue: number;        // cents
  foodCostPct: number;    // 0 when no cost data
  margin: number;         // cents (revenue − cost)
  quadrant: Quadrant;
  recommendation: string;
}

const QUADRANT_ACTIONS: Record<Quadrant, string> = {
  star:       'Keep it prominent — feature it on menus and upsell prompts.',
  plow_horse: 'Popular but thin margin — raise the price slightly or trim ingredient cost.',
  puzzle:     'Profitable but slow — promote it, reposition it, or bundle it with a star.',
  dog:        'Low sales, low margin — consider archiving or reworking the recipe.',
};

export async function getMenuEngineeringMatrix(
  orgId: string,
  range: RangeParams,
): Promise<{ items: MenuItemAnalytics[]; averagePopularity: number; averageMargin: number }> {
  const { rows } = await query<{
    product_id: string; name: string; category: string | null;
    units: string | number; revenue: string | number; cost: string | number;
  }>(
    `SELECT li.product_id,
            COALESCE(p.name, li.name) AS name,
            c.name AS category,
            SUM(li.quantity)::numeric AS units,
            SUM(li.total)::numeric AS revenue,
            SUM(li.cost_price * li.quantity)::numeric AS cost
       FROM order_line_items li
       JOIN orders o ON o.id = li.order_id
       LEFT JOIN products p ON p.id = li.product_id
       LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
      WHERE o.organization_id = $1
        AND o.status = 'completed'
        AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
        AND li.voided_at IS NULL
        ${LOC_FILTER}
      GROUP BY li.product_id, COALESCE(p.name, li.name), c.name`,
    [orgId, range.from, range.to, range.locationId ?? null],
  );

  if (!rows.length) return { items: [], averagePopularity: 0, averageMargin: 0 };

  const base = rows.map((r) => {
    const units = Number(r.units);
    const revenue = Number(r.revenue);
    const cost = Number(r.cost);
    const margin = revenue - cost;
    return {
      productId: r.product_id,
      name: r.name,
      category: r.category ?? 'Uncategorized',
      salesCount: Math.round(units),
      revenue,
      foodCostPct: revenue > 0 ? Math.round((cost / revenue) * 100) : 0,
      margin,
      marginPct: revenue > 0 ? margin / revenue : 0,
    };
  });

  const averagePopularity = base.reduce((s, i) => s + i.salesCount, 0) / base.length;
  const averageMarginPct = base.reduce((s, i) => s + i.marginPct, 0) / base.length;
  const averageMargin = base.reduce((s, i) => s + i.margin, 0) / base.length;

  const items: MenuItemAnalytics[] = base.map((i) => {
    const popular = i.salesCount >= averagePopularity;
    const profitable = i.marginPct >= averageMarginPct;
    const quadrant: Quadrant = popular
      ? (profitable ? 'star' : 'plow_horse')
      : (profitable ? 'puzzle' : 'dog');
    return {
      productId: i.productId,
      name: i.name,
      category: i.category,
      salesCount: i.salesCount,
      revenue: i.revenue,
      foodCostPct: i.foodCostPct,
      margin: i.margin,
      quadrant,
      recommendation: QUADRANT_ACTIONS[quadrant],
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return { items, averagePopularity: Math.round(averagePopularity), averageMargin: Math.round(averageMargin) };
}

// ─── Staff performance ────────────────────────────────────────────────────────

export interface StaffPerformanceRow {
  id: string;
  name: string;
  ordersProcessed: number;
  revenue: number;          // cents
  avgTicket: number;        // cents
  tipsEarned: number;       // cents
  voidCount: number;
  voidRate: number;         // %
  hoursWorked: number | null;     // null — no time-clock data yet
  revenuePerHour: number | null;  // null — no time-clock data yet
}

export async function getStaffPerformance(
  orgId: string,
  range: RangeParams,
): Promise<{ employees: StaffPerformanceRow[] }> {
  const { rows } = await query<{
    id: string; name: string;
    orders: string | number; revenue: string | number; tips: string | number; voids: string | number;
  }>(
    `SELECT e.id,
            e.first_name || ' ' || e.last_name AS name,
            COUNT(*) FILTER (WHERE o.status = 'completed') AS orders,
            COALESCE(SUM(o.total) FILTER (WHERE o.status = 'completed'), 0) AS revenue,
            COALESCE(SUM(o.tip_total) FILTER (WHERE o.status = 'completed'), 0) AS tips,
            COUNT(*) FILTER (WHERE o.status = 'voided') AS voids
       FROM orders o
       JOIN employees e ON e.id = o.employee_id
      WHERE o.organization_id = $1
        AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
        ${LOC_FILTER}
      GROUP BY e.id, e.first_name, e.last_name
      ORDER BY revenue DESC`,
    [orgId, range.from, range.to, range.locationId ?? null],
  );

  return {
    employees: rows.map((r) => {
      const orders = Number(r.orders);
      const revenue = Number(r.revenue);
      const voids = Number(r.voids);
      const processed = orders + voids;
      return {
        id: r.id,
        name: r.name,
        ordersProcessed: orders,
        revenue,
        avgTicket: orders > 0 ? Math.round(revenue / orders) : 0,
        tipsEarned: Number(r.tips),
        voidCount: voids,
        voidRate: processed > 0 ? Math.round((voids / processed) * 1000) / 10 : 0,
        hoursWorked: null,
        revenuePerHour: null,
      };
    }),
  };
}

// ─── Peak hours (7×24 heatmap) ────────────────────────────────────────────────

export interface PeakHourCell {
  dayOfWeek: number;   // 0 = Sunday
  hour: number;        // 0–23
  orderCount: number;
  revenue: number;     // cents
  intensity: number;   // 0–1 (revenue-normalized)
}

export interface PeakHoursResult {
  heatmap: PeakHourCell[];
  peakDay: string;
  peakHour: string;
  slowestDay: string;
  slowestHour: string;
}

export async function getPeakHours(orgId: string, range: RangeParams): Promise<PeakHoursResult> {
  const tz = range.timezone ?? 'UTC';
  const { rows } = await query<{ dow: number; hour: number; orders: string | number; revenue: string | number }>(
    `SELECT EXTRACT(DOW  FROM o.created_at AT TIME ZONE $5)::int AS dow,
            EXTRACT(HOUR FROM o.created_at AT TIME ZONE $5)::int AS hour,
            COUNT(*) AS orders,
            COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o
      WHERE o.organization_id = $1
        AND o.status = 'completed'
        AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
        ${LOC_FILTER}
      GROUP BY 1, 2`,
    [orgId, range.from, range.to, range.locationId ?? null, tz],
  );

  const byKey = new Map<string, { orders: number; revenue: number }>();
  for (const r of rows) byKey.set(`${r.dow}-${r.hour}`, { orders: Number(r.orders), revenue: Number(r.revenue) });
  const maxRevenue = Math.max(1, ...rows.map((r) => Number(r.revenue)));

  const heatmap: PeakHourCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = byKey.get(`${d}-${h}`);
      heatmap.push({
        dayOfWeek: d,
        hour: h,
        orderCount: cell?.orders ?? 0,
        revenue: cell?.revenue ?? 0,
        intensity: cell ? Math.round((cell.revenue / maxRevenue) * 100) / 100 : 0,
      });
    }
  }

  // Peak/slowest day (by total revenue) + hour (by total revenue across days)
  const dayTotals = Array.from({ length: 7 }, (_, d) =>
    heatmap.filter((c) => c.dayOfWeek === d).reduce((s, c) => s + c.revenue, 0));
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    heatmap.filter((c) => c.hour === h).reduce((s, c) => s + c.revenue, 0));

  const active = (arr: number[]) => arr.some((v) => v > 0);
  const peakDayIdx = dayTotals.indexOf(Math.max(...dayTotals));
  const peakHourIdx = hourTotals.indexOf(Math.max(...hourTotals));
  // slowest among periods that had ANY activity window (ignore totally-closed hours)
  const nonZeroDays = dayTotals.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
  const nonZeroHours = hourTotals.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
  const slowDayIdx = nonZeroDays.length ? nonZeroDays.reduce((a, b) => (b.v < a.v ? b : a)).i : 0;
  const slowHourIdx = nonZeroHours.length ? nonZeroHours.reduce((a, b) => (b.v < a.v ? b : a)).i : 0;

  return {
    heatmap,
    peakDay: active(dayTotals) ? DAY_NAMES[peakDayIdx] : '—',
    peakHour: active(hourTotals) ? hourLabel(peakHourIdx) : '—',
    slowestDay: active(dayTotals) ? DAY_NAMES[slowDayIdx] : '—',
    slowestHour: active(hourTotals) ? hourLabel(slowHourIdx) : '—',
  };
}

// ─── Customer insights ────────────────────────────────────────────────────────

export interface CustomerInsights {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  avgVisitsPerCustomer: number;
  avgLifetimeValue: number;   // cents
  churnRisk: Array<{ customerId: string; name: string; lastVisit: string; lifetimeValue: number }>;
  topCustomers: Array<{ customerId: string; name: string; visits: number; totalSpent: number; avgTicket: number }>;
}

export async function getCustomerInsights(orgId: string, range: RangeParams): Promise<CustomerInsights> {
  const loc = range.locationId ?? null;

  const { rows: [agg] } = await query<{
    total: string | number; new_count: string | number;
    avg_visits: string | number | null; avg_ltv: string | number | null;
  }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz) AS new_count,
            AVG(visit_count) AS avg_visits,
            AVG(total_spend) AS avg_ltv
       FROM customers
      WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId, range.from, range.to],
  );

  // Returning = customers who ordered in range AND had ordered before the range
  const { rows: [ret] } = await query<{ returning: string | number }>(
    `SELECT COUNT(DISTINCT o.customer_id) AS returning
       FROM orders o
      WHERE o.organization_id = $1 AND o.status = 'completed' AND o.customer_id IS NOT NULL
        AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
        ${LOC_FILTER}
        AND EXISTS (
          SELECT 1 FROM orders prev
           WHERE prev.customer_id = o.customer_id
             AND prev.organization_id = $1
             AND prev.status = 'completed'
             AND prev.created_at < $2::timestamptz
        )`,
    [orgId, range.from, range.to, loc],
  );

  const { rows: churn } = await query<{ id: string; name: string; last_visit: string; ltv: string | number }>(
    `SELECT id,
            COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email, phone, 'Customer') AS name,
            last_visit_at AS last_visit,
            total_spend AS ltv
       FROM customers
      WHERE organization_id = $1 AND deleted_at IS NULL
        AND last_visit_at IS NOT NULL
        AND last_visit_at < NOW() - INTERVAL '30 days'
      ORDER BY total_spend DESC
      LIMIT 10`,
    [orgId],
  );

  const { rows: top } = await query<{
    id: string; name: string; visits: string | number; spent: string | number;
  }>(
    `SELECT cu.id,
            COALESCE(NULLIF(TRIM(COALESCE(cu.first_name,'') || ' ' || COALESCE(cu.last_name,'')), ''), cu.email, cu.phone, 'Customer') AS name,
            COUNT(*) AS visits,
            COALESCE(SUM(o.total), 0) AS spent
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id AND cu.deleted_at IS NULL
      WHERE o.organization_id = $1 AND o.status = 'completed'
        AND o.created_at >= $2::timestamptz AND o.created_at < $3::timestamptz
        ${LOC_FILTER}
      GROUP BY cu.id, name
      ORDER BY spent DESC
      LIMIT 10`,
    [orgId, range.from, range.to, loc],
  );

  return {
    totalCustomers: Number(agg?.total ?? 0),
    newCustomers: Number(agg?.new_count ?? 0),
    returningCustomers: Number(ret?.returning ?? 0),
    avgVisitsPerCustomer: Math.round(Number(agg?.avg_visits ?? 0) * 10) / 10,
    avgLifetimeValue: Math.round(Number(agg?.avg_ltv ?? 0)),
    churnRisk: churn.map((c) => ({
      customerId: c.id, name: c.name,
      lastVisit: c.last_visit, lifetimeValue: Number(c.ltv),
    })),
    topCustomers: top.map((t) => {
      const visits = Number(t.visits);
      const spent = Number(t.spent);
      return {
        customerId: t.id, name: t.name, visits,
        totalSpent: spent,
        avgTicket: visits > 0 ? Math.round(spent / visits) : 0,
      };
    }),
  };
}
