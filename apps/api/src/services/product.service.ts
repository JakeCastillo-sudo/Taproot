import crypto from 'crypto';
import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import {
  ProductNotFoundError, ConflictError, ValidationError,
} from '../errors';
import type {
  Product, ProductVariant, ProductPrice, Recipe, RecipeLine,
  ProductWithRelations, UnitOfMeasure, ProductType,
} from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

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

async function buildProductWithRelations(productId: string): Promise<ProductWithRelations> {
  const [{ rows: [product] }, { rows: variants }, { rows: prices }, { rows: recipeRows }, { rows: lineRows }] =
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
    ]);

  if (!product) throw new ProductNotFoundError(productId);

  const recipe = recipeRows[0] ? { ...recipeRows[0], lines: lineRows } : null;
  return { ...product, variants, prices, recipe };
}

// ─── createProduct ────────────────────────────────────────────────────────────

export async function createProduct(
  orgId: string,
  _locationId: string,
  data: CreateProductData,
  employeeId: string,
): Promise<ProductWithRelations> {
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
          track_inventory, is_active, tags, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [
        orgId, data.categoryId ?? null, data.supplierId ?? null,
        data.name.trim(), data.description ?? null,
        sku, data.barcode ?? null, productType, unitOfMeasure,
        data.costPrice ?? 0, data.trackInventory ?? true,
        data.isActive ?? true,
        data.tags ? `{${data.tags.map(t => `"${t}"`).join(',')}}` : null,
        employeeId,
      ],
    );

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

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'product.create', resourceType: 'product', resourceId: productId });

  return buildProductWithRelations(productId);
}

// ─── updateProduct ────────────────────────────────────────────────────────────

export async function updateProduct(
  orgId: string,
  productId: string,
  data: UpdateProductData,
  employeeId: string,
): Promise<ProductWithRelations> {
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
  if (data.tags !== undefined) add('tags', data.tags ? `{${data.tags.map(t => `"${t}"`).join(',')}}` : null);

  if (sets.length === 0) return buildProductWithRelations(productId);

  sets.push(`updated_at = now()`);
  params.push(productId, orgId);

  await query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`,
    params,
  );

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'product.update', resourceType: 'product', resourceId: productId,
    beforeState: before as unknown as Record<string, unknown>,
  });

  return buildProductWithRelations(productId);
}

// ─── deleteProduct ────────────────────────────────────────────────────────────

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

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'product.delete', resourceType: 'product', resourceId: productId });
}

// ─── getProduct ───────────────────────────────────────────────────────────────

export async function getProduct(orgId: string, productId: string): Promise<ProductWithRelations> {
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
): Promise<{ products: ProductWithRelations[]; total: number; page: number }> {
  const {
    page = 1, limit: rawLimit = 50,
    sortBy = 'name', sortOrder = 'ASC',
  } = filters;
  const limit = Math.min(rawLimit, 200);
  const offset = (page - 1) * limit;

  const conditions: string[] = ['p.organization_id = $1', 'p.deleted_at IS NULL'];
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
): Promise<ProductWithRelations | null> {
  // Check products first, then variants
  const { rows: [productRow] } = await query<{ id: string }>(
    `SELECT id FROM products WHERE organization_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1`,
    [orgId, barcode],
  );
  if (productRow) return buildProductWithRelations(productRow.id);

  const { rows: [variantRow] } = await query<{ product_id: string }>(
    `SELECT pv.product_id FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.organization_id = $1 AND pv.barcode = $2 AND pv.deleted_at IS NULL LIMIT 1`,
    [orgId, barcode],
  );
  if (variantRow) return buildProductWithRelations(variantRow.product_id);

  return null;
}
