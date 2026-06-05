/**
 * Reporting service — analytics queries for the Taproot dashboard.
 *
 * All queries are read-only and use the indexes added in migration 006.
 * Every function accepts a date range (from/to as ISO-8601 strings) and
 * an optional locationId to scope results to a single location.
 *
 * Design notes
 * ────────────
 * - All monetary values are returned in the same unit as the DB (decimal,
 *   numeric(12,4)). Callers format for display.
 * - `granularity` for date_trunc: 'hour' | 'day' | 'week' | 'month'
 * - Timezone-aware: queries use AT TIME ZONE when a timezone string is passed,
 *   otherwise UTC. Default: 'UTC'.
 * - Voided orders are excluded from all sales figures.
 */

import { query } from '../db/client';
import type {
  SalesSummaryRow,
  TopProductRow,
  TopCustomerRow,
  PaymentMethodRow,
  EmployeePerformanceRow,
  HourlyHeatmapRow,
  DashboardMetrics,
  ReportGranularity,
} from '@taproot/shared';

// ─── Common param type ────────────────────────────────────────────────────────

export interface DateRangeParams {
  from:        string;   // ISO-8601
  to:          string;   // ISO-8601
  locationId?: string;
  timezone?:   string;   // IANA e.g. 'America/New_York' — default 'UTC'
}

// ─── getSalesSummary ──────────────────────────────────────────────────────────

/**
 * Aggregate sales by time period.
 * Returns one row per granularity bucket within [from, to].
 */
export async function getSalesSummary(
  orgId:       string,
  params:      DateRangeParams,
  granularity: ReportGranularity = 'day',
): Promise<SalesSummaryRow[]> {
  const tz      = params.timezone ?? 'UTC';
  const bindings: unknown[] = [orgId, params.from, params.to];
  const locationClause = params.locationId
    ? (bindings.push(params.locationId), `AND o.location_id = $${bindings.length}`)
    : '';

  const { rows } = await query<SalesSummaryRow>(
    `SELECT
       date_trunc(${'$' + (bindings.push(granularity) && bindings.length)},
                  o.created_at AT TIME ZONE ${'$' + (bindings.push(tz) && bindings.length)})
                  AS period,
       COUNT(*)                                              AS order_count,
       COALESCE(SUM(o.total),            0)                 AS gross_sales,
       COALESCE(SUM(o.discount_total),   0)                 AS discounts,
       COALESCE(SUM(o.total - o.discount_total), 0)         AS net_sales,
       COALESCE(SUM(o.tax_total),        0)                 AS tax,
       COALESCE(SUM(o.tip_total),        0)                 AS tips,
       COALESCE(SUM(
         CASE WHEN o.status IN ('refunded','partially_refunded')
              THEN o.amount_paid ELSE 0 END
       ), 0)                                                AS refunds
     FROM orders o
     WHERE o.organization_id = $1
       AND o.created_at >= $2
       AND o.created_at <  $3
       AND o.status NOT IN ('voided','parked')
       ${locationClause}
     GROUP BY 1
     ORDER BY 1`,
    bindings,
  );

  return rows;
}

// ─── getTopProducts ───────────────────────────────────────────────────────────

export async function getTopProducts(
  orgId:   string,
  params:  DateRangeParams,
  limit  = 20,
): Promise<TopProductRow[]> {
  const bindings: unknown[] = [orgId, params.from, params.to];
  const locationClause = params.locationId
    ? (bindings.push(params.locationId), `AND o.location_id = $${bindings.length}`)
    : '';
  bindings.push(limit);

  const { rows } = await query<TopProductRow>(
    `SELECT
       li.product_id,
       p.name                                    AS product_name,
       pv.name                                   AS variant_name,
       SUM(li.quantity)::numeric                 AS qty_sold,
       SUM(li.total)                             AS gross_sales,
       COUNT(DISTINCT o.id)                      AS order_count
     FROM order_line_items li
     JOIN orders o  ON o.id  = li.order_id
     JOIN products p ON p.id = li.product_id
     LEFT JOIN product_variants pv ON pv.id = li.variant_id
     WHERE o.organization_id = $1
       AND o.created_at >= $2
       AND o.created_at <  $3
       AND o.status NOT IN ('voided','parked')
       AND li.voided_at IS NULL
       ${locationClause}
     GROUP BY li.product_id, p.name, li.variant_id, pv.name
     ORDER BY gross_sales DESC
     LIMIT $${bindings.length}`,
    bindings,
  );

  return rows;
}

