import crypto from 'crypto';
import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { invalidateOrgCache } from '../lib/cache';
import {
  ProductNotFoundError, ConflictError, ValidationError,
} from '../errors';
import type {
  Product, ProductVariant, ProductPrice, Recipe, RecipeLine,
  ProductWithRelations, UnitOfMeasure, ProductType,
} from '@taproot/shared';

// ─── PRODUCT STATE RULE ───────────────────────────────────────────────────────
//
// Products have THREE states. EVERY query that lists products for the POS or
// cashier MUST filter BOTH columns:
//   WHERE p.deleted_at IS NULL AND p.archived_at IS NULL
//
// State | deleted_at | archived_at | Visible in POS | Visible in Admin
// ------+------------+-------------+----------------+------------------
// Active  | NULL       | NULL        | YES            | YES
// Archived| NULL       | SET         | NO             | YES (Archive tab)
// Deleted | SET        | any         | NO             | NO
//
// See docs/ARCHITECTURE.md for the full product state machine.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Valid meal-period values for day-part filtering. */
export const VALID_DAY_PARTS = ['breakfast', 'brunch', 'lunch', 'dinner'] as const;

/** A single modifier option within a group. */
export interface ModifierOptionData {
  id:         string;
  name:       string;
  priceDelta: number;  // cents, may be negative
  isDefault:  boolean;
  sortOrder:  number;
}

/** A modifier group attached to a product. */
export interface ModifierGroupData {
  id:            string;
  name:          string;
  selectionType: 'single' | 'multiple' | 'required_single' | 'required_multiple';
  minSelections: number;
  maxSelections: number | null;
  sortOrder:     number;
  modifiers:     ModifierOptionData[];
}

/** ProductWithRelations extended with POS-facing modifier groups. */
export type ProductWithModifiers = ProductWithRelations & {
  modifierGroups: ModifierGroupData[];
};
export type DayPart = typeof VALID_DAY_PARTS[number];

export interface CreateProductData {
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;
  categoryId?: string;
  supplierId?: string;
  productType?: ProductType;
  unitOfMeasure?: UnitOfMeasure;
  costPrice?: number;
  trackInventory?: boolean;
  isActive?: boolean;
  tags?: string[];
  /** Restrict visibility to specific meal periods. null/[] = always visible. */
  dayParts?: string[];
  /**
   * Selling price in CENTS for the auto-created default variant. When provided
   * (> 0), createProduct also inserts a "Default" variant + active price row so
   * the product is immediately sellable and shows a price on the POS register.
   */
  price?: number;
}

export interface UpdateProductData {
  name?: string;
  description?: string;
  sku?: string;
  barcode?: string;
  categoryId?: string | null;
  supplierId?: string | null;
  productType?: ProductType;
  unitOfMeasure?: UnitOfMeasure;
  costPrice?: number;
  trackInventory?: boolean;
  isActive?: boolean;
  tags?: string[];
  /** Restrict visibility to specific meal periods. null/[] = always visible. */
  dayParts?: string[] | null;
  /**
   * New selling price in CENTS. When provided (> 0), updateProduct expires the
   * active price on the product's default variant and inserts a new one.
   */
  price?: number;
  /** FDA Big 9 allergens present in this item (S8-05). null/[] = none. */
  allergens?: string[] | null;
  /** Free-text allergen notes for staff/kitchen. */
  allergenNotes?: string | null;
}

