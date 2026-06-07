import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import {
  ProductNotFoundError, VariantNotFoundError, ValidationError,
  InsufficientStockError, InventoryLevelError, PurchaseOrderError,
} from '../errors';
import { calculateDepletionForSale } from './recipe.service';
import type {
  InventoryLevel, InventoryMovement, InventoryMovementType,
  AppliedModifier, OrderLineItem,
} from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DepletionLineItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  modifiers: AppliedModifier[];
}

export interface AdjustmentInput {
  productId: string;
  variantId?: string | null;
  delta: number;                  // positive = add stock, negative = remove
  reason?: string;
  movementType?: 'waste' | 'adjustment' | 'return';
}

export interface ReceiveLineInput {
  purchaseOrderLineId: string;
  productId: string;
  variantId?: string | null;
  quantityReceived: number;
  unitCost?: number;              // override unit cost if provided
}

export interface TransferLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

export interface StockCountInput {
  productId: string;
  variantId?: string | null;
  countedQuantity: number;
  notes?: string;
}

export interface InventoryLevelFilters {
  productId?: string;
  variantId?: string | null;
  belowReorderPoint?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Locks and returns a single inventory_levels row within an open transaction.
 * Throws InventoryLevelError if the row doesn't exist.
 */
async function lockInventoryRow(
  client: import('pg').PoolClient,
  orgId: string,
  locationId: string,
  productId: string,
  variantId: string | null,
): Promise<{ id: string; quantity_on_hand: number }> {
  const { rows } = await client.query<{ id: string; quantity_on_hand: number }>(
    `SELECT id, quantity_on_hand
     FROM inventory_levels
     WHERE organization_id = $1 AND location_id = $2 AND product_id = $3
       AND (
         ($4::uuid IS NULL AND variant_id IS NULL)
         OR variant_id = $4
       )
     FOR UPDATE`,
    [orgId, locationId, productId, variantId ?? null],
  );
  if (!rows.length) {
    throw new InventoryLevelError(
      `No inventory level record found for product ${productId}${variantId ? `/variant ${variantId}` : ''} at location ${locationId}`,
    );
  }
  return rows[0];
}

/**
 * Inserts an inventory_movement record and updates quantity_on_hand.
 * Must be called inside an open transaction.
 */
async function recordMovement(
  client: import('pg').PoolClient,
  opts: {
    levelId: string;
    orgId: string;
    locationId: string;
    productId: string;
    variantId: string | null;
    movementType: InventoryMovementType;
    delta: number;
    quantityBefore: number;
    referenceType?: string;
    referenceId?: string;
    employeeId?: string;
    notes?: string;
  },
): Promise<void> {
  const quantityAfter = opts.quantityBefore + opts.delta;

  await client.query(
    `UPDATE inventory_levels
     SET quantity_on_hand = $1, updated_at = now()
     WHERE id = $2`,
    [quantityAfter, opts.levelId],
  );

  await client.query(
    `INSERT INTO inventory_movements
       (organization_id, location_id, product_id, variant_id,
        movement_type, quantity_delta, quantity_before, quantity_after,
        reference_type, reference_id, employee_id, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      opts.orgId, opts.locationId, opts.productId, opts.variantId ?? null,
      opts.movementType, opts.delta, opts.quantityBefore, quantityAfter,
      opts.referenceType ?? null, opts.referenceId ?? null,
      opts.employeeId ?? null, opts.notes ?? null,
      JSON.stringify({}),
    ],
  );
}

// ─── depleteForOrder ──────────────────────────────────────────────────────────
// Called after an order is completed. All depletions run in a single transaction.

export async function depleteForOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  lineItems: DepletionLineItem[],
  employeeId: string,
): Promise<void> {
  if (!lineItems.length) return;

  await withTransaction(async (client) => {
    for (const item of lineItems) {
      // Check if this product has an active recipe
      const { rows: recipeRows } = await client.query<{ id: string }>(
        `SELECT id FROM recipes WHERE product_id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
        [item.productId],
      );

      if (recipeRows.length) {
        // Recipe product — deplete each ingredient
        const depletions = await calculateDepletionForSale(
          item.productId,
          item.variantId,
          item.quantity,
          item.modifiers,
        );

        for (const dep of depletions) {
          // ingredient might not track inventory — skip gracefully
          const { rows: ingRows } = await client.query<{ track_inventory: boolean }>(
            `SELECT track_inventory FROM products WHERE id = $1 AND deleted_at IS NULL`,
            [dep.ingredientProductId],
          );
          if (!ingRows.length || !ingRows[0].track_inventory) continue;

          let level: { id: string; quantity_on_hand: number };
          try {
            level = await lockInventoryRow(client, orgId, locationId, dep.ingredientProductId, dep.ingredientVariantId);
          } catch {
            // No inventory row for this ingredient at this location — skip
            continue;
          }

          await recordMovement(client, {
            levelId: level.id,
            orgId,
            locationId,
            productId: dep.ingredientProductId,
            variantId: dep.ingredientVariantId,
            movementType: 'sale',
            delta: -dep.depletionQty,
            quantityBefore: level.quantity_on_hand,
            referenceType: 'order',
            referenceId: orderId,
            employeeId,
          });
        }
      } else {
        // Non-recipe product — deplete directly
        const { rows: prodRows } = await client.query<{ track_inventory: boolean }>(
          `SELECT track_inventory FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [item.productId, orgId],
        );
        if (!prodRows.length || !prodRows[0].track_inventory) continue;

        let level: { id: string; quantity_on_hand: number };
        try {
          level = await lockInventoryRow(client, orgId, locationId, item.productId, item.variantId);
        } catch {
          continue;
        }

        await recordMovement(client, {
          levelId: level.id,
          orgId,
          locationId,
          productId: item.productId,
          variantId: item.variantId,
          movementType: 'sale',
          delta: -item.quantity,
          quantityBefore: level.quantity_on_hand,
          referenceType: 'order',
          referenceId: orderId,
          employeeId,
        });
      }
    }
  });
}

// ─── adjustInventory ──────────────────────────────────────────────────────────

export async function adjustInventory(
  orgId: string,
  locationId: string,
  adjustment: AdjustmentInput,
  employeeId: string,
): Promise<InventoryLevel> {
  const { productId, variantId = null, delta, reason } = adjustment;
  const movementType: InventoryMovementType = adjustment.movementType ?? 'adjustment';

  if (delta === 0) throw new ValidationError('Adjustment delta cannot be zero');

  // Verify product exists in org
  const { rows: [product] } = await query<{ id: string; track_inventory: boolean; name: string }>(
    `SELECT id, track_inventory, name FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!product) throw new ProductNotFoundError(productId);

  // Verify variant if provided
  if (variantId) {
    const { rows: [v] } = await query(
      `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2 AND deleted_at IS NULL`,
      [variantId, productId],
    );
    if (!v) throw new VariantNotFoundError(variantId);
  }

  let levelId!: string;
  await withTransaction(async (client) => {
    const level = await lockInventoryRow(client, orgId, locationId, productId, variantId);
    levelId = level.id;

    const newQty = level.quantity_on_hand + delta;
    if (newQty < 0) {
      throw new InsufficientStockError(product.name, level.quantity_on_hand, Math.abs(delta));
    }

    await recordMovement(client, {
      levelId: level.id,
      orgId,
      locationId,
      productId,
      variantId,
      movementType,
      delta,
      quantityBefore: level.quantity_on_hand,
      employeeId,
      notes: reason,
    });
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'inventory.adjust', resourceType: 'inventory_level', resourceId: levelId,
  });

  const { rows: [updated] } = await query<InventoryLevel>(
    `SELECT * FROM inventory_levels WHERE id = $1`, [levelId],
  );
  return updated;
}

// ─── receiveStock ─────────────────────────────────────────────────────────────

export async function receiveStock(
  orgId: string,
  locationId: string,
  purchaseOrderId: string,
  lines: ReceiveLineInput[],
  employeeId: string,
): Promise<void> {
  if (!lines.length) return;

  // Validate PO exists and is receivable
  const { rows: [po] } = await query<{
    id: string; status: string; location_id: string;
  }>(
    `SELECT id, status, location_id FROM purchase_orders
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [purchaseOrderId, orgId],
  );
  if (!po) throw new PurchaseOrderError(`Purchase order ${purchaseOrderId} not found`, 400);

  const receivableStatuses = ['sent', 'confirmed', 'partially_received'];
  if (!receivableStatuses.includes(po.status)) {
    throw new PurchaseOrderError(
      `Cannot receive stock against a PO with status "${po.status}"`, 400,
    );
  }

  if (po.location_id !== locationId) {
    throw new PurchaseOrderError(
      `Purchase order ${purchaseOrderId} is for a different location`, 400,
    );
  }

  for (const line of lines) {
    if (line.quantityReceived <= 0) {
      throw new ValidationError(`quantityReceived must be greater than 0`);
    }
  }

  await withTransaction(async (client) => {
    for (const line of lines) {
      // Validate PO line belongs to this PO
      const { rows: [poLine] } = await client.query<{
        id: string; quantity_ordered: number; quantity_received: number; unit_cost: number;
      }>(
        `SELECT id, quantity_ordered, quantity_received, unit_cost
         FROM purchase_order_lines
         WHERE id = $1 AND purchase_order_id = $2`,
        [line.purchaseOrderLineId, purchaseOrderId],
      );
      if (!poLine) {
        throw new PurchaseOrderError(`PO line ${line.purchaseOrderLineId} not found on this order`, 400);
      }

      const totalReceived = poLine.quantity_received + line.quantityReceived;
      if (totalReceived > poLine.quantity_ordered) {
        throw new PurchaseOrderError(
          `Cannot receive more than ordered quantity for PO line ${line.purchaseOrderLineId}`, 409,
        );
      }

      // Update PO line received quantity
      await client.query(
        `UPDATE purchase_order_lines
         SET quantity_received = $1, received_at = now(), updated_at = now()
         WHERE id = $2`,
        [totalReceived, poLine.id],
      );

      // Update weighted average cost on product if unit cost provided
      const effectiveUnitCost = line.unitCost ?? poLine.unit_cost;
      if (effectiveUnitCost > 0) {
        // Weighted average cost: (existing_cost * existing_qty + new_cost * new_qty) / (existing_qty + new_qty)
        await client.query(
          `UPDATE products
           SET cost_price = CASE
             WHEN cost_price = 0 THEN $1
             ELSE ROUND(
               ((cost_price * (
                 SELECT COALESCE(SUM(quantity_on_hand), 0)
                 FROM inventory_levels
                 WHERE product_id = $2 AND organization_id = $3
               )) + ($1 * $4)) /
               NULLIF(
                 (SELECT COALESCE(SUM(quantity_on_hand), 0)
                  FROM inventory_levels
                  WHERE product_id = $2 AND organization_id = $3) + $4
               , 0)
             , 6)
           END,
           updated_at = now()
           WHERE id = $2`,
          [effectiveUnitCost, line.productId, orgId, line.quantityReceived],
        );
      }

      // Update inventory level
      let level: { id: string; quantity_on_hand: number };
      try {
        level = await lockInventoryRow(client, orgId, locationId, line.productId, line.variantId ?? null);
      } catch {
        // Create missing inventory level row
        const { rows: [newLevel] } = await client.query<{ id: string; quantity_on_hand: number }>(
          `INSERT INTO inventory_levels (organization_id, location_id, product_id, variant_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT DO NOTHING
           RETURNING id, quantity_on_hand`,
          [orgId, locationId, line.productId, line.variantId ?? null],
        );
        if (!newLevel) {
          // Race: was just inserted — re-lock
          level = await lockInventoryRow(client, orgId, locationId, line.productId, line.variantId ?? null);
        } else {
          level = newLevel;
        }
      }

      await recordMovement(client, {
        levelId: level.id,
        orgId,
        locationId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        movementType: 'po_receipt',
        delta: line.quantityReceived,
        quantityBefore: level.quantity_on_hand,
        referenceType: 'purchase_order',
        referenceId: purchaseOrderId,
        employeeId,
      });
    }

    // Update PO overall status
    const { rows: allLines } = await client.query<{
      quantity_ordered: number; quantity_received: number;
    }>(
      `SELECT quantity_ordered, quantity_received FROM purchase_order_lines WHERE purchase_order_id = $1`,
      [purchaseOrderId],
    );

    const allReceived = allLines.every(l => l.quantity_received >= l.quantity_ordered);
    const anyReceived = allLines.some(l => l.quantity_received > 0);

    const newStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
    await client.query(
      `UPDATE purchase_orders
       SET status = $1, received_at = CASE WHEN $1 = 'received' THEN now() ELSE received_at END,
           updated_at = now()
       WHERE id = $2`,
      [newStatus, purchaseOrderId],
    );
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'inventory.receive', resourceType: 'purchase_order', resourceId: purchaseOrderId,
  });
}

// ─── transferStock ────────────────────────────────────────────────────────────

export async function transferStock(
  orgId: string,
  fromLocationId: string,
  toLocationId: string,
  items: TransferLineInput[],
  employeeId: string,
): Promise<void> {
  if (!items.length) return;
  if (fromLocationId === toLocationId) {
    throw new ValidationError('Source and destination locations must be different');
  }

  // Verify both locations belong to org
  const { rows: locs } = await query<{ id: string }>(
    `SELECT id FROM locations WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND deleted_at IS NULL`,
    [[fromLocationId, toLocationId], orgId],
  );
  if (locs.length < 2) {
    throw new ValidationError('One or both locations not found in this organization');
  }

  // Generate a shared reference ID for the transfer pair
  const { rows: [{ ref }] } = await query<{ ref: string }>(`SELECT gen_random_uuid()::text AS ref`);

  await withTransaction(async (client) => {
    // Lock all source rows first (consistent ordering to prevent deadlocks)
    const sortedItems = [...items].sort((a, b) =>
      `${a.productId}:${a.variantId ?? ''}`.localeCompare(`${b.productId}:${b.variantId ?? ''}`),
    );

    for (const item of sortedItems) {
      if (item.quantity <= 0) throw new ValidationError('Transfer quantity must be greater than 0');

      // Lock source
      const source = await lockInventoryRow(client, orgId, fromLocationId, item.productId, item.variantId ?? null);

      if (source.quantity_on_hand < item.quantity) {
        // Get product name for error message
        const { rows: [p] } = await client.query<{ name: string }>(
          `SELECT name FROM products WHERE id = $1`, [item.productId],
        );
        throw new InsufficientStockError(p?.name ?? item.productId, source.quantity_on_hand, item.quantity);
      }

      // Ensure destination inventory row exists
      await client.query(
        `INSERT INTO inventory_levels (organization_id, location_id, product_id, variant_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [orgId, toLocationId, item.productId, item.variantId ?? null],
      );

      // Lock destination (after insert to avoid gap-lock races)
      const dest = await lockInventoryRow(client, orgId, toLocationId, item.productId, item.variantId ?? null);

      // transfer_out from source
      await recordMovement(client, {
        levelId: source.id,
        orgId,
        locationId: fromLocationId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        movementType: 'transfer_out',
        delta: -item.quantity,
        quantityBefore: source.quantity_on_hand,
        referenceType: 'transfer',
        referenceId: ref,
        employeeId,
        notes: `Transfer to location ${toLocationId}`,
      });

      // transfer_in to destination
      await recordMovement(client, {
        levelId: dest.id,
        orgId,
        locationId: toLocationId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        movementType: 'transfer_in',
        delta: item.quantity,
        quantityBefore: dest.quantity_on_hand,
        referenceType: 'transfer',
        referenceId: ref,
        employeeId,
        notes: `Transfer from location ${fromLocationId}`,
      });
    }
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'inventory.transfer', resourceType: 'inventory_level', resourceId: ref,
  });
}

// ─── recordStockCount ─────────────────────────────────────────────────────────

export async function recordStockCount(
  orgId: string,
  locationId: string,
  counts: StockCountInput[],
  employeeId: string,
  isOpeningCount = false,
): Promise<Array<{ productId: string; variantId: string | null; delta: number }>> {
  if (!counts.length) return [];

  const movementType: InventoryMovementType = isOpeningCount ? 'opening_count' : 'cycle_count';
  const deltas: Array<{ productId: string; variantId: string | null; delta: number }> = [];

  await withTransaction(async (client) => {
    for (const count of counts) {
      if (count.countedQuantity < 0) {
        throw new ValidationError('Counted quantity cannot be negative');
      }

      const level = await lockInventoryRow(
        client, orgId, locationId, count.productId, count.variantId ?? null,
      );

      const delta = count.countedQuantity - level.quantity_on_hand;
      deltas.push({ productId: count.productId, variantId: count.variantId ?? null, delta });

      if (delta === 0) {
        // Still update last_counted_at even if no delta
        await client.query(
          `UPDATE inventory_levels SET last_counted_at = now(), updated_at = now() WHERE id = $1`,
          [level.id],
        );
        continue;
      }

      await recordMovement(client, {
        levelId: level.id,
        orgId,
        locationId,
        productId: count.productId,
        variantId: count.variantId ?? null,
        movementType,
        delta,
        quantityBefore: level.quantity_on_hand,
        employeeId,
        notes: count.notes,
      });

      // Update last_counted_at
      await client.query(
        `UPDATE inventory_levels SET last_counted_at = now(), updated_at = now() WHERE id = $1`,
        [level.id],
      );
    }
  });

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: `inventory.${movementType}`, resourceType: 'inventory_level', resourceId: locationId,
  });

  return deltas;
}

