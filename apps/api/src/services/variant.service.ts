import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ProductNotFoundError, VariantNotFoundError, PricingError, ValidationError } from '../errors';
import type { ProductVariant, ProductPrice, VariantOptions } from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateVariantData {
  name: string;
  sku?: string;
  barcode?: string;
  options?: VariantOptions;
  costPrice?: number;
  isActive?: boolean;
  sortOrder?: number;
  defaultPrice: number;   // required on create
  currency?: string;
  locationId?: string | null;
}

export interface UpdateVariantData {
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  options?: VariantOptions;
  costPrice?: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface PriceInput {
  locationId: string | null;
  price: number;
  compareAtPrice?: number;
  currency: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
}

// ─── createVariant ────────────────────────────────────────────────────────────

export async function createVariant(
  orgId: string,
  productId: string,
  data: CreateVariantData,
  employeeId: string,
): Promise<ProductVariant> {
  if (!data.name?.trim()) throw new ValidationError('Variant name is required');
  if (data.defaultPrice <= 0) throw new ValidationError('Default price must be greater than 0');

  const { rows: [product] } = await query<{ id: string; track_inventory: boolean }>(
    `SELECT id, track_inventory FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  const variantId = await withTransaction(async (client) => {
    const { rows: [variant] } = await client.query<{ id: string }>(
      `INSERT INTO product_variants
         (product_id, organization_id, name, sku, barcode, options, cost_price, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        productId, orgId, data.name.trim(),
        data.sku ?? null, data.barcode ?? null,
        JSON.stringify(data.options ?? {}),
        data.costPrice ?? 0, data.isActive ?? true, data.sortOrder ?? 0,
      ],
    );

    // Default price (location = null applies everywhere)
    await client.query(
      `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
       VALUES ($1, $2, $3, $4, now())`,
      [variant.id, data.locationId ?? null, data.defaultPrice, data.currency ?? 'USD'],
    );

    // Inventory levels per location
    if (product.track_inventory) {
      const { rows: locs } = await client.query<{ id: string }>(
        `SELECT id FROM locations WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL`,
        [orgId],
      );
      for (const loc of locs) {
        await client.query(
          `INSERT INTO inventory_levels (organization_id, location_id, product_id, variant_id)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [orgId, loc.id, productId, variant.id],
        );
      }
    }

    return variant.id;
  });

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'variant.create', resourceType: 'product_variant', resourceId: variantId });

  const { rows: [v] } = await query<ProductVariant>(
    `SELECT * FROM product_variants WHERE id = $1`, [variantId],
  );
  return v;
}

// ─── updateVariant ────────────────────────────────────────────────────────────

export async function updateVariant(
  orgId: string,
  variantId: string,
  data: UpdateVariantData,
  employeeId: string,
): Promise<ProductVariant> {
  const { rows: [variant] } = await query<ProductVariant>(
    `SELECT pv.* FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1 AND p.organization_id = $2 AND pv.deleted_at IS NULL`,
    [variantId, orgId],
  );
  if (!variant) throw new VariantNotFoundError(variantId);

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if ('sku' in data) add('sku', data.sku);
  if ('barcode' in data) add('barcode', data.barcode);
  if (data.options !== undefined) add('options', JSON.stringify(data.options));
  if (data.costPrice !== undefined) add('cost_price', data.costPrice);
  if (data.isActive !== undefined) add('is_active', data.isActive);
  if (data.sortOrder !== undefined) add('sort_order', data.sortOrder);

  if (sets.length === 0) return variant;

  sets.push(`updated_at = now()`);
  params.push(variantId);

  await query(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${p}`, params);

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'variant.update', resourceType: 'product_variant', resourceId: variantId });

  const { rows: [updated] } = await query<ProductVariant>(`SELECT * FROM product_variants WHERE id = $1`, [variantId]);
  return updated;
}

// ─── deleteVariant ────────────────────────────────────────────────────────────

export async function deleteVariant(
  orgId: string,
  variantId: string,
  employeeId: string,
): Promise<void> {
  const { rows: [variant] } = await query(
    `SELECT pv.id FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1 AND p.organization_id = $2 AND pv.deleted_at IS NULL`,
    [variantId, orgId],
  );
  if (!variant) throw new VariantNotFoundError(variantId);

  await query(
    `UPDATE product_variants SET deleted_at = now(), updated_at = now() WHERE id = $1`,
    [variantId],
  );

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'variant.delete', resourceType: 'product_variant', resourceId: variantId });
}

// ─── setPrices ────────────────────────────────────────────────────────────────

export async function setPrices(
  orgId: string,
  variantId: string,
  prices: PriceInput[],
): Promise<void> {
  // Verify variant belongs to org
  const { rows: [variant] } = await query(
    `SELECT pv.id FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.id = $1 AND p.organization_id = $2 AND pv.deleted_at IS NULL`,
    [variantId, orgId],
  );
  if (!variant) throw new VariantNotFoundError(variantId);

  for (const pi of prices) {
    if (pi.price <= 0) throw new ValidationError('Price must be greater than 0');
  }

  await withTransaction(async (client) => {
    for (const pi of prices) {
      // Expire any currently active price for this variant + location + currency
      await client.query(
        `UPDATE product_prices
         SET effective_until = now(), updated_at = now(), is_active = false
         WHERE variant_id = $1
           AND currency = $2
           AND (location_id = $3 OR (location_id IS NULL AND $3 IS NULL))
           AND is_active = true
           AND (effective_until IS NULL OR effective_until > now())`,
        [variantId, pi.currency, pi.locationId ?? null],
      );

      // Insert new price
      await client.query(
        `INSERT INTO product_prices
           (variant_id, location_id, price, compare_at_price, currency, effective_from, effective_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          variantId, pi.locationId ?? null, pi.price,
          pi.compareAtPrice ?? null, pi.currency,
          pi.effectiveFrom ?? new Date(), pi.effectiveUntil ?? null,
        ],
      );
    }
  });
}

// ─── getActivePrice ───────────────────────────────────────────────────────────

export async function getActivePrice(
  variantId: string,
  locationId: string | null,
  currency: string,
  asOf?: Date,
): Promise<number> {
  const asOfTs = asOf ?? new Date();

  // Location-specific price takes precedence over null (default)
  const { rows } = await query<{ price: number }>(
    `SELECT price FROM product_prices
     WHERE variant_id = $1
       AND currency = $2
       AND is_active = true
       AND effective_from <= $3
       AND (effective_until IS NULL OR effective_until > $3)
       AND (location_id = $4 OR location_id IS NULL)
     ORDER BY
       CASE WHEN location_id = $4 THEN 0 ELSE 1 END ASC,
       effective_from DESC
     LIMIT 1`,
    [variantId, currency, asOfTs, locationId],
  );

  if (!rows.length) throw new PricingError(variantId, locationId ?? undefined);
  return Number(rows[0].price);
}