export interface ListProductsFilters {
  categoryId?: string;
  supplierId?: string;
  isActive?: boolean;
  search?: string;
  productType?: ProductType;
  locationId?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'cost_price';
  sortOrder?: 'ASC' | 'DESC';
  /**
   * Additive day-part filter.
   * 'all' or undefined → no filter (all products returned).
   * Specific value → only products with matching day_parts or no day_parts assigned.
   */
  dayPart?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSku(): string {
  // eslint-disable-next-line no-secrets/no-secrets
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `TAP-${rand}`;
}

async function ensureUniqueSku(orgId: string, sku: string): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM products WHERE organization_id = $1 AND sku = $2 AND deleted_at IS NULL LIMIT 1`,
    [orgId, sku],
  );
  if (rows.length) throw new ConflictError(`SKU "${sku}" already exists in this organization`);
}

async function buildProductWithRelations(productId: string): Promise<ProductWithModifiers> {
  const [{ rows: [product] }, { rows: variants }, { rows: prices }, { rows: recipeRows }, { rows: lineRows }, { rows: modGroupRows }] =
    await Promise.all([
      query<Product>(`SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL`, [productId]),
      query<ProductVariant>(`SELECT * FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL ORDER BY sort_order`, [productId]),
      query<ProductPrice>(`SELECT pp.* FROM product_prices pp
        JOIN product_variants pv ON pv.id = pp.variant_id
        WHERE pv.product_id = $1 AND pp.is_active = true AND (pp.effective_until IS NULL OR pp.effective_until > now())
        ORDER BY pp.effective_from DESC`, [productId]),
      query<Recipe>(`SELECT * FROM recipes WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`, [productId]),
      query<RecipeLine>(`SELECT rl.* FROM recipe_lines rl
        JOIN recipes r ON r.id = rl.recipe_id
        WHERE r.product_id = $1 AND r.is_active = true AND r.deleted_at IS NULL`, [productId]),
      // Modifier groups with their options, aggregated per group
      query<{
        id: string; name: string; selection_type: string;
        min_selections: number; max_selections: number | null;
        sort_order: number;
        modifiers: ModifierOptionData[] | null;
      }>(`
        SELECT
          mg.id, mg.name, mg.selection_type, mg.min_selections, mg.max_selections,
          pmg.sort_order,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'id',         mo.id,
                'name',       mo.name,
                'priceDelta', mo.price_delta,
                'isDefault',  mo.is_default,
                'sortOrder',  mo.sort_order
              ) ORDER BY mo.sort_order ASC
            ) FILTER (WHERE mo.id IS NOT NULL),
            '[]'::json
          ) AS modifiers
        FROM product_modifier_groups pmg
        JOIN modifier_groups mg ON mg.id = pmg.modifier_group_id
          AND mg.deleted_at IS NULL AND mg.is_active = true
        LEFT JOIN modifiers mo ON mo.group_id = mg.id
          AND mo.deleted_at IS NULL AND mo.is_active = true
        WHERE pmg.product_id = $1
        GROUP BY mg.id, mg.name, mg.selection_type, mg.min_selections, mg.max_selections, pmg.sort_order
        ORDER BY pmg.sort_order ASC, mg.sort_order ASC`,
      [productId]),
    ]);

  if (!product) throw new ProductNotFoundError(productId);

  const recipe = recipeRows[0] ? { ...recipeRows[0], lines: lineRows } : null;

  const modifierGroups: ModifierGroupData[] = modGroupRows.map((g) => ({
    id:            g.id,
    name:          g.name,
    selectionType: g.selection_type as ModifierGroupData['selectionType'],
    minSelections: g.min_selections,
    maxSelections: g.max_selections,
    sortOrder:     g.sort_order,
    modifiers:     g.modifiers ?? [],
  }));

  return { ...product, variants, prices, recipe, modifierGroups };
}

// ─── createProduct ────────────────────────────────────────────────────────────

export async function createProduct(
  orgId: string,
  _locationId: string,
  data: CreateProductData,
  employeeId: string,
): Promise<ProductWithModifiers> {
  if (!data.name?.trim()) throw new ValidationError('Product name is required');

  // Validate category belongs to org
  if (data.categoryId) {
    const { rows } = await query(
      `SELECT id FROM categories WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [data.categoryId, orgId],
    );
    if (!rows.length) throw new ValidationError('Category not found in this organization');
  }

  // Validate supplier belongs to org
  if (data.supplierId) {
    const { rows } = await query(
      `SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [data.supplierId, orgId],
    );
    if (!rows.length) throw new ValidationError('Supplier not found in this organization');
  }

  // Resolve SKU
  let sku = data.sku?.trim() ?? null;
  if (sku) {
    await ensureUniqueSku(orgId, sku);
  } else {
    // Generate unique SKU with collision retry
    for (let i = 0; i < 5; i++) {
      const candidate = generateSku();
      const { rows } = await query(
        `SELECT id FROM products WHERE organization_id = $1 AND sku = $2 AND deleted_at IS NULL`,
        [orgId, candidate],
      );
      if (!rows.length) { sku = candidate; break; }
    }
    if (!sku) throw new ConflictError('Could not generate unique SKU — retry');
  }

  const productType: ProductType = data.productType ?? 'standard';
  const unitOfMeasure: UnitOfMeasure = data.unitOfMeasure ?? 'each';

  const productId = await withTransaction(async (client) => {
    const { rows: [prod] } = await client.query<{ id: string }>(
      `INSERT INTO products
         (organization_id, category_id, supplier_id, name, description,
          sku, barcode, product_type, unit_of_measure, cost_price,
          track_inventory, is_active, tags, day_parts, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        orgId, data.categoryId ?? null, data.supplierId ?? null,
        data.name.trim(), data.description ?? null,
        sku, data.barcode ?? null, productType, unitOfMeasure,
        data.costPrice ?? 0, data.trackInventory ?? true,
        data.isActive ?? true,
        data.tags ? `{${data.tags.map(t => `"${t}"`).join(',')}}` : null,
        // day_parts: null / empty array → always visible (additive filter)
        data.dayParts && data.dayParts.length > 0 ? `{${data.dayParts.join(',')}}` : null,
        employeeId,
      ],
    );

    // Default variant + active price so the product is immediately sellable.
    // Price is stored in CENTS (integer); POS reads prices[] via buildProductWithRelations.
    const { rows: [variant] } = await client.query<{ id: string }>(
      `INSERT INTO product_variants
         (product_id, organization_id, name, cost_price, is_active, sort_order)
       VALUES ($1, $2, 'Default', $3, true, 0)
       RETURNING id`,
      [prod.id, orgId, data.costPrice ?? 0],
    );
    if (data.price !== undefined && data.price > 0) {
      await client.query(
        `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
         VALUES ($1, NULL, $2, 'USD', now())`,
        [variant.id, data.price],
      );
    }

    // If recipe product, create empty recipe record
    if (productType === 'recipe') {
      await client.query(
        `INSERT INTO recipes (product_id, organization_id, name, yield_factor, created_by)
         VALUES ($1, $2, $3, 1.0, $4)`,
        [prod.id, orgId, `${data.name.trim()} Recipe`, employeeId],
      );
    }

    // Create inventory_levels for every active location in the org
    if (data.trackInventory !== false) {
      const { rows: locations } = await client.query<{ id: string }>(
        `SELECT id FROM locations WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL`,
        [orgId],
      );
      for (const loc of locations) {
        await client.query(
          `INSERT INTO inventory_levels (organization_id, location_id, product_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [orgId, loc.id, prod.id],
        );
      }
    }

    return prod.id;
  });

  void invalidateOrgCache(orgId, ['products', 'categories']);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'product.create', resourceType: 'product', resourceId: productId });

  return buildProductWithRelations(productId);
}

// ─── updateProduct ────────────────────────────────────────────────────────────

export async function updateProduct(
  orgId: string,
  productId: string,
  data: UpdateProductData,
  employeeId: string,
): Promise<ProductWithModifiers> {
  const { rows: [before] } = await query<Product>(
    `SELECT * FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!before) throw new ProductNotFoundError(productId);

  if (data.categoryId !== undefined && data.categoryId !== null) {
    const { rows } = await query(
      `SELECT id FROM categories WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [data.categoryId, orgId],
    );
    if (!rows.length) throw new ValidationError('Category not found');
  }

  if (data.sku && data.sku !== before.sku) await ensureUniqueSku(orgId, data.sku);

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;

  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if (data.description !== undefined) add('description', data.description);
  if (data.sku !== undefined) add('sku', data.sku);
  if (data.barcode !== undefined) add('barcode', data.barcode);
  if ('categoryId' in data) add('category_id', data.categoryId);
  if ('supplierId' in data) add('supplier_id', data.supplierId);
  if (data.productType !== undefined) add('product_type', data.productType);
  if (data.unitOfMeasure !== undefined) add('unit_of_measure', data.unitOfMeasure);
  if (data.costPrice !== undefined) add('cost_price', data.costPrice);
  if (data.trackInventory !== undefined) add('track_inventory', data.trackInventory);
  if (data.isActive !== undefined) add('is_active', data.isActive);

  // Allergens (S8-05) — requires migration 019
  if ('allergens' in data || 'allergenNotes' in data) {
    if (!(await allergenColumnsExist())) {
      throw new ValidationError('Allergen tagging requires migration 019 — ask your administrator to run pending migrations.');
    }
    if ('allergens' in data) {
      const clean = sanitizeAllergens(data.allergens);
      add('allergens', clean ? `{${clean.join(',')}}` : null);
    }
    if ('allergenNotes' in data) add('allergen_notes', data.allergenNotes?.trim() || null);
  }
  if (data.tags !== undefined) add('tags', data.tags ? `{${data.tags.map(t => `"${t}"`).join(',')}}` : null);
  // day_parts: null / empty array → visible in all day parts
  if ('dayParts' in data) {
    add('day_parts', data.dayParts && data.dayParts.length > 0 ? `{${data.dayParts.join(',')}}` : null);
  }

  // Price update on the default variant (expire current active price, insert new)
  if (data.price !== undefined && data.price > 0) {
    const { rows: [variant] } = await query<{ id: string }>(
      `SELECT id FROM product_variants
        WHERE product_id = $1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
      [productId],
    );
    if (variant) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE product_prices
              SET effective_until = now(), updated_at = now(), is_active = false
            WHERE variant_id = $1 AND location_id IS NULL AND currency = 'USD'
              AND is_active = true
              AND (effective_until IS NULL OR effective_until > now())`,
          [variant.id],
        );
        await client.query(
          `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
           VALUES ($1, NULL, $2, 'USD', now())`,
          [variant.id, data.price],
        );
      });
    } else {
      // No variant yet (legacy product) — create a default one with the price
      const { rows: [v] } = await query<{ id: string }>(
        `INSERT INTO product_variants (product_id, organization_id, name, is_active, sort_order)
         VALUES ($1, $2, 'Default', true, 0) RETURNING id`,
        [productId, orgId],
      );
      await query(
        `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
         VALUES ($1, NULL, $2, 'USD', now())`,
        [v.id, data.price],
      );
    }
  }

  if (sets.length === 0) return buildProductWithRelations(productId);

  sets.push(`updated_at = now()`);
  params.push(productId, orgId);

  await query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`,
    params,
  );

  void invalidateOrgCache(orgId, ['products', 'categories']);
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'product.update', resourceType: 'product', resourceId: productId,
    beforeState: before as unknown as Record<string, unknown>,
  });

  return buildProductWithRelations(productId);
}

