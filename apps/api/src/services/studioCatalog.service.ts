/**
 * studioCatalog.service — sellable studio catalog items (v2.1).
 *
 * Studio items (drop_in, class_pack, add_on, membership) are NORMAL products
 * carrying item_type + studio_meta, so they flow through the EXISTING checkout
 * unchanged — this service builds NO new payment/checkout logic. It writes directly
 * to products (+ a Default variant + a price row) instead of going through
 * product.service.createProduct, to stay self-contained and leave the core catalog
 * service untouched. track_inventory=false (studio items aren't physical stock).
 *
 * GRACEFUL: guards the products.item_type column (information_schema) so it's safe
 * pre-migration. Studio-gating (capabilities.studio) is enforced at the route layer.
 */
import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { StudioCatalogItem, StudioItemType, StudioMeta } from '@taproot/shared';

const STUDIO_ITEM_TYPES: StudioItemType[] = ['membership', 'class_pack', 'drop_in', 'add_on', 'gift_card'];

export interface CreateStudioItemInput {
  name: string;
  itemType: StudioItemType;
  priceCents?: number;
  description?: string;
  studioMeta?: StudioMeta;
}
export interface UpdateStudioItemInput {
  name?: string;
  description?: string;
  priceCents?: number | null;
  studioMeta?: StudioMeta;
  isActive?: boolean;
}

interface StudioCatalogItemRow {
  id: string; organization_id: string; name: string; description: string | null;
  item_type: string; studio_meta: unknown; is_active: boolean;
  created_at: string; updated_at: string; price_cents: string | number | null;
}

let _itemTypeReady: boolean | null = null;
async function itemTypeReady(): Promise<boolean> {
  if (_itemTypeReady !== null) return _itemTypeReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_name = 'products' AND column_name = 'item_type'
       ) AS ready`,
    );
    _itemTypeReady = Boolean(rows[0]?.ready);
  } catch {
    _itemTypeReady = false;
  }
  return _itemTypeReady;
}

function assertItemType(t: string): asserts t is StudioItemType {
  if (!STUDIO_ITEM_TYPES.includes(t as StudioItemType)) {
    throw new ValidationError(`Invalid studio item type: ${t}`);
  }
}

function mapRow(r: StudioCatalogItemRow): StudioCatalogItem {
  return {
    id: r.id,
    organization_id: r.organization_id,
    name: r.name,
    description: r.description,
    item_type: r.item_type as StudioCatalogItem['item_type'],
    studio_meta: (r.studio_meta && typeof r.studio_meta === 'object') ? r.studio_meta as StudioMeta : {},
    price_cents: r.price_cents != null ? Math.round(Number(r.price_cents)) : null,
    is_active: Boolean(r.is_active),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const SELECT_ITEM = `
  SELECT p.id, p.organization_id, p.name, p.description, p.item_type, p.studio_meta,
         p.is_active, p.created_at, p.updated_at,
         (SELECT pp.price FROM product_prices pp
            JOIN product_variants pv ON pv.id = pp.variant_id
           WHERE pv.product_id = p.id AND pp.is_active = true
           ORDER BY pp.effective_from DESC LIMIT 1) AS price_cents
    FROM products p`;

const NOT_PROVISIONED = 'Studio catalog not provisioned yet (migration 033 pending)';

export async function createStudioItem(orgId: string, employeeId: string, input: CreateStudioItemInput): Promise<StudioCatalogItem> {
  if (!(await itemTypeReady())) throw new ValidationError(NOT_PROVISIONED);
  if (!input.name?.trim()) throw new ValidationError('Name is required');
  assertItemType(input.itemType);
  if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
    throw new ValidationError('priceCents must be a non-negative integer');
  }

  const id = await withTransaction(async (client) => {
    const { rows: [prod] } = await client.query<{ id: string }>(
      `INSERT INTO products
         (organization_id, name, description, product_type, unit_of_measure,
          track_inventory, is_active, item_type, studio_meta, created_by)
       VALUES ($1,$2,$3,'service','each',false,true,$4,$5,$6)
       RETURNING id`,
      [orgId, input.name.trim(), input.description ?? null, input.itemType,
        JSON.stringify(input.studioMeta ?? {}), employeeId],
    );
    const { rows: [variant] } = await client.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, organization_id, name, is_active, sort_order)
       VALUES ($1,$2,'Default',true,0) RETURNING id`,
      [prod.id, orgId],
    );
    if (input.priceCents !== undefined && input.priceCents > 0) {
      await client.query(
        `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
         VALUES ($1, NULL, $2, 'USD', now())`,
        [variant.id, input.priceCents],
      );
    }
    return prod.id;
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'studio.item_created', resourceType: 'product', resourceId: id,
    afterState: { itemType: input.itemType, name: input.name.trim() },
  });
  return getStudioItem(orgId, id);
}

