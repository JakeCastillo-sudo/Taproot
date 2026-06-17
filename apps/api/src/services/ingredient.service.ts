/**
 * ingredient.service — master ingredient library + stock management (Session 1).
 *
 * Additive + feature-flagged. Every query is scoped by organization_id. Money
 * (cost_per_unit / universal_addon_price) is INTEGER CENTS. Resilient to a
 * pending migration 028 via ingredientSystemReady().
 */

import { query, withTransaction } from '../db/client';
import { NotFoundError, ValidationError, ConflictError } from '../errors';

// ── Supported units ──────────────────────────────────────────────────────────────

export const SUPPORTED_UNITS = [
  // Weight
  { value: 'oz',    label: 'oz',     type: 'weight' },
  { value: 'g',     label: 'g',      type: 'weight' },
  { value: 'lb',    label: 'lb',     type: 'weight' },
  { value: 'kg',    label: 'kg',     type: 'weight' },
  // Volume
  { value: 'ml',    label: 'ml',     type: 'volume' },
  { value: 'l',     label: 'l',      type: 'volume' },
  { value: 'tsp',   label: 'tsp',    type: 'volume' },
  { value: 'tbsp',  label: 'tbsp',   type: 'volume' },
  { value: 'fl_oz', label: 'fl oz',  type: 'volume' },
  { value: 'cup',   label: 'cup',    type: 'volume' },
  // Count
  { value: 'qty',   label: 'qty',    type: 'count'  },
  { value: 'slice', label: 'slice',  type: 'count'  },
  { value: 'piece', label: 'piece',  type: 'count'  },
  { value: 'scoop', label: 'scoop',  type: 'count'  },
  { value: 'shot',  label: 'shot',   type: 'count'  },
  { value: 'pinch', label: 'pinch',  type: 'count'  },
  { value: 'dash',  label: 'dash',   type: 'count'  },
  // Custom
  { value: 'custom', label: 'custom', type: 'custom' },
] as const;

const UNIT_VALUES = new Set(SUPPORTED_UNITS.map((u) => u.value));

// ── Types ─────────────────────────────────────────────────────────────────────────

export interface Ingredient {
  id: string;
  organization_id: string;
  name: string;
  unit: string;
  unit_label: string | null;
  cost_per_unit: number;
  current_stock: number;
  par_level: number;
  reorder_point: number;
  is_universal_addon: boolean;
  universal_addon_price: number;
  universal_addon_label: string | null;
  category: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  organization_id: string;
  ingredient_id: string;
  movement_type: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  order_id: string | null;
  order_line_item_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreateIngredientData {
  name: string;
  unit?: string;
  unitLabel?: string | null;
  costPerUnit?: number;
  currentStock?: number;
  parLevel?: number;
  reorderPoint?: number;
  isUniversalAddon?: boolean;
  universalAddonPrice?: number;
  universalAddonLabel?: string | null;
  category?: string | null;
}

export type UpdateIngredientData = Partial<CreateIngredientData>;

// ── Migration-readiness guard (cached) ──────────────────────────────────────────

let _ready: boolean | null = null;

export async function ingredientSystemReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.ingredients') IS NOT NULL AS ready`,
    );
    _ready = Boolean(rows[0]?.ready);
  } catch {
    _ready = false;
  }
  return _ready;
}

function assertReadyError(): never {
  throw new ValidationError('Ingredient system not available — run migration 028 (ingredient_system).');
}

// ── List ───────────────────────────────────────────────────────────────────────

export async function listIngredients(
  orgId: string,
  options: { category?: string; universalOnly?: boolean; search?: string } = {},
): Promise<Ingredient[]> {
  if (!(await ingredientSystemReady())) return [];
  const conditions = ['organization_id = $1', 'deleted_at IS NULL'];
  const params: unknown[] = [orgId];
  let p = 2;
  if (options.category) { conditions.push(`category = $${p++}`); params.push(options.category); }
  if (options.universalOnly) { conditions.push(`is_universal_addon = true`); }
  if (options.search) { conditions.push(`name ILIKE $${p++}`); params.push(`%${options.search}%`); }

  const { rows } = await query<Ingredient>(
    `SELECT * FROM ingredients WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(category, '') ASC, name ASC`,
    params,
  );
  return rows;
}