// ─── deleteProduct ────────────────────────────────────────────────────────────

// ─── Corporate-item lock (franchise mode, S8-01) ─────────────────────────────
// Franchisees cannot archive/delete products pushed by their franchisor
// (products.corporate_source_id set, org_type = 'franchisee'). Local guard
// (not imported from franchise.service) to avoid a circular import; resilient
// while migration 017 is pending.

// ─── Allergen columns (migration 019) resilience ──────────────────────────────

export const FDA_ALLERGENS = [
  'milk', 'eggs', 'fish', 'shellfish', 'tree_nuts',
  'peanuts', 'wheat', 'soybeans', 'sesame',
] as const;

let _allergenColsExist: boolean | null = null;

export async function allergenColumnsExist(): Promise<boolean> {
  if (_allergenColsExist !== null) return _allergenColsExist;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'allergens'
     ) AS ready`,
  );
  _allergenColsExist = Boolean(rows[0]?.ready);
  return _allergenColsExist;
}

function sanitizeAllergens(values: string[] | null | undefined): string[] | null {
  if (!values || !values.length) return null;
  const valid = values.filter((v): v is (typeof FDA_ALLERGENS)[number] =>
    (FDA_ALLERGENS as readonly string[]).includes(v));
  return valid.length ? valid : null;
}

let _franchiseColsExist: boolean | null = null;

async function corporateLockCheck(orgId: string, productId: string): Promise<void> {
  if (_franchiseColsExist === null) {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'corporate_source_id'
       ) AS ready`,
    );
    _franchiseColsExist = Boolean(rows[0]?.ready);
  }
  if (!_franchiseColsExist) return;

  const { rows: [row] } = await query<{ corporate_source_id: string | null; org_type: string }>(
    `SELECT p.corporate_source_id, o.org_type
       FROM products p
       JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = $1 AND p.organization_id = $2`,
    [productId, orgId],
  );
  if (row && row.corporate_source_id != null && row.org_type === 'franchisee') {
    throw new ConflictError('This is a corporate menu item managed by your franchisor — it cannot be removed.');
  }
}