export async function getStudioItem(orgId: string, productId: string): Promise<StudioCatalogItem> {
  if (!(await itemTypeReady())) throw new NotFoundError('Studio item');
  const { rows: [row] } = await query<StudioCatalogItemRow>(
    `${SELECT_ITEM} WHERE p.id = $1 AND p.organization_id = $2 AND p.deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!row) throw new NotFoundError('Studio item');
  return mapRow(row);
}

export async function listStudioItems(orgId: string, itemType?: string): Promise<StudioCatalogItem[]> {
  if (!(await itemTypeReady())) return [];
  if (itemType) assertItemType(itemType);
  const types = itemType ? [itemType] : STUDIO_ITEM_TYPES;
  const { rows } = await query<StudioCatalogItemRow>(
    `${SELECT_ITEM}
      WHERE p.organization_id = $1 AND p.deleted_at IS NULL AND p.item_type = ANY($2::text[])
      ORDER BY p.item_type, p.name`,
    [orgId, types],
  );
  return rows.map(mapRow);
}

export async function updateStudioItem(
  orgId: string, productId: string, employeeId: string, input: UpdateStudioItemInput,
): Promise<StudioCatalogItem> {
  if (!(await itemTypeReady())) throw new NotFoundError('Studio item');
  if (input.priceCents !== undefined && input.priceCents !== null
      && (!Number.isInteger(input.priceCents) || input.priceCents < 0)) {
    throw new ValidationError('priceCents must be a non-negative integer');
  }

  await withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    const add = (col: string, val: unknown): void => { sets.push(`${col} = $${p++}`); params.push(val); };
    if (input.name !== undefined) add('name', input.name.trim());
    if (input.description !== undefined) add('description', input.description);
    if (input.studioMeta !== undefined) add('studio_meta', JSON.stringify(input.studioMeta));
    if (input.isActive !== undefined) add('is_active', input.isActive);

    if (sets.length) {
      params.push(productId, orgId);
      const { rowCount } = await client.query(
        `UPDATE products SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${p} AND organization_id = $${p + 1}
            AND deleted_at IS NULL AND item_type = ANY($${p + 2}::text[])`,
        [...params, STUDIO_ITEM_TYPES],
      );
      if (!rowCount) throw new NotFoundError('Studio item');
    }

    // Price change → version it: deactivate current active price, insert a new one.
    if (input.priceCents !== undefined && input.priceCents !== null) {
      const { rows: [variant] } = await client.query<{ id: string }>(
        `SELECT id FROM product_variants
          WHERE product_id = $1 AND organization_id = $2 AND deleted_at IS NULL
          ORDER BY sort_order ASC LIMIT 1`,
        [productId, orgId],
      );
      if (variant) {
        await client.query(`UPDATE product_prices SET is_active = false WHERE variant_id = $1 AND is_active = true`, [variant.id]);
        await client.query(
          `INSERT INTO product_prices (variant_id, location_id, price, currency, effective_from)
           VALUES ($1, NULL, $2, 'USD', now())`,
          [variant.id, input.priceCents],
        );
      }
    }
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'studio.item_updated', resourceType: 'product', resourceId: productId,
  });
  return getStudioItem(orgId, productId);
}

export async function deleteStudioItem(orgId: string, productId: string, employeeId: string): Promise<void> {
  if (!(await itemTypeReady())) return;
  // item_type guard ⇒ can only soft-delete studio items, never a food product.
  await query(
    `UPDATE products SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND item_type = ANY($3::text[])`,
    [productId, orgId, STUDIO_ITEM_TYPES],
  );
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'studio.item_deleted', resourceType: 'product', resourceId: productId,
  });
}
