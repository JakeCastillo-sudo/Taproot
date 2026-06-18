/**
 * ingredientAnalytics.service — food cost (COGS), modifier attach rates, and
 * omission insights derived from the ingredient system (Session 6).
 *
 * COGS source: stock_movements (movement_type='sale', negative qty) ×
 * ingredients.cost_per_unit — distinct from the legacy foodCost.service (S9-05)
 * which derives plate cost from recipes/order_line_items.cost_price.
 *
 * Org-scoped throughout. Money in INTEGER CENTS. Guards ingredientSystemReady()
 * so everything returns safe empties until migration 028 + recipe orders exist.
 */

import { query } from '../db/client';
import { ingredientSystemReady } from './ingredient.service';

// ── Types ─────────────────────────────────────────────────────────────────────────

export interface FoodCostSummary {
  periodDays: number;
  grossRevenue: number;   // cents
  totalCOGS: number;      // cents
  grossMargin: number;    // cents
  foodCostPercent: number; // 0-100
  recipeOrderCount: number;
  totalOrderCount: number;
  recipeCoverage: number; // % of orders with COGS data
  byDay: Array<{ date: string; revenue: number; cogs: number; margin: number; foodCostPercent: number }>;
  benchmark: { industryAvg: number; status: 'excellent' | 'good' | 'high' | 'critical' };
}

export interface ModifierAttachRate {
  ingredientId: string;
  ingredientName: string;
  modifierType: 'extra' | 'add_on' | 'omission';
  totalOrdersWithProduct: number;
  timesSelected: number;
  attachRate: number;          // 0-100
  revenueFromModifier: number; // cents
  avgPriceDelta: number;       // cents
}

export interface OmissionInsight {
  ingredientName: string;
  omissionRate: number;     // 0-100
  productName: string;
  totalOrders: number;
  timesOmitted: number;
  wasteValueSaved: number;  // cents
  insight: string;
}

// ── COGS for a single order ─────────────────────────────────────────────────────

export async function calculateOrderCOGS(orgId: string, orderId: string): Promise<number> {
  if (!(await ingredientSystemReady())) return 0;
  const { rows } = await query<{ cogs_cents: string | null }>(
    `SELECT COALESCE(SUM(ABS(sm.quantity_change) * i.cost_per_unit), 0) AS cogs_cents
       FROM stock_movements sm
       JOIN ingredients i ON i.id = sm.ingredient_id
      WHERE sm.order_id = $1 AND sm.organization_id = $2
        AND sm.movement_type = 'sale' AND sm.quantity_change < 0`,
    [orderId, orgId],
  );
  return Math.round(parseFloat(rows[0]?.cogs_cents ?? '0') || 0);
}

// ── Food cost summary ─────────────────────────────────────────────────────────────