export async function deleteProduct(
  orgId: string,
  productId: string,
  employeeId: string,
): Promise<void> {
  const { rows: [product] } = await query<Product>(
    `SELECT * FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  await corporateLockCheck(orgId, productId);

  // Block delete if referenced by open orders
  const { rows: openOrders } = await query(
    `SELECT 1 FROM order_line_items oli
     JOIN orders o ON o.id = oli.order_id
     WHERE oli.product_id = $1 AND o.status IN ('open','in_progress') AND o.voided_at IS NULL
     LIMIT 1`,
    [productId],
  );
  if (openOrders.length) {
    throw new ConflictError('Cannot delete a product referenced by open orders');
  }

  await query(
    `UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2`,
    [productId, orgId],
  );

  void invalidateOrgCache(orgId, ['products', 'categories']);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'product.delete', resourceType: 'product', resourceId: productId });
}

// ─── getProduct ───────────────────────────────────────────────────────────────

export async function getProduct(orgId: string, productId: string): Promise<ProductWithModifiers> {
  const { rows: [exists] } = await query(
    `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!exists) throw new ProductNotFoundError(productId);
  return buildProductWithRelations(productId);
}

// ─── listProducts ─────────────────────────────────────────────────────────────

export async function listProducts(
  orgId: string,
  filters: ListProductsFilters = {},
): Promise<{ products: ProductWithModifiers[]; total: number; page: number }> {
  const {
    page = 1, limit: rawLimit = 50,
    sortBy = 'name', sortOrder = 'ASC',
  } = filters;
  const limit = Math.min(rawLimit, 200);
  const offset = (page - 1) * limit;

  // PRODUCT STATE RULE: both conditions required so archived items stay hidden from POS
  const conditions: string[] = ['p.organization_id = $1', 'p.deleted_at IS NULL', 'p.archived_at IS NULL'];
  const params: unknown[] = [orgId];
  let p = 2;

  if (filters.categoryId) { conditions.push(`p.category_id = $${p++}`); params.push(filters.categoryId); }
  if (filters.supplierId) { conditions.push(`p.supplier_id = $${p++}`); params.push(filters.supplierId); }
  if (filters.isActive !== undefined) { conditions.push(`p.is_active = $${p++}`); params.push(filters.isActive); }
  if (filters.productType) { conditions.push(`p.product_type = $${p++}`); params.push(filters.productType); }
  if (filters.search) {
    conditions.push(`(p.name ILIKE $${p} OR p.sku ILIKE $${p} OR p.barcode ILIKE $${p} OR p.description ILIKE $${p})`);
    params.push(`%${filters.search}%`); p++;
  }
  if (filters.locationId) {
    // Only products that have an inventory_levels row at this location (or don't track inventory)
    conditions.push(`(p.track_inventory = false OR EXISTS (
      SELECT 1 FROM inventory_levels il WHERE il.product_id = p.id AND il.location_id = $${p++}
    ))`);
    params.push(filters.locationId);
  }
  // Additive day-part filter: products with no assignment are always visible.
  // Only restrict when a specific (non-'all') day part is requested.
  if (filters.dayPart && filters.dayPart !== 'all') {
    conditions.push(`(p.day_parts IS NULL OR p.day_parts = '{}' OR $${p++} = ANY(p.day_parts))`);
    params.push(filters.dayPart);
  }

  const validSortCols = { name: 'p.name', created_at: 'p.created_at', updated_at: 'p.updated_at', cost_price: 'p.cost_price' } as const;
  const orderCol = validSortCols[sortBy] ?? 'p.name';
  const orderDir = sortOrder === 'DESC' ? 'DESC' : 'ASC';

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const [{ rows: countRows }, { rows: productRows }] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM products p ${whereClause}`, params),
    query<Product>(`SELECT p.* FROM products p ${whereClause} ORDER BY ${orderCol} ${orderDir} LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]),
  ]);

  const products = await Promise.all(productRows.map(prod => buildProductWithRelations(prod.id)));

  return { products, total: parseInt(countRows[0]?.count ?? '0', 10), page };
}