// ── Get one ──────────────────────────────────────────────────────────────────────

export async function getIngredient(orgId: string, ingredientId: string): Promise<Ingredient> {
  if (!(await ingredientSystemReady())) throw new NotFoundError('Ingredient');
  const { rows: [row] } = await query<Ingredient>(
    `SELECT * FROM ingredients WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [ingredientId, orgId],
  );
  if (!row) throw new NotFoundError('Ingredient');
  return row;
}

// ── Create ───────────────────────────────────────────────────────────────────────

export async function createIngredient(orgId: string, data: CreateIngredientData): Promise<Ingredient> {
  if (!(await ingredientSystemReady())) assertReadyError();
  if (!data.name?.trim()) throw new ValidationError('Ingredient name is required');

  const unit = data.unit ?? 'qty';
  if (!UNIT_VALUES.has(unit as (typeof SUPPORTED_UNITS)[number]['value'])) {
    throw new ValidationError(`Unsupported unit "${unit}"`);
  }
  if (unit === 'custom' && !data.unitLabel?.trim()) {
    throw new ValidationError('unitLabel is required when unit is "custom"');
  }

  const { rows: [row] } = await query<Ingredient>(
    `INSERT INTO ingredients
       (organization_id, name, unit, unit_label, cost_per_unit,
        current_stock, par_level, reorder_point,
        is_universal_addon, universal_addon_price, universal_addon_label, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      orgId, data.name.trim(), unit, unit === 'custom' ? (data.unitLabel?.trim() ?? null) : null,
      Math.round(data.costPerUnit ?? 0),
      data.currentStock ?? 0, data.parLevel ?? 0, data.reorderPoint ?? 0,
      data.isUniversalAddon ?? false, Math.round(data.universalAddonPrice ?? 0),
      data.universalAddonLabel?.trim() || null, data.category?.trim() || null,
    ],
  );
  return row;
}

// ── Update ───────────────────────────────────────────────────────────────────────

