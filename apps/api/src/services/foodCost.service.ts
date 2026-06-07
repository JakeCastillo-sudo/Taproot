/**
 * foodCost.service — recipe-based food cost intelligence (S9-05).
 *
 * Differs from intelligence.getFoodCostIntelligence (S5-04), which derives
 * COGS from order_line_items.cost_price: this service computes the THEORETICAL
 * plate cost from each product's active recipe (Σ ingredient qty × (1+waste) ×
 * ingredient cost_price ÷ yield_factor) and compares it to the live sale price.
 * Products without a recipe fall back to their own cost_price.
 *
 * Money: cents everywhere (cost_price + product_prices are cent values).
 * AI: ONE batched Claude call generates fix suggestions for flagged items
 * (price / portion / substitution options). 4h cache. Graceful without a key.
 */

import { query } from '../db/client';
import { askClaudeJSON, aiAvailable, cacheGet, cacheSet } from './ai.service';

export const DEFAULT_FOOD_COST_TARGET_PCT = 30;

export interface FoodCostAnalysis {
  productId: string;
  name: string;
  salePrice: number;          // cents
  recipeCost: number;         // cents (theoretical plate cost)
  hasRecipe: boolean;
  foodCostPct: number;        // recipeCost / salePrice * 100
  targetFoodCostPct: number;
  margin: number;             // cents
  marginPct: number;
  status: 'healthy' | 'warning' | 'critical';
  aiSuggestion: string | null;
}

export interface FoodCostSummary {
  blendedFoodCostPct: number;
  targetFoodCostPct: number;
  variance: number;
  itemsOverTarget: number;
  itemsAnalyzed: number;
  potentialMonthlySavings: number;  // cents
  topOffenders: FoodCostAnalysis[];
  trend: Array<{ day: string; foodCostPct: number }>;
  aiUsed: boolean;
  generatedAt: string;
}

async function getTargetPct(orgId: string): Promise<number> {
  const { rows: [org] } = await query<{ target: number | string | null }>(
    `SELECT (settings->>'foodCostTargetPct')::numeric AS target FROM organizations WHERE id = $1`,
    [orgId],
  );
  const t = Number(org?.target ?? 0);
  return t > 0 && t < 100 ? t : DEFAULT_FOOD_COST_TARGET_PCT;
}

// ─── Per-product analysis ─────────────────────────────────────────────────────