// ─── searchByBarcode ──────────────────────────────────────────────────────────

export async function searchByBarcode(
  orgId: string,
  barcode: string,
): Promise<ProductWithModifiers | null> {
  // PRODUCT STATE RULE: archived items must not be found by barcode scan
  const { rows: [productRow] } = await query<{ id: string }>(
    `SELECT id FROM products WHERE organization_id = $1 AND barcode = $2
     AND deleted_at IS NULL AND archived_at IS NULL LIMIT 1`,
    [orgId, barcode],
  );
  if (productRow) return buildProductWithRelations(productRow.id);

  const { rows: [variantRow] } = await query<{ product_id: string }>(
    `SELECT pv.product_id FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.organization_id = $1 AND pv.barcode = $2
     AND pv.deleted_at IS NULL AND p.archived_at IS NULL LIMIT 1`,
    [orgId, barcode],
  );
  if (variantRow) return buildProductWithRelations(variantRow.product_id);

  return null;
}

// ─── archiveProduct ───────────────────────────────────────────────────────────

export interface ArchivedProductRow {
  id:             string;
  name:           string;
  sku:            string | null;
  category_name:  string | null;
  last_price:     number;
  archived_at:    string;
  archive_reason: string | null;
}

export async function archiveProduct(
  orgId:      string,
  productId:  string,
  employeeId: string,
  reason?:    string,
): Promise<void> {
  const { rows: [product] } = await query<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND archived_at IS NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  await corporateLockCheck(orgId, productId);

  await query(
    `UPDATE products
        SET archived_at     = NOW(),
            archive_reason  = $3,
            archived_by     = $4,
            updated_at      = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [productId, orgId, reason ?? null, employeeId],
  );

  void invalidateOrgCache(orgId, ['products', 'categories']);
  void createAuditLog({
    organizationId: orgId, actorId: employeeId, actorType: 'employee',
    action: 'product.archived', resourceType: 'product', resourceId: productId,
    metadata: { reason },
  });
}

// ─── restoreProduct ───────────────────────────────────────────────────────────

export async function restoreProduct(
  orgId:      string,
  productId:  string,
  employeeId: string,
): Promise<void> {
  const { rows: [product] } = await query<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND archived_at IS NOT NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  await query(
    `UPDATE products
        SET archived_at     = NULL,
            archive_reason  = NULL,
            archived_by     = NULL,
            updated_at      = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [productId, orgId],
  );

  void invalidateOrgCache(orgId, ['products', 'categories']);
  void createAuditLog({
    organizationId: orgId, actorId: employeeId, actorType: 'employee',
    action: 'product.restored', resourceType: 'product', resourceId: productId,
  });
}

// ─── listArchivedProducts ─────────────────────────────────────────────────────

export async function listArchivedProducts(orgId: string): Promise<ArchivedProductRow[]> {
  const { rows } = await query<ArchivedProductRow>(
    `SELECT
        p.id,
        p.name,
        p.sku,
        c.name                  AS category_name,
        COALESCE((
          SELECT pp.price
          FROM product_prices pp
          JOIN product_variants pv ON pv.id = pp.variant_id
          WHERE pv.product_id = p.id AND pp.is_active = true
            AND (pp.effective_until IS NULL OR pp.effective_until > NOW())
          ORDER BY pp.effective_from DESC LIMIT 1
        ), 0)                   AS last_price,
        p.archived_at,
        p.archive_reason
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
      WHERE p.organization_id = $1
        AND p.archived_at IS NOT NULL
        AND p.deleted_at IS NULL
      ORDER BY p.archived_at DESC`,
    [orgId],
  );
  return rows;
}
