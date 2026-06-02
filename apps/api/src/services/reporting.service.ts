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