export async function analyzeFoodCosts(orgId: string, locationId?: string): Promise<FoodCostAnalysis[]> {
  const cacheKey = `ai:food-cost:${orgId}:${locationId ?? 'all'}`;
  const cached = await cacheGet<FoodCostAnalysis[]>(cacheKey);
  if (cached) return cached;

  const target = await getTargetPct(orgId);

  // Sellable products with an active price; recipe cost where a recipe exists,
  // else the product's own cost_price.
  const { rows } = await query<{
    id: string; name: string; sale_price: string | number | null;
    recipe_cost: string | number | null; own_cost: string | number;
  }>(
    `SELECT p.id, p.name, p.cost_price AS own_cost,
            (SELECT pp.price FROM product_variants v
               JOIN product_prices pp ON pp.variant_id = v.id AND pp.is_active = true
              WHERE v.product_id = p.id AND v.deleted_at IS NULL
              ORDER BY v.created_at ASC LIMIT 1) AS sale_price,
            (SELECT SUM(rl.quantity * (1 + rl.waste_factor) * ip.cost_price) / NULLIF(MAX(r.yield_factor), 0)
               FROM recipes r
               JOIN recipe_lines rl ON rl.recipe_id = r.id
               JOIN products ip ON ip.id = rl.ingredient_product_id
              WHERE r.product_id = p.id AND r.is_active = true AND r.deleted_at IS NULL) AS recipe_cost
       FROM products p
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL
        AND p.is_active = true
      ORDER BY p.name ASC`,
    [orgId],
  );

  const items: FoodCostAnalysis[] = rows
    .map((r): FoodCostAnalysis | null => {
      const salePrice = Math.round(Number(r.sale_price ?? 0));
      const hasRecipe = r.recipe_cost != null && Number(r.recipe_cost) > 0;
      const recipeCost = Math.round(Number(hasRecipe ? r.recipe_cost : r.own_cost) || 0);
      if (salePrice <= 0 || recipeCost <= 0) return null;
      const pct = Math.round((recipeCost / salePrice) * 1000) / 10;
      const margin = salePrice - recipeCost;
      return {
        productId: r.id,
        name: r.name,
        salePrice,
        recipeCost,
        hasRecipe,
        foodCostPct: pct,
        targetFoodCostPct: target,
        margin,
        marginPct: Math.round((margin / salePrice) * 1000) / 10,
        status: (pct <= target ? 'healthy' : pct <= target + 8 ? 'warning' : 'critical') as FoodCostAnalysis['status'],
        aiSuggestion: null,
      };
    })
    .filter((x): x is FoodCostAnalysis => x !== null)
    .sort((a, b) => b.foodCostPct - a.foodCostPct);

  // One batched AI call for flagged items
  const flagged = items.filter((i) => i.status !== 'healthy').slice(0, 10);
  if (aiAvailable() && flagged.length) {
    const ai = await askClaudeJSON<{ suggestions?: Array<{ productId?: string; suggestion?: string }> }>(
      `You are a restaurant food-cost consultant. Target food cost is ${target}%. For each flagged item, give ONE concise suggestion with concrete numbers — a price change, a portion reduction, or an ingredient substitution. Return ONLY valid JSON.`,
      `Flagged items (money in CENTS): ${JSON.stringify(flagged.map((f) => ({
        productId: f.productId, name: f.name, salePriceCents: f.salePrice,
        plateCostCents: f.recipeCost, foodCostPct: f.foodCostPct,
      })))}

Return JSON: { "suggestions": [{ "productId": string, "suggestion": "one sentence with numbers, e.g. 'Raise price from $14.99 to $17.49 to hit 30%, or trim the portion by 10%.'" }] }`,
      1024,
    );
    const byId = new Map((ai?.suggestions ?? [])
      .filter((s) => typeof s?.productId === 'string' && typeof s?.suggestion === 'string')
      .map((s) => [s.productId as string, s.suggestion as string]));
    for (const item of items) {
      const s = byId.get(item.productId);
      if (s) item.aiSuggestion = s;
    }
  }
  // Deterministic fallback suggestion for flagged items the AI didn't cover
  for (const item of items) {
    if (item.status !== 'healthy' && !item.aiSuggestion) {
      const priceForTarget = Math.ceil((item.recipeCost / (target / 100)) / 25) * 25; // round up to 25¢
      item.aiSuggestion = `At ${item.foodCostPct}% food cost vs the ${target}% target: raise the price to ~$${(priceForTarget / 100).toFixed(2)}, or trim the plate cost by ~$${((item.recipeCost - item.salePrice * (target / 100)) / 100).toFixed(2)}.`;
    }
  }

  await cacheSet(cacheKey, items, 4 * 60 * 60);
  return items;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getFoodCostSummary(orgId: string, locationId?: string): Promise<FoodCostSummary> {
  const target = await getTargetPct(orgId);
  const items = await analyzeFoodCosts(orgId, locationId);

  // Blended actual food cost from sales mix (last 30 days, line-item costs)
  const params: unknown[] = [orgId];
  let lc = '';
  if (locationId) { params.push(locationId); lc = `AND o.location_id = $${params.length}`; }
  const { rows: [totals] } = await query<{ revenue: string; cogs: string }>(
    `SELECT COALESCE(SUM(li.total),0) AS revenue, COALESCE(SUM(li.cost_price * li.quantity),0) AS cogs
       FROM order_line_items li
       JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
      WHERE o.organization_id = $1 AND li.voided_at IS NULL
        AND o.created_at >= now() - interval '30 days' ${lc}`,
    params,
  );
  const revenue = Number(totals?.revenue ?? 0);
  const cogs = Number(totals?.cogs ?? 0);
  const blended = revenue > 0 ? Math.round((cogs / revenue) * 1000) / 10 : 0;

  // 90-day weekly trend
  const { rows: trendRows } = await query<{ day: string; pct: string | null }>(
    `SELECT to_char(date_trunc('week', o.created_at), 'YYYY-MM-DD') AS day,
            CASE WHEN SUM(li.total) > 0
                 THEN ROUND((SUM(li.cost_price * li.quantity) / SUM(li.total)) * 1000) / 10
                 ELSE NULL END AS pct
       FROM order_line_items li
       JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
      WHERE o.organization_id = $1 AND li.voided_at IS NULL
        AND o.created_at >= now() - interval '90 days' ${lc}
      GROUP BY 1 ORDER BY 1 ASC`,
    params,
  );

  // Potential savings: 30d revenue share of flagged items × pct gap
  const flagged = items.filter((i) => i.status !== 'healthy');
  let potentialMonthlySavings = 0;
  if (flagged.length && revenue > 0) {
    const { rows: itemRev } = await query<{ product_id: string; revenue: string }>(
      `SELECT li.product_id, SUM(li.total) AS revenue
         FROM order_line_items li
         JOIN orders o ON o.id = li.order_id AND o.status NOT IN ('voided','parked')
        WHERE o.organization_id = $1 AND li.voided_at IS NULL
          AND o.created_at >= now() - interval '30 days' ${lc}
          AND li.product_id = ANY($${params.length + 1}::uuid[])
        GROUP BY li.product_id`,
      [...params, flagged.map((f) => f.productId)],
    );
    const revById = new Map(itemRev.map((r) => [r.product_id, Number(r.revenue)]));
    potentialMonthlySavings = Math.round(flagged.reduce((sum, f) => {
      const rev = revById.get(f.productId) ?? 0;
      return sum + rev * Math.max(0, (f.foodCostPct - target) / 100);
    }, 0));
  }

  return {
    blendedFoodCostPct: blended,
    targetFoodCostPct: target,
    variance: Math.round((blended - target) * 10) / 10,
    itemsOverTarget: flagged.length,
    itemsAnalyzed: items.length,
    potentialMonthlySavings,
    topOffenders: flagged.slice(0, 5),
    trend: trendRows.filter((t) => t.pct != null).map((t) => ({ day: t.day, foodCostPct: Number(t.pct) })),
    aiUsed: items.some((i) => i.aiSuggestion != null && aiAvailable()),
    generatedAt: new Date().toISOString(),
  };
}