// ─── getTopCustomers ──────────────────────────────────────────────────────────

export async function getTopCustomers(
  orgId:   string,
  params:  Omit<DateRangeParams, 'locationId'>,
  limit  = 20,
): Promise<TopCustomerRow[]> {
  const bindings: unknown[] = [orgId, params.from, params.to, limit];

  const { rows } = await query<TopCustomerRow>(
    `SELECT
       c.id                                   AS customer_id,
       COALESCE(c.first_name,'') || ' ' ||
         COALESCE(c.last_name,'')             AS customer_name,
       c.email,
       COUNT(DISTINCT o.id)                   AS order_count,
       SUM(o.total)                           AS total_spend,
       c.loyalty_points,
       c.loyalty_tier
     FROM customers c
     JOIN orders o ON o.customer_id = c.id
     WHERE c.organization_id = $1
       AND o.created_at >= $2
       AND o.created_at <  $3
       AND o.status NOT IN ('voided','parked')
       AND c.deleted_at IS NULL
     GROUP BY c.id, c.first_name, c.last_name, c.email,
              c.loyalty_points, c.loyalty_tier
     ORDER BY total_spend DESC
     LIMIT $4`,
    bindings,
  );

  return rows;
}

// ─── getPaymentMethodBreakdown ────────────────────────────────────────────────

export async function getPaymentMethodBreakdown(
  orgId:  string,
  params: DateRangeParams,
): Promise<PaymentMethodRow[]> {
  const bindings: unknown[] = [orgId, params.from, params.to];
  const locationClause = params.locationId
    ? (bindings.push(params.locationId), `AND o.location_id = $${bindings.length}`)
    : '';

  const { rows } = await query<{
    payment_method: string;
    transaction_count: string;
    total_amount: string;
  }>(
    `SELECT
       p.payment_method,
       COUNT(*)     AS transaction_count,
       SUM(p.amount) AS total_amount
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE o.organization_id = $1
       AND o.created_at >= $2
       AND o.created_at <  $3
       AND p.status IN ('completed','offline_queued')
       ${locationClause}
     GROUP BY p.payment_method
     ORDER BY total_amount DESC`,
    bindings,
  );

  const grandTotal = rows.reduce((s, r) => s + parseFloat(r.total_amount), 0);

  return rows.map((r) => ({
    payment_method:    r.payment_method as PaymentMethodRow['payment_method'],
    transaction_count: parseInt(r.transaction_count, 10),
    total_amount:      parseFloat(r.total_amount),
    percentage:        grandTotal > 0
      ? Math.round((parseFloat(r.total_amount) / grandTotal) * 10000) / 100
      : 0,
  }));
}

// ─── getEmployeePerformance ───────────────────────────────────────────────────

export async function getEmployeePerformance(
  orgId:  string,
  params: DateRangeParams,
): Promise<EmployeePerformanceRow[]> {
  const bindings: unknown[] = [orgId, params.from, params.to];
  const locationClause = params.locationId
    ? (bindings.push(params.locationId), `AND o.location_id = $${bindings.length}`)
    : '';

  const { rows } = await query<EmployeePerformanceRow>(
    `SELECT
       e.id                                     AS employee_id,
       e.first_name || ' ' || e.last_name       AS employee_name,
       COUNT(DISTINCT o.id)                      AS order_count,
       COALESCE(SUM(
         CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END
       ), 0)                                    AS gross_sales,
       CASE WHEN COUNT(DISTINCT o.id) = 0 THEN 0
            ELSE SUM(
              CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END
            ) / COUNT(DISTINCT o.id)
       END                                      AS avg_order_value,
       COUNT(DISTINCT CASE WHEN o.status IN ('refunded','partially_refunded')
             THEN o.id END)                     AS refund_count,
       COALESCE(SUM(p.tip_amount), 0)           AS tips_collected
     FROM employees e
     JOIN orders o   ON o.employee_id = e.id
     LEFT JOIN payments p ON p.order_id = o.id AND p.status = 'completed'
     WHERE e.organization_id = $1
       AND o.created_at >= $2
       AND o.created_at <  $3
       ${locationClause}
     GROUP BY e.id, e.first_name, e.last_name
     ORDER BY gross_sales DESC`,
    bindings,
  );

  return rows;
}