export async function updateIngredient(
  orgId: string,
  ingredientId: string,
  data: UpdateIngredientData,
): Promise<Ingredient> {
  if (!(await ingredientSystemReady())) assertReadyError();
  const existing = await getIngredient(orgId, ingredientId);

  // Unit changes would corrupt historical movement quantities.
  if (data.unit !== undefined && data.unit !== existing.unit) {
    const { rows } = await query(
      `SELECT 1 FROM stock_movements WHERE ingredient_id = $1 AND organization_id = $2 LIMIT 1`,
      [ingredientId, orgId],
    );
    if (rows.length) throw new ConflictError('Cannot change unit after stock movements exist');
    if (!UNIT_VALUES.has(data.unit as (typeof SUPPORTED_UNITS)[number]['value'])) {
      throw new ValidationError(`Unsupported unit "${data.unit}"`);
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if (data.unit !== undefined) add('unit', data.unit);
  if (data.unitLabel !== undefined) add('unit_label', data.unitLabel?.trim() || null);
  if (data.costPerUnit !== undefined) add('cost_per_unit', Math.round(data.costPerUnit));
  if (data.parLevel !== undefined) add('par_level', data.parLevel);
  if (data.reorderPoint !== undefined) add('reorder_point', data.reorderPoint);
  if (data.isUniversalAddon !== undefined) add('is_universal_addon', data.isUniversalAddon);
  if (data.universalAddonPrice !== undefined) add('universal_addon_price', Math.round(data.universalAddonPrice));
  if (data.universalAddonLabel !== undefined) add('universal_addon_label', data.universalAddonLabel?.trim() || null);
  if (data.category !== undefined) add('category', data.category?.trim() || null);

  if (sets.length === 0) return existing;

  sets.push('updated_at = now()');
  params.push(ingredientId, orgId);
  const { rows: [row] } = await query<Ingredient>(
    `UPDATE ingredients SET ${sets.join(', ')}
      WHERE id = $${p++} AND organization_id = $${p} AND deleted_at IS NULL
      RETURNING *`,
    params,
  );
  if (!row) throw new NotFoundError('Ingredient');
  return row;
}

// ── Delete (soft) ──────────────────────────────────────────────────────────────

export async function deleteIngredient(orgId: string, ingredientId: string): Promise<{ success: true }> {
  if (!(await ingredientSystemReady())) assertReadyError();
  await getIngredient(orgId, ingredientId); // 404 if missing/wrong org

  const { rows: used } = await query(
    `SELECT 1 FROM product_ingredients WHERE ingredient_id = $1 AND organization_id = $2 LIMIT 1`,
    [ingredientId, orgId],
  );
  if (used.length) throw new ConflictError('Cannot delete an ingredient used in a recipe — remove it from recipes first');

  await query(
    `UPDATE ingredients SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [ingredientId, orgId],
  );
  return { success: true };
}

// ── Adjust stock (manual) ────────────────────────────────────────────────────────

export interface AdjustStockData {
  quantityChange: number;       // positive = add, negative = remove
  movementType: string;         // manual_add | manual_remove | adjustment | waste
  notes?: string;
  employeeId?: string;
}

export async function adjustStock(
  orgId: string,
  ingredientId: string,
  data: AdjustStockData,
): Promise<{ newStock: number; movement: StockMovement }> {
  if (!(await ingredientSystemReady())) assertReadyError();
  if (!Number.isFinite(data.quantityChange) || data.quantityChange === 0) {
    throw new ValidationError('quantityChange must be a non-zero number');
  }

  return withTransaction(async (client) => {
    const { rows: [ing] } = await client.query<{ current_stock: number }>(
      `SELECT current_stock FROM ingredients
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [ingredientId, orgId],
    );
    if (!ing) throw new NotFoundError('Ingredient');

    const before = Number(ing.current_stock);
    const after = before + data.quantityChange;

    const { rows: [movement] } = await client.query<StockMovement>(
      `INSERT INTO stock_movements
         (organization_id, ingredient_id, movement_type, quantity_change,
          quantity_before, quantity_after, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [orgId, ingredientId, data.movementType, data.quantityChange, before, after, data.notes ?? null, data.employeeId ?? null],
    );

    await client.query(
      `UPDATE ingredients SET current_stock = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
      [after, ingredientId, orgId],
    );

    return { newStock: after, movement };
  });
}

// ── Stock movement history ───────────────────────────────────────────────────────

export async function getStockMovements(
  orgId: string,
  ingredientId: string,
  options: { limit?: number; since?: string } = {},
): Promise<StockMovement[]> {
  if (!(await ingredientSystemReady())) return [];
  const conditions = ['organization_id = $1', 'ingredient_id = $2'];
  const params: unknown[] = [orgId, ingredientId];
  let p = 3;
  if (options.since) { conditions.push(`created_at >= $${p++}`); params.push(options.since); }
  const limit = Math.min(options.limit ?? 100, 500);

  const { rows } = await query<StockMovement>(
    `SELECT * FROM stock_movements WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC LIMIT $${p}`,
    [...params, limit],
  );
  return rows;
}

// ── Universal add-ons ────────────────────────────────────────────────────────────

export async function listUniversalAddons(orgId: string): Promise<Ingredient[]> {
  if (!(await ingredientSystemReady())) return [];
  const { rows } = await query<Ingredient>(
    `SELECT * FROM ingredients
      WHERE organization_id = $1 AND deleted_at IS NULL AND is_universal_addon = true
      ORDER BY name ASC`,
    [orgId],
  );
  return rows;
}
