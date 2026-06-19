/**
 * ingredientInventory.service — automatic stock deduction on payment + reversal
 * on void (Session 1). NEVER throws — inventory must never block payment.
 *
 * Named ingredientInventory (not inventory) because a legacy inventory.service.ts
 * already exists for the inventory_levels system. This operates only on the new
 * ingredients / stock_movements tables and only for products with recipe_mode=true,
 * so it is fully independent and no-ops for all existing products.
 */

import { query, withTransaction } from '../db/client';
import { ingredientSystemReady } from './ingredient.service';

interface LineModifierSnapshot { modifierId?: string; name?: string; priceDelta?: number }

function parseModifiers(raw: unknown): LineModifierSnapshot[] {
  if (Array.isArray(raw)) return raw as LineModifierSnapshot[];
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

// ── Deduct ingredients when an order is paid in full ──────────────────────────────

export async function deductOrderIngredients(orgId: string, orderId: string): Promise<void> {
  try {
    if (!(await ingredientSystemReady())) return;

    // WG-012: idempotency — skip if this order's sale deductions already exist.
    // Mirrors the sale_void guard in reverseOrderIngredients; makes retries safe.
    const { rows: alreadyDeducted } = await query(
      `SELECT 1 FROM stock_movements
        WHERE order_id = $1 AND organization_id = $2 AND movement_type = 'sale' LIMIT 1`,
      [orderId, orgId],
    );
    if (alreadyDeducted.length) return;

    const { rows: lineItems } = await query<{
      id: string; product_id: string | null; quantity: number; modifiers: unknown;
    }>(
      `SELECT oli.id, oli.product_id, oli.quantity, oli.modifiers
         FROM order_line_items oli
         JOIN orders o ON o.id = oli.order_id
        WHERE oli.order_id = $1 AND o.organization_id = $2 AND oli.voided_at IS NULL`,
      [orderId, orgId],
    );
    if (!lineItems.length) return;

    // Which of these products are in recipe mode?
    const productIds = [...new Set(lineItems.map((l) => l.product_id).filter((x): x is string => !!x))];
    if (!productIds.length) return;

    const { rows: prodRows } = await query<{ id: string; recipe_mode: boolean }>(
      `SELECT id, recipe_mode FROM products WHERE id = ANY($1::uuid[]) AND organization_id = $2`,
      [productIds, orgId],
    );
    const recipeMode = new Map(prodRows.map((p) => [p.id, p.recipe_mode]));
    const recipeProductIds = prodRows.filter((p) => p.recipe_mode).map((p) => p.id);
    if (!recipeProductIds.length) return;

    // Preload recipes for the recipe-mode products.
    const { rows: recipeRows } = await query<{ product_id: string; ingredient_id: string; quantity: number }>(
      `SELECT product_id, ingredient_id, quantity
         FROM product_ingredients
        WHERE product_id = ANY($1::uuid[]) AND organization_id = $2`,
      [recipeProductIds, orgId],
    );
    const recipeByProduct = new Map<string, Array<{ ingredient_id: string; quantity: number }>>();
    for (const r of recipeRows) {
      const arr = recipeByProduct.get(r.product_id) ?? [];
      arr.push({ ingredient_id: r.ingredient_id, quantity: Number(r.quantity) });
      recipeByProduct.set(r.product_id, arr);
    }

    // Resolve applied modifiers (by modifierId) → ingredient linkage.
    const modIds = [...new Set(lineItems.flatMap((l) => parseModifiers(l.modifiers).map((m) => m.modifierId).filter((x): x is string => !!x)))];
    const modMap = new Map<string, { modifier_type: string | null; ingredient_id: string | null; ingredient_qty: number | null }>();
    if (modIds.length) {
      const { rows: modRows } = await query<{ id: string; modifier_type: string | null; ingredient_id: string | null; ingredient_qty: number | null }>(
        `SELECT id, modifier_type, ingredient_id, ingredient_qty FROM modifiers WHERE id = ANY($1::uuid[])`,
        [modIds],
      );
      for (const m of modRows) modMap.set(m.id, m);
    }

    // Universal add-ons may be carried as the ingredient id directly (no modifiers row).
    const { rows: uniRows } = await query<{ id: string }>(
      `SELECT id FROM ingredients WHERE organization_id = $1 AND deleted_at IS NULL AND is_universal_addon = true`,
      [orgId],
    );
    const universalSet = new Set(uniRows.map((u) => u.id));

    // Aggregate net deduction per ingredient (positive = remove).
    const deductions = new Map<string, number>();
    const addDeduction = (ingredientId: string, qty: number) => {
      if (!ingredientId || !Number.isFinite(qty) || qty <= 0) return;
      deductions.set(ingredientId, (deductions.get(ingredientId) ?? 0) + qty);
    };

    for (const li of lineItems) {
      if (!li.product_id || !recipeMode.get(li.product_id)) continue;
      const lineQty = Number(li.quantity) || 0;
      if (lineQty <= 0) continue;

      const applied = parseModifiers(li.modifiers);
      const resolved = applied
        .map((m) => (m.modifierId ? modMap.get(m.modifierId) : undefined))
        .filter((x): x is NonNullable<typeof x> => !!x);

      const omitted = new Set(
        resolved.filter((m) => m.modifier_type === 'omission' && m.ingredient_id).map((m) => m.ingredient_id as string),
      );

      // Base recipe ingredients (skip omitted).
      for (const ing of recipeByProduct.get(li.product_id) ?? []) {
        if (omitted.has(ing.ingredient_id)) continue;
        addDeduction(ing.ingredient_id, ing.quantity * lineQty);
      }

      // Extras / add-ons resolved via modifiers table.
      for (const m of resolved) {
        if ((m.modifier_type === 'extra' || m.modifier_type === 'add_on') && m.ingredient_id) {
          addDeduction(m.ingredient_id, Math.abs(Number(m.ingredient_qty ?? 1)) * lineQty);
        }
      }

      // Universal add-ons carried as raw ingredient id (not in modifiers table).
      for (const m of applied) {
        if (m.modifierId && !modMap.has(m.modifierId) && universalSet.has(m.modifierId)) {
          addDeduction(m.modifierId, 1 * lineQty);
        }
      }
    }

    if (!deductions.size) return;

    await withTransaction(async (client) => {
      for (const [ingredientId, qty] of deductions) {
        const { rows: [ing] } = await client.query<{ current_stock: number; reorder_point: number; name: string }>(
          `SELECT current_stock, reorder_point, name FROM ingredients
            WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [ingredientId, orgId],
        );
        if (!ing) continue; // ingredient gone / wrong org → skip
        const before = Number(ing.current_stock);
        const after = before - qty;
        await client.query(
          `INSERT INTO stock_movements
             (organization_id, ingredient_id, movement_type, quantity_change,
              quantity_before, quantity_after, order_id)
           VALUES ($1,$2,'sale',$3,$4,$5,$6)`,
          [orgId, ingredientId, -qty, before, after, orderId],
        );
        await client.query(
          `UPDATE ingredients SET current_stock = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
          [after, ingredientId, orgId],
        );
        if (after < Number(ing.reorder_point)) {
          console.warn(`[Inventory] Low stock: ${ing.name} at ${after} (reorder point ${ing.reorder_point})`);
        }
      }
    });
  } catch (err) {
    console.error('[Inventory] Deduction failed:', err instanceof Error ? err.message : String(err));
  }
}

// ── Reverse deductions when an order is voided / fully refunded ────────────────────

export async function reverseOrderIngredients(orgId: string, orderId: string): Promise<void> {
  try {
    if (!(await ingredientSystemReady())) return;

    // Idempotent — don't reverse twice.
    const { rows: already } = await query(
      `SELECT 1 FROM stock_movements
        WHERE order_id = $1 AND organization_id = $2 AND movement_type = 'sale_void' LIMIT 1`,
      [orderId, orgId],
    );
    if (already.length) return;

    const { rows: sales } = await query<{ ingredient_id: string; quantity_change: number }>(
      `SELECT ingredient_id, quantity_change FROM stock_movements
        WHERE order_id = $1 AND organization_id = $2 AND movement_type = 'sale'`,
      [orderId, orgId],
    );
    if (!sales.length) return;

    await withTransaction(async (client) => {
      for (const s of sales) {
        const reversalQty = -Number(s.quantity_change); // original was negative → add back
        const { rows: [ing] } = await client.query<{ current_stock: number }>(
          `SELECT current_stock FROM ingredients
            WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
          [s.ingredient_id, orgId],
        );
        if (!ing) continue;
        const before = Number(ing.current_stock);
        const after = before + reversalQty;
        await client.query(
          `INSERT INTO stock_movements
             (organization_id, ingredient_id, movement_type, quantity_change,
              quantity_before, quantity_after, order_id)
           VALUES ($1,$2,'sale_void',$3,$4,$5,$6)`,
          [orgId, s.ingredient_id, reversalQty, before, after, orderId],
        );
        await client.query(
          `UPDATE ingredients SET current_stock = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
          [after, s.ingredient_id, orgId],
        );
      }
    });
  } catch (err) {
    console.error('[Inventory] Reversal failed:', err instanceof Error ? err.message : String(err));
  }
}

// ── Inventory status (dashboard) ──────────────────────────────────────────────────

export interface InventoryStatusItem {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  parLevel: number;
  reorderPoint: number;
  status: 'ok' | 'low' | 'critical' | 'out';
}

export interface InventoryStatus {
  totalIngredients: number;
  lowStockCount: number;
  criticalCount: number;
  outOfStockCount: number;
  ingredients: InventoryStatusItem[];
}

export async function getInventoryStatus(orgId: string, _locationId?: string): Promise<InventoryStatus> {
  const empty: InventoryStatus = { totalIngredients: 0, lowStockCount: 0, criticalCount: 0, outOfStockCount: 0, ingredients: [] };
  if (!(await ingredientSystemReady())) return empty;

  const { rows } = await query<{
    id: string; name: string; unit: string;
    current_stock: number; par_level: number; reorder_point: number;
  }>(
    `SELECT id, name, unit, current_stock, par_level, reorder_point
       FROM ingredients WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY name ASC`,
    [orgId],
  );

  let lowStockCount = 0, criticalCount = 0, outOfStockCount = 0;
  const ingredients: InventoryStatusItem[] = rows.map((r) => {
    const stock = Number(r.current_stock);
    const par = Number(r.par_level);
    const reorder = Number(r.reorder_point);
    let status: InventoryStatusItem['status'];
    if (stock <= 0) { status = 'out'; outOfStockCount++; }
    else if (stock < reorder) { status = 'critical'; criticalCount++; }
    else if (stock < par) { status = 'low'; lowStockCount++; }
    else status = 'ok';
    return { id: r.id, name: r.name, unit: r.unit, currentStock: stock, parLevel: par, reorderPoint: reorder, status };
  });

  return {
    totalIngredients: ingredients.length,
    lowStockCount, criticalCount, outOfStockCount,
    ingredients,
  };
}

// ── Usage analytics (Session 5) ─────────────────────────────────────────────────

export interface IngredientUsage {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  totalUsed: number;       // sum of |negative movements| in window
  totalAdded: number;      // sum of positive movements in window
  netChange: number;       // totalAdded - totalUsed
  movementCount: number;
  avgDailyUsage: number;   // totalUsed / days
  daysRemaining: number | null; // current_stock / avgDailyUsage (null if no usage)
}

export async function getIngredientUsage(orgId: string, days = 7): Promise<IngredientUsage[]> {
  if (!(await ingredientSystemReady())) return [];
  const safeDays = Math.min(Math.max(Math.floor(days), 1), 90);

  const { rows } = await query<{
    ingredient_id: string; ingredient_name: string; unit: string; current_stock: number;
    total_used: string; total_added: string; net_change: string; movement_count: string;
  }>(
    `SELECT
       i.id   AS ingredient_id,
       i.name AS ingredient_name,
       i.unit,
       i.current_stock,
       COALESCE(SUM(CASE WHEN sm.quantity_change < 0 THEN ABS(sm.quantity_change) ELSE 0 END), 0) AS total_used,
       COALESCE(SUM(CASE WHEN sm.quantity_change > 0 THEN sm.quantity_change ELSE 0 END), 0)      AS total_added,
       COALESCE(SUM(sm.quantity_change), 0) AS net_change,
       COUNT(sm.id) AS movement_count
     FROM ingredients i
     LEFT JOIN stock_movements sm
       ON sm.ingredient_id = i.id
      AND sm.created_at > NOW() - ($2::int * INTERVAL '1 day')
     WHERE i.organization_id = $1 AND i.deleted_at IS NULL
     GROUP BY i.id, i.name, i.unit, i.current_stock
     ORDER BY total_used DESC`,
    [orgId, safeDays],
  );

  return rows.map((r) => {
    const totalUsed = parseFloat(r.total_used) || 0;
    const avgDailyUsage = totalUsed / safeDays;
    const currentStock = Number(r.current_stock) || 0;
    const daysRemaining = avgDailyUsage > 0 ? Math.floor(currentStock / avgDailyUsage) : null;
    return {
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      unit: r.unit,
      totalUsed,
      totalAdded: parseFloat(r.total_added) || 0,
      netChange: parseFloat(r.net_change) || 0,
      movementCount: parseInt(r.movement_count, 10) || 0,
      avgDailyUsage,
      daysRemaining,
    };
  });
}

// ── Stock alerts (Session 5) ────────────────────────────────────────────────────

export interface StockAlerts {
  critical: Array<{
    id: string; name: string; unit: string;
    currentStock: number; reorderPoint: number; parLevel: number;
    daysRemaining: number | null; suggestedOrderQty: number;
  }>;
  low: Array<{
    id: string; name: string; unit: string;
    currentStock: number; parLevel: number; daysRemaining: number | null;
  }>;
  outOfStock: Array<{ id: string; name: string; unit: string }>;
}

export async function getStockAlerts(orgId: string): Promise<StockAlerts> {
  const empty: StockAlerts = { critical: [], low: [], outOfStock: [] };
  if (!(await ingredientSystemReady())) return empty;

  const usage = await getIngredientUsage(orgId, 7);
  const usageMap = new Map(usage.map((u) => [u.ingredientId, u]));

  const { rows } = await query<{
    id: string; name: string; unit: string;
    current_stock: number; par_level: number; reorder_point: number;
  }>(
    `SELECT id, name, unit, current_stock, par_level, reorder_point
       FROM ingredients
      WHERE organization_id = $1 AND deleted_at IS NULL
        AND (current_stock = 0 OR current_stock < reorder_point OR current_stock < par_level)
      ORDER BY CASE WHEN current_stock = 0 THEN 0
                    WHEN current_stock < reorder_point THEN 1
                    ELSE 2 END,
               name ASC`,
    [orgId],
  );

  const result: StockAlerts = { critical: [], low: [], outOfStock: [] };
  for (const r of rows) {
    const stock = Number(r.current_stock);
    const reorder = Number(r.reorder_point);
    const par = Number(r.par_level);
    const daysRemaining = usageMap.get(r.id)?.daysRemaining ?? null;

    if (stock <= 0) {
      result.outOfStock.push({ id: r.id, name: r.name, unit: r.unit });
    } else if (stock < reorder) {
      result.critical.push({
        id: r.id, name: r.name, unit: r.unit,
        currentStock: stock, reorderPoint: reorder, parLevel: par,
        daysRemaining, suggestedOrderQty: Math.max(0, Math.ceil(par - stock)),
      });
    } else if (stock < par) {
      result.low.push({ id: r.id, name: r.name, unit: r.unit, currentStock: stock, parLevel: par, daysRemaining });
    }
  }
  return result;
}

// ── Dashboard summary (Session 5) ────────────────────────────────────────────────

export interface InventoryDashboard {
  summary: {
    totalIngredients: number;
    outOfStock: number;
    critical: number;
    low: number;
    ok: number;
    universalAddons: number;
    totalStockValue: number; // cents
  };
  alerts: StockAlerts;
  topUsed: Array<{
    ingredientId: string; ingredientName: string; unit: string;
    totalUsed: number; avgDailyUsage: number; daysRemaining: number | null;
  }>;
  recentMovements: Array<{
    id: string; ingredientName: string; movementType: string;
    quantityChange: number; unit: string; createdAt: string; notes: string | null;
  }>;
}

export async function getInventoryDashboard(orgId: string): Promise<InventoryDashboard> {
  const empty: InventoryDashboard = {
    summary: { totalIngredients: 0, outOfStock: 0, critical: 0, low: 0, ok: 0, universalAddons: 0, totalStockValue: 0 },
    alerts: { critical: [], low: [], outOfStock: [] },
    topUsed: [], recentMovements: [],
  };
  if (!(await ingredientSystemReady())) return empty;

  const [summaryRes, alerts, usage, movementsRes] = await Promise.all([
    query<{
      total: string; out_of_stock: string; critical: string; low: string; ok: string;
      universal_addons: string; total_stock_value: string;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE current_stock = 0) AS out_of_stock,
         COUNT(*) FILTER (WHERE current_stock > 0 AND current_stock < reorder_point) AS critical,
         COUNT(*) FILTER (WHERE current_stock >= reorder_point AND current_stock < par_level) AS low,
         COUNT(*) FILTER (WHERE current_stock >= par_level) AS ok,
         COUNT(*) FILTER (WHERE is_universal_addon = true) AS universal_addons,
         COALESCE(SUM(current_stock * cost_per_unit), 0) AS total_stock_value
       FROM ingredients
       WHERE organization_id = $1 AND deleted_at IS NULL`,
      [orgId],
    ),
    getStockAlerts(orgId),
    getIngredientUsage(orgId, 7),
    query<{
      id: string; ingredient_name: string; movement_type: string;
      quantity_change: number; unit: string; created_at: string; notes: string | null;
    }>(
      `SELECT sm.id, i.name AS ingredient_name, sm.movement_type, sm.quantity_change,
              i.unit, sm.created_at, sm.notes
         FROM stock_movements sm
         JOIN ingredients i ON i.id = sm.ingredient_id
        WHERE sm.organization_id = $1
        ORDER BY sm.created_at DESC
        LIMIT 20`,
      [orgId],
    ),
  ]);

  const s = summaryRes.rows[0];
  return {
    summary: {
      totalIngredients: parseInt(s?.total ?? '0', 10) || 0,
      outOfStock:       parseInt(s?.out_of_stock ?? '0', 10) || 0,
      critical:         parseInt(s?.critical ?? '0', 10) || 0,
      low:              parseInt(s?.low ?? '0', 10) || 0,
      ok:               parseInt(s?.ok ?? '0', 10) || 0,
      universalAddons:  parseInt(s?.universal_addons ?? '0', 10) || 0,
      totalStockValue:  Math.round(parseFloat(s?.total_stock_value ?? '0') || 0),
    },
    alerts,
    topUsed: usage.slice(0, 10).map((u) => ({
      ingredientId: u.ingredientId, ingredientName: u.ingredientName, unit: u.unit,
      totalUsed: u.totalUsed, avgDailyUsage: u.avgDailyUsage, daysRemaining: u.daysRemaining,
    })),
    recentMovements: movementsRes.rows.map((r) => ({
      id: r.id, ingredientName: r.ingredient_name, movementType: r.movement_type,
      quantityChange: Number(r.quantity_change), unit: r.unit, createdAt: r.created_at, notes: r.notes,
    })),
  };
}