// ─── getTipsReport ────────────────────────────────────────────────────────────

export interface TipsReport {
  totalTips:       number;
  totalSales:      number;
  avgTipPct:       number;
  byEmployee:      Array<{ employee_id: string; employee_name: string; tips: number; order_count: number }>;
  byDay:           Array<{ day: string; tips: number }>;
  byPaymentMethod: Array<{ method: string; tips: number }>;
}

export async function getTipsReport(orgId: string, params: DateRangeParams): Promise<TipsReport> {
  const tz = params.timezone ?? 'UTC';
  const bindings: unknown[] = [orgId, params.from, params.to];
  const locClause = params.locationId
    ? (bindings.push(params.locationId), `AND o.location_id = $${bindings.length}`)
    : '';

  const tipWhere = `
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.organization_id = $1 AND o.created_at >= $2 AND o.created_at < $3
      AND p.status IN ('completed','partially_refunded') AND p.tip_amount > 0 ${locClause}`;

  const [empRows, byDay, byMethod, totals] = await Promise.all([
    query<{ employee_id: string; employee_name: string; tips: number; order_count: number }>(
      `SELECT e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name,
              COALESCE(SUM(p.tip_amount),0) AS tips, COUNT(DISTINCT o.id) AS order_count
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       JOIN employees e ON e.id = o.employee_id
       WHERE o.organization_id = $1 AND o.created_at >= $2 AND o.created_at < $3
         AND p.status IN ('completed','partially_refunded') AND p.tip_amount > 0 ${locClause}
       GROUP BY e.id, e.first_name, e.last_name
       ORDER BY tips DESC`,
      bindings,
    ),
    query<{ day: string; tips: number }>(
      `SELECT to_char(o.created_at AT TIME ZONE $${bindings.length + 1}, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(p.tip_amount),0) AS tips
       ${tipWhere}
       GROUP BY day ORDER BY day ASC`,
      [...bindings, tz],
    ),
    query<{ method: string; tips: number }>(
      `SELECT p.payment_method AS method, COALESCE(SUM(p.tip_amount),0) AS tips
       ${tipWhere}
       GROUP BY p.payment_method ORDER BY tips DESC`,
      bindings,
    ),
    query<{ total_sales: number }>(
      `SELECT COALESCE(SUM(o.subtotal),0) AS total_sales FROM orders o
        WHERE o.organization_id = $1 AND o.created_at >= $2 AND o.created_at < $3
          AND o.status NOT IN ('voided','parked') ${locClause}`,
      bindings,
    ),
  ]);

  const byEmployee = empRows.rows.map((r) => ({ ...r, tips: Number(r.tips), order_count: Number(r.order_count) }));
  const totalTips = byEmployee.reduce((s, r) => s + r.tips, 0);
  const totalSales = Number(totals.rows[0]?.total_sales ?? 0);

  return {
    totalTips,
    totalSales,
    avgTipPct: totalSales > 0 ? (totalTips / totalSales) * 100 : 0,
    byEmployee,
    byDay: byDay.rows.map((r) => ({ day: r.day, tips: Number(r.tips) })),
    byPaymentMethod: byMethod.rows.map((r) => ({ method: r.method, tips: Number(r.tips) })),
  };
}

// ─── getEndOfDayReport ────────────────────────────────────────────────────────

export interface EndOfDayReport {
  date:           string;
  grossSales:     number;
  refunds:        number;
  netSales:       number;
  orderCount:     number;
  averageTicket:  number;
  taxCollected:   number;
  tipsCollected:  number;
  byPaymentMethod: Record<string, number>;
  topItems:       Array<{ name: string; quantity: number; revenue: number }>;
  byEmployee:     Array<{ name: string; orderCount: number; revenue: number }>;
  hourlyBreakdown: Array<{ hour: number; orderCount: number; revenue: number }>;
  cashReconciliation: {
    openingAmount: number; cashSales: number; cashRefunds: number;
    cashDrops: number; expectedAmount: number; actualAmount: number | null; discrepancy: number | null;
  } | null;
}