export async function getFoodCostSummary(orgId: string, days = 7): Promise<FoodCostSummary> {
  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);
  const empty: FoodCostSummary = {
    periodDays: safeDays, grossRevenue: 0, totalCOGS: 0, grossMargin: 0, foodCostPercent: 0,
    recipeOrderCount: 0, totalOrderCount: 0, recipeCoverage: 0, byDay: [],
    benchmark: { industryAvg: 31, status: 'good' },
  };
  if (!(await ingredientSystemReady())) return empty;

  const [revenueRes, cogsRes, byDayRes] = await Promise.all([
    query<{ total_orders: string; gross_revenue: string; recipe_orders: string }>(
      `SELECT
         COUNT(*) AS total_orders,
         COALESCE(SUM(total), 0) AS gross_revenue,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM stock_movements sm WHERE sm.order_id = o.id AND sm.movement_type = 'sale'
         )) AS recipe_orders
       FROM orders o
       WHERE o.organization_id = $1 AND o.status = 'completed'
         AND o.created_at > NOW() - ($2::int * INTERVAL '1 day')`,
      [orgId, safeDays],
    ),
    query<{ total_cogs: string }>(
      `SELECT COALESCE(SUM(ABS(sm.quantity_change) * i.cost_per_unit), 0) AS total_cogs
         FROM stock_movements sm
         JOIN ingredients i ON i.id = sm.ingredient_id
        WHERE sm.organization_id = $1 AND sm.movement_type = 'sale' AND sm.quantity_change < 0
          AND sm.created_at > NOW() - ($2::int * INTERVAL '1 day')`,
      [orgId, safeDays],
    ),
    query<{ date: string; revenue: string; cogs: string }>(
      // revenue-by-day FULL JOIN cogs-by-day. Each side groups by DATE(created_at)
      // and selects only that grouped expression — avoids referencing the ungrouped
      // o.created_at (Postgres 42803).
      `SELECT COALESCE(rev.date, cog.date) AS date,
              COALESCE(rev.revenue, 0)     AS revenue,
              COALESCE(cog.cogs, 0)        AS cogs
         FROM (
           SELECT to_char(DATE(o.created_at), 'YYYY-MM-DD') AS date, COALESCE(SUM(o.total), 0) AS revenue
             FROM orders o
            WHERE o.organization_id = $1 AND o.status = 'completed'
              AND o.created_at > NOW() - ($2::int * INTERVAL '1 day')
            GROUP BY DATE(o.created_at)
         ) rev
         FULL OUTER JOIN (
           SELECT to_char(DATE(sm.created_at), 'YYYY-MM-DD') AS date,
                  COALESCE(SUM(ABS(sm.quantity_change) * i.cost_per_unit), 0) AS cogs
             FROM stock_movements sm
             JOIN ingredients i ON i.id = sm.ingredient_id
            WHERE sm.organization_id = $1 AND sm.movement_type = 'sale'
              AND sm.created_at > NOW() - ($2::int * INTERVAL '1 day')
            GROUP BY DATE(sm.created_at)
         ) cog ON cog.date = rev.date
        ORDER BY 1 ASC`,
      [orgId, safeDays],
    ),
  ]);

  const rev = revenueRes.rows[0];
  const grossRevenue = Math.round(parseFloat(rev?.gross_revenue ?? '0') || 0);
  const totalCOGS = Math.round(parseFloat(cogsRes.rows[0]?.total_cogs ?? '0') || 0);
  const grossMargin = grossRevenue - totalCOGS;
  const foodCostPercent = grossRevenue > 0 ? Math.round((totalCOGS / grossRevenue) * 100) : 0;
  const totalOrderCount = parseInt(rev?.total_orders ?? '0', 10) || 0;
  const recipeOrderCount = parseInt(rev?.recipe_orders ?? '0', 10) || 0;

  let status: FoodCostSummary['benchmark']['status'];
  if (foodCostPercent < 25) status = 'excellent';
  else if (foodCostPercent <= 35) status = 'good';
  else if (foodCostPercent <= 45) status = 'high';
  else status = 'critical';

  return {
    periodDays: safeDays,
    grossRevenue,
    totalCOGS,
    grossMargin,
    foodCostPercent,
    recipeOrderCount,
    totalOrderCount,
    recipeCoverage: totalOrderCount > 0 ? Math.round((recipeOrderCount / totalOrderCount) * 100) : 0,
    byDay: byDayRes.rows.map((r) => {
      const dr = Math.round(parseFloat(r.revenue) || 0);
      const dc = Math.round(parseFloat(r.cogs) || 0);
      return { date: r.date, revenue: dr, cogs: dc, margin: dr - dc, foodCostPercent: dr > 0 ? Math.round((dc / dr) * 100) : 0 };
    }),
    benchmark: { industryAvg: 31, status },
  };
}

// ── Modifier attach rates (extra / add_on) ────────────────────────────────────────