// ─── getInventoryLevel ────────────────────────────────────────────────────────

export async function getInventoryLevel(
  orgId: string,
  locationId: string,
  productId: string,
  variantId?: string | null,
): Promise<InventoryLevel> {
  const { rows: [level] } = await query<InventoryLevel>(
    `SELECT il.* FROM inventory_levels il
     WHERE il.organization_id = $1
       AND il.location_id = $2
       AND il.product_id = $3
       AND (
         ($4::uuid IS NULL AND il.variant_id IS NULL)
         OR il.variant_id = $4
       )`,
    [orgId, locationId, productId, variantId ?? null],
  );
  if (!level) {
    throw new InventoryLevelError(
      `Inventory level not found for product ${productId}${variantId ? `/variant ${variantId}` : ''} at location ${locationId}`,
    );
  }
  return level;
}

// ─── listInventoryLevels ──────────────────────────────────────────────────────

export async function listInventoryLevels(
  orgId: string,
  locationId: string,
  filters: InventoryLevelFilters = {},
): Promise<{ levels: (InventoryLevel & { product_name: string; product_sku: string | null })[]; total: number; page: number }> {
  const { page = 1, limit: rawLimit = 50 } = filters;
  const limit = Math.min(rawLimit, 200);
  const offset = (page - 1) * limit;

  const conditions: string[] = [
    'il.organization_id = $1',
    'il.location_id = $2',
    'p.deleted_at IS NULL',
  ];
  const params: unknown[] = [orgId, locationId];
  let p = 3;

  if (filters.productId) { conditions.push(`il.product_id = $${p++}`); params.push(filters.productId); }
  if (filters.variantId !== undefined) {
    if (filters.variantId === null) {
      conditions.push(`il.variant_id IS NULL`);
    } else {
      conditions.push(`il.variant_id = $${p++}`);
      params.push(filters.variantId);
    }
  }
  if (filters.belowReorderPoint) {
    conditions.push(`il.reorder_point IS NOT NULL AND il.quantity_on_hand <= il.reorder_point`);
  }
  if (filters.search) {
    conditions.push(`(p.name ILIKE $${p} OR p.sku ILIKE $${p})`);
    params.push(`%${filters.search}%`); p++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const [{ rows: countRows }, { rows: levelRows }] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) FROM inventory_levels il
       JOIN products p ON p.id = il.product_id
       ${whereClause}`,
      params,
    ),
    query<InventoryLevel & {
      product_name: string; product_sku: string | null;
      variant_name: string | null; category_name: string | null;
      unit_of_measure: string; cost_price: number;
    }>(
      `SELECT il.*,
              p.name       AS product_name,
              p.sku        AS product_sku,
              p.unit_of_measure,
              p.cost_price,
              pv.name      AS variant_name,
              c.name       AS category_name
       FROM inventory_levels il
       JOIN products p ON p.id = il.product_id
       LEFT JOIN product_variants pv ON pv.id = il.variant_id AND pv.deleted_at IS NULL
       LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
       ${whereClause}
       ORDER BY p.name ASC, il.variant_id ASC NULLS FIRST
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset],
    ),
  ]);

  return {
    levels: levelRows,
    total: parseInt(countRows[0]?.count ?? '0', 10),
    page,
  };
}

// ─── getMovementHistory ───────────────────────────────────────────────────────

export async function getMovementHistory(
  orgId: string,
  locationId: string,
  productId: string,
  variantId: string | null = null,
  limit = 50,
  offset = 0,
): Promise<InventoryMovement[]> {
  const { rows } = await query<InventoryMovement>(
    `SELECT * FROM inventory_movements
     WHERE organization_id = $1 AND location_id = $2 AND product_id = $3
       AND (
         ($4::uuid IS NULL AND variant_id IS NULL)
         OR variant_id = $4
       )
     ORDER BY created_at DESC
     LIMIT $5 OFFSET $6`,
    [orgId, locationId, productId, variantId, Math.min(limit, 500), offset],
  );
  return rows;
}