export async function getEndOfDayReport(
  orgId: string, date: string, locationId?: string, timezone = 'UTC',
): Promise<EndOfDayReport> {
  // Resolve the local-day window as UTC instants.
  const { rows: [bounds] } = await query<{ start: string; end: string }>(
    `SELECT (($1::date)::timestamp AT TIME ZONE $2) AS start,
            ((($1::date) + 1)::timestamp AT TIME ZONE $2) AS end`,
    [date, timezone],
  );
  const start = bounds.start, end = bounds.end;

  // Location is $4 when present; timezone is appended per-query only where used.
  const baseParams: unknown[] = [orgId, start, end];
  if (locationId) baseParams.push(locationId);
  const locClause = locationId ? 'AND o.location_id = $4' : '';
  const locClauseO2 = locationId ? 'AND o2.location_id = $4' : '';

  const [summary, byMethod, topItems, byEmployee, hourly] = await Promise.all([
    query<{ gross: string; orders: string; tax: string; tips: string; refunds: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END),0) AS gross,
         COUNT(DISTINCT CASE WHEN o.status NOT IN ('voided','parked') THEN o.id END) AS orders,
         COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.tax_total ELSE 0 END),0) AS tax,
         COALESCE((SELECT SUM(p.tip_amount) FROM payments p JOIN orders o2 ON o2.id=p.order_id
                   WHERE o2.organization_id=$1 AND o2.created_at>=$2 AND o2.created_at<$3
                     AND p.status IN ('completed','partially_refunded') ${locClauseO2}),0) AS tips,
         COALESCE((SELECT SUM(p.refunded_amount) FROM payments p JOIN orders o2 ON o2.id=p.order_id
                   WHERE o2.organization_id=$1 AND o2.created_at>=$2 AND o2.created_at<$3 ${locClauseO2}),0) AS refunds
       FROM orders o
       WHERE o.organization_id=$1 AND o.created_at>=$2 AND o.created_at<$3 ${locClause}`,
      baseParams,
    ),
    query<{ method: string; amount: string }>(
      `SELECT p.payment_method AS method, COALESCE(SUM(p.amount),0) AS amount
       FROM payments p JOIN orders o ON o.id=p.order_id
       WHERE o.organization_id=$1 AND o.created_at>=$2 AND o.created_at<$3
         AND p.status IN ('completed','partially_refunded','refunded') ${locClause}
       GROUP BY p.payment_method`,
      baseParams,
    ),
    query<{ name: string; quantity: string; revenue: string }>(
      `SELECT li.name, SUM(li.quantity) AS quantity, SUM(li.total) AS revenue
       FROM order_line_items li JOIN orders o ON o.id=li.order_id
       WHERE o.organization_id=$1 AND o.created_at>=$2 AND o.created_at<$3
         AND li.voided_at IS NULL AND o.status NOT IN ('voided','parked') ${locClause}
       GROUP BY li.name ORDER BY revenue DESC LIMIT 5`,
      baseParams,
    ),
    query<{ name: string; order_count: string; revenue: string }>(
      `SELECT e.first_name || ' ' || e.last_name AS name,
              COUNT(DISTINCT o.id) AS order_count,
              COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END),0) AS revenue
       FROM orders o JOIN employees e ON e.id=o.employee_id
       WHERE o.organization_id=$1 AND o.created_at>=$2 AND o.created_at<$3 ${locClause}
       GROUP BY e.id, e.first_name, e.last_name ORDER BY revenue DESC`,
      baseParams,
    ),
    query<{ hour: string; order_count: string; revenue: string }>(
      `SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE $${baseParams.length + 1})::int AS hour,
              COUNT(DISTINCT o.id) AS order_count,
              COALESCE(SUM(CASE WHEN o.status NOT IN ('voided','parked') THEN o.total ELSE 0 END),0) AS revenue
       FROM orders o
       WHERE o.organization_id=$1 AND o.created_at>=$2 AND o.created_at<$3 ${locClause}
       GROUP BY hour ORDER BY hour ASC`,
      [...baseParams, timezone],
    ),
  ]);

  const s = summary.rows[0];
  const grossSales = Math.round(Number(s?.gross ?? 0));
  const refunds = Math.round(Number(s?.refunds ?? 0));
  const orderCount = parseInt(s?.orders ?? '0', 10);
  const netSales = grossSales - refunds;

  const byPaymentMethod: Record<string, number> = {};
  for (const r of byMethod.rows) byPaymentMethod[r.method] = Math.round(Number(r.amount));

  // Cash reconciliation from a drawer session opened that day (resilient if table absent)
  let cashReconciliation: EndOfDayReport['cashReconciliation'] = null;
  try {
    const cashBind = locationId ? [orgId, start, end, locationId] : [orgId, start, end];
    const cashLoc = locationId ? 'AND s.location_id = $4' : '';
    const { rows: [sess] } = await query<{
      opening_amount: string; expected_amount: string | null; actual_amount: string | null; discrepancy: string | null; id: string;
    }>(
      `SELECT s.id, s.opening_amount, s.expected_amount, s.actual_amount, s.discrepancy
         FROM cash_drawer_sessions s
        WHERE s.organization_id=$1 AND s.opened_at>=$2 AND s.opened_at<$3 ${cashLoc}
        ORDER BY s.opened_at DESC LIMIT 1`,
      cashBind,
    );
    if (sess) {
      const cashSales = byPaymentMethod['cash'] ?? 0;
      const { rows: [d] } = await query<{ drops: string }>(
        `SELECT COALESCE(SUM(amount),0) AS drops FROM cash_drops WHERE session_id=$1`, [sess.id],
      );
      const opening = Number(sess.opening_amount);
      const drops = Math.round(Number(d?.drops ?? 0));
      cashReconciliation = {
        openingAmount: opening, cashSales, cashRefunds: 0, cashDrops: drops,
        expectedAmount: sess.expected_amount != null ? Number(sess.expected_amount) : opening + cashSales - drops,
        actualAmount: sess.actual_amount != null ? Number(sess.actual_amount) : null,
        discrepancy: sess.discrepancy != null ? Number(sess.discrepancy) : null,
      };
    }
  } catch { /* cash drawer tables not migrated yet */ }

  return {
    date,
    grossSales, refunds, netSales, orderCount,
    averageTicket: orderCount > 0 ? Math.round(netSales / orderCount) : 0,
    taxCollected: Math.round(Number(s?.tax ?? 0)),
    tipsCollected: Math.round(Number(s?.tips ?? 0)),
    byPaymentMethod,
    topItems: topItems.rows.map((r) => ({ name: r.name, quantity: Math.round(Number(r.quantity)), revenue: Math.round(Number(r.revenue)) })),
    byEmployee: byEmployee.rows.map((r) => ({ name: r.name, orderCount: parseInt(r.order_count, 10), revenue: Math.round(Number(r.revenue)) })),
    hourlyBreakdown: hourly.rows.map((r) => ({ hour: parseInt(r.hour, 10), orderCount: parseInt(r.order_count, 10), revenue: Math.round(Number(r.revenue)) })),
    cashReconciliation,
  };
}

// ─── getHourlyHeatmap ─────────────────────────────────────────────────────────

/**
 * Returns a 7×24 matrix of order counts/sales bucketed by hour-of-day and
 * day-of-week. Useful for staffing and kitchen prep decisions.
 */
export async function getHourlyHeatmap(
  orgId:  string,
  params: DateRangeParams,
): Promise<HourlyHeatmapRow[]> {
  const tz      = params.timezone ?? 'UTC';
  const bindings: unknown[] = [orgId, params.from, params.to, tz];
  const locationClause = params.locationId
    ? (bindings.push(params.locationId), `AND location_id = $${bindings.length}`)
    : '';

  const { rows } = await query<HourlyHeatmapRow>(
    `SELECT
       EXTRACT(HOUR       FROM created_at AT TIME ZONE $4)::int AS hour,
       EXTRACT(DOW        FROM created_at AT TIME ZONE $4)::int AS day_of_week,
       COUNT(*)                                                   AS order_count,
       COALESCE(SUM(total), 0)                                   AS gross_sales
     FROM orders
     WHERE organization_id = $1
       AND created_at >= $2
       AND created_at <  $3
       AND status NOT IN ('voided','parked')
       ${locationClause}
     GROUP BY 1, 2
     ORDER BY day_of_week, hour`,
    bindings,
  );

  return rows;
}

// ─── getDashboardMetrics ──────────────────────────────────────────────────────

/**
 * Summary stats for the live dashboard — today vs yesterday,
 * this week vs this month.
 * All values are in the org's default currency (not formatted).
 */
export async function getDashboardMetrics(
  orgId:      string,
  locationId?: string,
  timezone   = 'UTC',
): Promise<DashboardMetrics> {
  const mainBindings: unknown[] = [orgId, timezone];
  const locCondition = locationId
    ? (mainBindings.push(locationId), `AND location_id = $${mainBindings.length}`)
    : '';

  const { rows: [r] } = await query<{
    today_sales:         string;
    today_orders:        string;
    today_customers:     string;
    yesterday_sales:     string;
    yesterday_orders:    string;
    yesterday_customers: string;
    week_sales:          string;
    week_orders:         string;
    month_sales:         string;
    month_orders:        string;
  }>(
    `SELECT
       -- today
       COALESCE(SUM(total) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('day', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked')), 0)            AS today_sales,
       COUNT(*)  FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('day', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked'))                AS today_orders,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE created_at AT TIME ZONE $2
           >= date_trunc('day', now() AT TIME ZONE $2)
           AND customer_id IS NOT NULL)                        AS today_customers,
       -- yesterday
       COALESCE(SUM(total) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('day', now() AT TIME ZONE $2) - interval '1 day'
         AND created_at AT TIME ZONE $2
          < date_trunc('day', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked')), 0)            AS yesterday_sales,
       COUNT(*) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('day', now() AT TIME ZONE $2) - interval '1 day'
         AND created_at AT TIME ZONE $2
          < date_trunc('day', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked'))                AS yesterday_orders,
       COUNT(DISTINCT customer_id) FILTER (
         WHERE created_at AT TIME ZONE $2
           >= date_trunc('day', now() AT TIME ZONE $2) - interval '1 day'
           AND created_at AT TIME ZONE $2
            < date_trunc('day', now() AT TIME ZONE $2)
           AND customer_id IS NOT NULL)                        AS yesterday_customers,
       -- this week (Mon-start)
       COALESCE(SUM(total) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('week', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked')), 0)            AS week_sales,
       COUNT(*) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('week', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked'))                AS week_orders,
       -- this month
       COALESCE(SUM(total) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('month', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked')), 0)            AS month_sales,
       COUNT(*) FILTER (WHERE created_at AT TIME ZONE $2
         >= date_trunc('month', now() AT TIME ZONE $2)
         AND status NOT IN ('voided','parked'))                AS month_orders
     FROM orders
     WHERE organization_id = $1
       AND created_at >= now() - interval '32 days'
       ${locCondition}`,
    mainBindings,
  );

  // Top product today
  const topBindings: unknown[] = [orgId, timezone];
  const topLocCondition = locationId
    ? (topBindings.push(locationId), `AND o.location_id = $${topBindings.length}`)
    : '';
  const { rows: [top] } = await query<{ name: string; qty: string }>(
    `SELECT p.name, SUM(li.quantity) AS qty
     FROM order_line_items li
     JOIN orders o ON o.id = li.order_id
     JOIN products p ON p.id = li.product_id
     WHERE o.organization_id = $1
       AND o.created_at AT TIME ZONE $2 >= date_trunc('day', now() AT TIME ZONE $2)
       AND o.status NOT IN ('voided','parked')
       AND li.voided_at IS NULL
       ${topLocCondition}
     GROUP BY p.name
     ORDER BY qty DESC
     LIMIT 1`,
    topBindings,
  );

  const todayOrders   = parseInt(r?.today_orders   ?? '0', 10);
  const yesterdayOrders = parseInt(r?.yesterday_orders ?? '0', 10);
  const todaySales    = parseFloat(r?.today_sales    ?? '0');
  const yesterdaySales = parseFloat(r?.yesterday_sales ?? '0');

  return {
    today: {
      gross_sales:   todaySales,
      order_count:   todayOrders,
      avg_order:     todayOrders > 0 ? todaySales / todayOrders : 0,
      new_customers: parseInt(r?.today_customers ?? '0', 10),
    },
    yesterday: {
      gross_sales:   yesterdaySales,
      order_count:   yesterdayOrders,
      avg_order:     yesterdayOrders > 0 ? yesterdaySales / yesterdayOrders : 0,
      new_customers: parseInt(r?.yesterday_customers ?? '0', 10),
    },
    this_week: {
      gross_sales: parseFloat(r?.week_sales  ?? '0'),
      order_count: parseInt(r?.week_orders ?? '0', 10),
    },
    this_month: {
      gross_sales: parseFloat(r?.month_sales  ?? '0'),
      order_count: parseInt(r?.month_orders ?? '0', 10),
    },
    top_product_today: top
      ? { name: top.name, qty: parseFloat(top.qty) }
      : null,
  };
}
