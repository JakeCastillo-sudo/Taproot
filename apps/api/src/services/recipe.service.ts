import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import {
  RecipeNotFoundError, RecipeValidationError, CircularRecipeError, ProductNotFoundError,
} from '../errors';
import type {
  Recipe, RecipeLine, DepletionResult, AppliedModifier, UnitOfMeasure,
} from '@taproot/shared';

// ─── Unit compatibility ───────────────────────────────────────────────────────

// Groups of interchangeable units (conversion families)
const UNIT_FAMILIES: Record<string, string> = {
  ml: 'volume', l: 'volume',
  g: 'mass', kg: 'mass',
  oz: 'us_weight', lb: 'us_weight',
  each: 'count',
  m: 'length', ft: 'length',
};

export function unitsAreCompatible(recipeUnit: string, productUom: string): boolean {
  const rf = UNIT_FAMILIES[recipeUnit];
  const pf = UNIT_FAMILIES[productUom];
  if (!rf || !pf) return false;
  return rf === pf;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecipeLineInput {
  ingredientProductId: string;
  ingredientVariantId?: string;
  quantity: number;
  unit: string;
  wasteFactor: number;
}

export interface CreateRecipeData {
  name: string;
  yieldFactor: number;
  notes?: string;
  lines: RecipeLineInput[];
}

export interface RecipeWithLines extends Recipe {
  lines: RecipeLine[];
}

// ─── Circular reference detection ─────────────────────────────────────────────

async function detectCircularRef(
  rootProductId: string,
  ingredientProductId: string,
  visited = new Set<string>(),
): Promise<string[] | null> {
  if (ingredientProductId === rootProductId) return [ingredientProductId];
  if (visited.has(ingredientProductId)) return null;
  visited.add(ingredientProductId);

  const { rows } = await query<{ id: string }>(
    `SELECT id FROM recipes WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
    [ingredientProductId],
  );
  if (!rows.length) return null;

  const { rows: lines } = await query<{ ingredient_product_id: string }>(
    `SELECT ingredient_product_id FROM recipe_lines WHERE recipe_id = $1`,
    [rows[0].id],
  );

  for (const line of lines) {
    const chain = await detectCircularRef(rootProductId, line.ingredient_product_id, new Set(visited));
    if (chain) return [ingredientProductId, ...chain];
  }
  return null;
}

// ─── validateRecipeUnits ──────────────────────────────────────────────────────

export async function validateRecipeUnits(lines: RecipeLineInput[]): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { rows: [product] } = await query<{ unit_of_measure: UnitOfMeasure; name: string }>(
      `SELECT unit_of_measure, name FROM products WHERE id = $1 AND deleted_at IS NULL`,
      [line.ingredientProductId],
    );
    if (!product) {
      throw new RecipeValidationError(
        `Ingredient product not found`, i + 1, 'ingredientProductId', 'Product does not exist',
      );
    }
    if (!unitsAreCompatible(line.unit, product.unit_of_measure)) {
      throw new RecipeValidationError(
        `Unit "${line.unit}" is not compatible with "${product.name}" (measured in ${product.unit_of_measure})`,
        i + 1, 'unit', `${line.unit} and ${product.unit_of_measure} are different measurement families`,
      );
    }
    if (line.quantity <= 0) {
      throw new RecipeValidationError(`Quantity must be greater than 0`, i + 1, 'quantity', 'Must be positive');
    }
    if (line.wasteFactor < 0 || line.wasteFactor >= 1) {
      throw new RecipeValidationError(`Waste factor must be between 0 and 0.99`, i + 1, 'wasteFactor', 'Out of range');
    }
  }
}

// ─── createOrUpdateRecipe ─────────────────────────────────────────────────────

export async function createOrUpdateRecipe(
  orgId: string,
  productId: string,
  data: CreateRecipeData,
  employeeId: string,
): Promise<RecipeWithLines> {
  if (data.yieldFactor < 0.01 || data.yieldFactor > 1.0) {
    throw new RecipeValidationError('yieldFactor must be between 0.01 and 1.0', undefined, 'yieldFactor', 'Out of range');
  }

  // Verify product belongs to org
  const { rows: [product] } = await query(
    `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  // Validate units
  await validateRecipeUnits(data.lines);

  // Validate all ingredient products belong to org
  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    const { rows: [ingProd] } = await query(
      `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [line.ingredientProductId, orgId],
    );
    if (!ingProd) {
      throw new RecipeValidationError(
        `Ingredient product ${line.ingredientProductId} not found in this organization`,
        i + 1, 'ingredientProductId', 'Not found or wrong org',
      );
    }

    // Check circular references
    const chain = await detectCircularRef(productId, line.ingredientProductId);
    if (chain) throw new CircularRecipeError([productId, ...chain]);
  }

  const recipeId = await withTransaction(async (client) => {
    // Get or create recipe
    const { rows: existing } = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM recipes WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
      [productId],
    );

    let recId: string;
    let newVersion: number;

    if (existing.length) {
      recId = existing[0].id;
      newVersion = existing[0].version + 1;
      await client.query(
        `UPDATE recipes SET name = $1, yield_factor = $2, notes = $3, version = $4, updated_at = now()
         WHERE id = $5`,
        [data.name, data.yieldFactor, data.notes ?? null, newVersion, recId],
      );
      // Soft-delete existing lines (versioning)
      await client.query(`DELETE FROM recipe_lines WHERE recipe_id = $1`, [recId]);
    } else {
      const { rows: [rec] } = await client.query<{ id: string }>(
        `INSERT INTO recipes (product_id, organization_id, name, yield_factor, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [productId, orgId, data.name, data.yieldFactor, data.notes ?? null, employeeId],
      );
      recId = rec.id;
      newVersion = 1;
    }

    // Insert new recipe lines
    for (const line of data.lines) {
      await client.query(
        `INSERT INTO recipe_lines
           (recipe_id, ingredient_product_id, ingredient_variant_id, quantity, unit, waste_factor, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          recId, line.ingredientProductId, line.ingredientVariantId ?? null,
          line.quantity, line.unit, line.wasteFactor, null,
        ],
      );
    }

    return recId;
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'recipe.update', resourceType: 'recipe', resourceId: recipeId,
  });

  return getRecipe(orgId, productId);
}

// ─── getRecipe ────────────────────────────────────────────────────────────────

export async function getRecipe(orgId: string, productId: string): Promise<RecipeWithLines> {
  const { rows: [recipe] } = await query<Recipe>(
    `SELECT * FROM recipes WHERE product_id = $1 AND organization_id = $2 AND is_active = true AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!recipe) throw new RecipeNotFoundError(productId);

  const { rows: lines } = await query<RecipeLine>(
    `SELECT * FROM recipe_lines WHERE recipe_id = $1 ORDER BY created_at`,
    [recipe.id],
  );

  return { ...recipe, lines };
}

// ─── calculateDepletionForSale ────────────────────────────────────────────────
// Pure calculation — reads recipe from DB but never writes. Deterministic.

export async function calculateDepletionForSale(
  productId: string,
  _variantId: string | null,
  quantity: number,
  modifiers: AppliedModifier[],
): Promise<DepletionResult[]> {
  if (quantity === 0) return [];

  const { rows } = await query<{
    yield_factor: string;
    ingredient_product_id: string;
    ingredient_variant_id: string | null;
    line_qty: string;
    unit: string;
    waste_factor: string;
  }>(
    `SELECT r.yield_factor,
            rl.ingredient_product_id, rl.ingredient_variant_id,
            rl.quantity AS line_qty, rl.unit, rl.waste_factor
     FROM recipes r
     JOIN recipe_lines rl ON rl.recipe_id = r.id
     WHERE r.product_id = $1 AND r.is_active = true AND r.deleted_at IS NULL`,
    [productId],
  );

  if (!rows.length) return [];

  // WG-007: guard against NULL/0/negative yield_factor (NaN/Infinity divisor) and
  // NULL waste_factor (NaN). A yield of 0/null is meaningless → treat as 1 (no loss).
  const parsedYield = parseFloat(rows[0].yield_factor);
  const yieldFactor = (!isFinite(parsedYield) || parsedYield <= 0) ? 1 : parsedYield;
  const results: DepletionResult[] = [];

  for (const row of rows) {
    let lineQty = parseFloat(row.line_qty);
    const parsedWaste = parseFloat(row.waste_factor);
    const wasteFactor = isFinite(parsedWaste) ? parsedWaste : 0;

    // Apply modifier ingredient overrides
    for (const mod of modifiers) {
      for (const override of mod.ingredientOverrides ?? []) {
        if (override.ingredientProductId === row.ingredient_product_id) {
          lineQty += override.quantityDelta;
        }
      }
    }

    // Core formula: depletionQty = (lineQty × (1 + wasteFactor)) / yieldFactor × quantitySold
    const depletionQty = (lineQty * (1 + wasteFactor)) / yieldFactor * quantity;

    results.push({
      ingredientProductId: row.ingredient_product_id,
      ingredientVariantId: row.ingredient_variant_id ?? null,
      depletionQty,
      unit: row.unit,
    });
  }

  return results;
}

// ─── getTheoreticalUsage ──────────────────────────────────────────────────────

export async function getTheoreticalUsage(
  orgId: string,
  locationId: string,
  productIds: string[],
  startTs: Date,
  endTs: Date,
): Promise<Array<{ ingredientProductId: string; theoreticalQty: number; unit: string }>> {
  if (!productIds.length) return [];

  // Query all sold line items for these products in the period
  const { rows: lineItems } = await query<{
    product_id: string;
    variant_id: string | null;
    quantity: string;
    modifiers: string;
  }>(
    `SELECT oli.product_id, oli.variant_id, oli.quantity, oli.modifiers
     FROM order_line_items oli
     JOIN orders o ON o.id = oli.order_id
     WHERE o.organization_id = $1
       AND o.location_id = $2
       AND o.status = 'completed'
       AND o.fulfilled_at >= $3
       AND o.fulfilled_at < $4
       AND oli.product_id = ANY($5::uuid[])
       AND oli.voided_at IS NULL`,
    [orgId, locationId, startTs, endTs, productIds],
  );

  // Aggregate depletion per ingredient
  const totals = new Map<string, { qty: number; unit: string }>();

  for (const item of lineItems) {
    const mods: AppliedModifier[] = typeof item.modifiers === 'string'
      ? JSON.parse(item.modifiers)
      : item.modifiers;

    const depletions = await calculateDepletionForSale(
      item.product_id,
      item.variant_id,
      parseFloat(item.quantity),
      mods,
    );

    for (const d of depletions) {
      const key = d.ingredientProductId;
      const existing = totals.get(key);
      if (existing) {
        existing.qty += d.depletionQty;
      } else {
        totals.set(key, { qty: d.depletionQty, unit: d.unit });
      }
    }
  }

  return Array.from(totals.entries()).map(([ingredientProductId, { qty, unit }]) => ({
    ingredientProductId,
    theoreticalQty: qty,
    unit,
  }));
}