export async function getModifierAttachRates(orgId: string, days = 30): Promise<ModifierAttachRate[]> {
  if (!(await ingredientSystemReady())) return [];
  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);

  const { rows } = await query<{
    ingredient_id: string; ingredient_name: string; modifier_type: string;
    times_selected: string; total_revenue: string; avg_price_delta: string;
    total_orders_with_product: string;
  }>(
    `SELECT
       i.id AS ingredient_id,
       i.name AS ingredient_name,
       m.modifier_type,
       COUNT(DISTINCT oli.order_id) AS times_selected,
       COALESCE(SUM(m.price_delta), 0) AS total_revenue,
       AVG(m.price_delta) AS avg_price_delta,
       (
         SELECT COUNT(DISTINCT oli2.order_id)
           FROM order_line_items oli2
           JOIN orders o2 ON o2.id = oli2.order_id
           JOIN product_ingredients pi2 ON pi2.product_id = oli2.product_id AND pi2.ingredient_id = i.id
          WHERE o2.organization_id = $1 AND o2.status = 'completed'
            AND o2.created_at > NOW() - ($2::int * INTERVAL '1 day')
       ) AS total_orders_with_product
     FROM order_line_items oli
     JOIN orders o ON o.id = oli.order_id
     JOIN (
       SELECT oli3.order_id, elem->>'modifierId' AS modifier_id
         FROM order_line_items oli3, jsonb_array_elements(oli3.modifiers) elem
        WHERE oli3.modifiers <> '[]'::jsonb
     ) mod_data ON mod_data.order_id = oli.order_id
     JOIN modifiers m ON m.id::text = mod_data.modifier_id
     JOIN ingredients i ON i.id = m.ingredient_id
     WHERE o.organization_id = $1 AND o.status = 'completed'
       AND o.created_at > NOW() - ($2::int * INTERVAL '1 day')
       AND m.ingredient_id IS NOT NULL
       AND m.modifier_type IN ('extra', 'add_on')
     GROUP BY i.id, i.name, m.modifier_type
     HAVING COUNT(DISTINCT oli.order_id) > 0
     ORDER BY times_selected DESC
     LIMIT 20`,
    [orgId, safeDays],
  );

  return rows.map((r) => {
    const timesSelected = parseInt(r.times_selected, 10) || 0;
    const totalOrders = parseInt(r.total_orders_with_product, 10) || 0;
    return {
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      modifierType: r.modifier_type as ModifierAttachRate['modifierType'],
      totalOrdersWithProduct: totalOrders,
      timesSelected,
      attachRate: totalOrders > 0 ? Math.round((timesSelected / totalOrders) * 100) : 0,
      revenueFromModifier: Math.round(parseFloat(r.total_revenue) || 0),
      avgPriceDelta: Math.round(parseFloat(r.avg_price_delta) || 0),
    };
  });
}

// ── Omission insights ─────────────────────────────────────────────────────────────

export async function getOmissionInsights(orgId: string, days = 30): Promise<OmissionInsight[]> {
  if (!(await ingredientSystemReady())) return [];
  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);

  const { rows } = await query<{
    ingredient_name: string; product_name: string;
    total_orders: string; times_omitted: string; cost_per_unit: string; recipe_qty: string;
  }>(
    `SELECT
       i.name AS ingredient_name,
       p.name AS product_name,
       COUNT(DISTINCT o.id) AS total_orders,
       COUNT(DISTINCT CASE WHEN omit_data.modifier_id IS NOT NULL THEN o.id END) AS times_omitted,
       i.cost_per_unit,
       pi.quantity AS recipe_qty
     FROM orders o
     JOIN order_line_items oli ON oli.order_id = o.id
     JOIN products p ON p.id = oli.product_id
     JOIN product_ingredients pi ON pi.product_id = p.id
     JOIN ingredients i ON i.id = pi.ingredient_id
     LEFT JOIN (
       SELECT oli2.order_id, elem->>'modifierId' AS modifier_id
         FROM order_line_items oli2, jsonb_array_elements(oli2.modifiers) elem
        WHERE oli2.modifiers <> '[]'::jsonb
     ) omit_data ON (
       omit_data.order_id = o.id
       AND EXISTS (
         SELECT 1 FROM modifiers m
          WHERE m.id::text = omit_data.modifier_id
            AND m.ingredient_id = i.id AND m.modifier_type = 'omission'
       )
     )
     WHERE o.organization_id = $1 AND o.status = 'completed'
       AND o.created_at > NOW() - ($2::int * INTERVAL '1 day')
       AND p.recipe_mode = true
     GROUP BY i.name, p.name, i.cost_per_unit, pi.quantity
     HAVING COUNT(DISTINCT o.id) >= 5
     ORDER BY (COUNT(DISTINCT CASE WHEN omit_data.modifier_id IS NOT NULL THEN o.id END)::float
               / NULLIF(COUNT(DISTINCT o.id), 0)) DESC
     LIMIT 10`,
    [orgId, safeDays],
  );

  return rows.map((r) => {
    const totalOrders = parseInt(r.total_orders, 10) || 0;
    const timesOmitted = parseInt(r.times_omitted, 10) || 0;
    const omissionRate = totalOrders > 0 ? Math.round((timesOmitted / totalOrders) * 100) : 0;
    const costPerUnit = parseInt(r.cost_per_unit, 10) || 0;
    const recipeQty = parseFloat(r.recipe_qty) || 1;
    const wasteValueSaved = Math.round(timesOmitted * costPerUnit * recipeQty);

    let insight: string;
    if (omissionRate >= 40) {
      insight = `${omissionRate}% of customers remove ${r.ingredient_name} from ${r.product_name}. Consider making it optional by default or offering a "without ${r.ingredient_name}" variant.`;
    } else if (omissionRate >= 20) {
      insight = `${omissionRate}% of customers skip ${r.ingredient_name} — about $${(wasteValueSaved / 100).toFixed(2)} of ingredient cost avoided this period.`;
    } else {
      insight = `${omissionRate}% omission rate for ${r.ingredient_name}.`;
    }

    return { ingredientName: r.ingredient_name, omissionRate, productName: r.product_name, totalOrders, timesOmitted, wasteValueSaved, insight };
  });
}

// ── Lightweight data for the AI morning brief ─────────────────────────────────────

export interface IngredientBriefData {
  foodCostPercent: number | null;
  foodCostStatus: string | null;
  lowStockCount: number;
  criticalIngredients: string[];
  topAttachRate: { name: string; rate: number; type: string } | null;
  topOmission: { name: string; rate: number; insight: string } | null;
}

export async function getIngredientBriefData(orgId: string): Promise<IngredientBriefData> {
  const empty: IngredientBriefData = {
    foodCostPercent: null, foodCostStatus: null, lowStockCount: 0,
    criticalIngredients: [], topAttachRate: null, topOmission: null,
  };
  try {
    if (!(await ingredientSystemReady())) return empty;

    const [foodCost, critCount, attachRates, omissions, critNames] = await Promise.all([
      getFoodCostSummary(orgId, 1),
      query<{ critical: string }>(
        `SELECT COUNT(*) AS critical FROM ingredients
          WHERE organization_id = $1 AND deleted_at IS NULL
            AND current_stock > 0 AND current_stock < reorder_point`,
        [orgId],
      ),
      getModifierAttachRates(orgId, 7),
      getOmissionInsights(orgId, 7),
      query<{ name: string }>(
        `SELECT name FROM ingredients
          WHERE organization_id = $1 AND deleted_at IS NULL
            AND current_stock > 0 AND current_stock < reorder_point
          ORDER BY name ASC LIMIT 3`,
        [orgId],
      ),
    ]);

    return {
      foodCostPercent: foodCost.totalCOGS > 0 ? foodCost.foodCostPercent : null,
      foodCostStatus: foodCost.totalCOGS > 0 ? foodCost.benchmark.status : null,
      lowStockCount: parseInt(critCount.rows[0]?.critical ?? '0', 10) || 0,
      criticalIngredients: critNames.rows.map((r) => r.name),
      topAttachRate: attachRates[0]
        ? { name: attachRates[0].ingredientName, rate: attachRates[0].attachRate, type: attachRates[0].modifierType }
        : null,
      topOmission: omissions[0]
        ? { name: omissions[0].ingredientName, rate: omissions[0].omissionRate, insight: omissions[0].insight }
        : null,
    };
  } catch {
    return empty; // never crash the brief
  }
}
