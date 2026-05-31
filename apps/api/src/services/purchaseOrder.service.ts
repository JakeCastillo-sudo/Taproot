import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError, PurchaseOrderError } from '../errors';
import type { PurchaseOrder, PurchaseOrderLine } from '@taproot/shared';
import { createAuditLog } from '../auth/audit';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreatePOLineInput {
  productId: string;
  variantId?: string | null;
  quantityOrdered: number;
  unitCost: number;
}

export interface CreatePOInput {
  locationId: string;
  supplierId?: string | null;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  lines: CreatePOLineInput[];
}

export interface ReceivePOLineInput {
  poLineId: string;
  quantityReceived: number;
  unitCostOverride?: number;
}

export interface ListPOFilter {
  status?: string;
  supplierId?: string;
  locationId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ─── PO number generator ──────────────────────────────────────────────────────
// Format: PO-{YYYY}-{NNNNNN} using a DB sequence per org/year.

async function generatePoNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const { rows: [row] } = await query<{ next_val: number }>(
    `INSERT INTO organization_order_sequences (organization_id, year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (organization_id, year)
     DO UPDATE SET last_number = organization_order_sequences.last_number + 1
     RETURNING last_number AS next_val`,
    [orgId, year],
  );
  return `PO-${year}-${String(row.next_val).padStart(6, '0')}`;
}

// ─── createPurchaseOrder ──────────────────────────────────────────────────────

export async function createPurchaseOrder(
  orgId: string,
  employeeId: string,
  input: CreatePOInput,
): Promise<PurchaseOrder & { lines: PurchaseOrderLine[] }> {
  if (input.lines.length === 0) throw new ValidationError('Purchase order must have at least one line');

  return withTransaction(async (client) => {
    // Verify location
    const { rows: [loc] } = await client.query<{ id: string }>(
      `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [input.locationId, orgId],
    );
    if (!loc) throw new ValidationError('Location not found');

    // Verify supplier (optional)
    if (input.supplierId) {
      const { rows: [sup] } = await client.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [input.supplierId, orgId],
      );
      if (!sup) throw new ValidationError('Supplier not found');
    }

    // Validate all products + variants
    for (const line of input.lines) {
      if (line.quantityOrdered <= 0) throw new ValidationError('Quantity ordered must be greater than 0');
      if (line.unitCost < 0) throw new ValidationError('Unit cost cannot be negative');

      const { rows: [product] } = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [line.productId, orgId],
      );
      if (!product) throw new ValidationError(`Product ${line.productId} not found`);

      if (line.variantId) {
        const { rows: [variant] } = await client.query<{ id: string }>(
          `SELECT id FROM product_variants
           WHERE id = $1 AND product_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
          [line.variantId, line.productId, orgId],
        );
        if (!variant) throw new ValidationError(`Variant ${line.variantId} not found`);
      }
    }

    // Compute totals
    const subtotal = input.lines.reduce((s, l) => s + l.quantityOrdered * l.unitCost, 0);
    const poNumber = await generatePoNumber(orgId);

    // Insert PO
    const { rows: [po] } = await client.query<PurchaseOrder>(
      `INSERT INTO purchase_orders
         (organization_id, location_id, supplier_id, po_number, status,
          expected_delivery_date, notes, subtotal, tax_total, total, created_by)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,0,$8,$9)
       RETURNING *`,
      [
        orgId, input.locationId, input.supplierId ?? null,
        poNumber, input.expectedDeliveryDate ?? null,
        input.notes ?? null, subtotal, subtotal, employeeId,
      ],
    );

    // Insert lines
    const lines: PurchaseOrderLine[] = [];
    for (const line of input.lines) {
      const { rows: [l] } = await client.query<PurchaseOrderLine>(
        `INSERT INTO purchase_order_lines
           (purchase_order_id, product_id, variant_id,
            quantity_ordered, quantity_received, unit_cost, total_cost)
         VALUES ($1,$2,$3,$4,0,$5,$6)
         RETURNING *`,
        [
          po.id, line.productId, line.variantId ?? null,
          line.quantityOrdered, line.unitCost,
          line.quantityOrdered * line.unitCost,
        ],
      );
      lines.push(l);
    }

    void createAuditLog({
      organizationId: orgId, actorId: employeeId,
      action: 'purchase_order.created', resourceType: 'purchase_order', resourceId: po.id,
      afterState: { poNumber: po.po_number, supplierId: po.supplier_id, total: po.total },
    });

    return { ...po, lines };
  });
}

// ─── sendPurchaseOrder ────────────────────────────────────────────────────────

export async function sendPurchaseOrder(
  orgId: string,
  poId: string,
  employeeId: string,
): Promise<PurchaseOrder> {
  const { rows: [po] } = await query<PurchaseOrder>(
    `UPDATE purchase_orders
     SET status = 'sent', sent_at = now(), updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status = 'draft'
     RETURNING *`,
    [poId, orgId],
  );
  if (!po) throw new PurchaseOrderError('Purchase order not found or not in draft status');

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'purchase_order.sent', resourceType: 'purchase_order', resourceId: poId,
  });
  return po;
}

// ─── confirmPurchaseOrder ─────────────────────────────────────────────────────

export async function confirmPurchaseOrder(
  orgId: string,
  poId: string,
  employeeId: string,
): Promise<PurchaseOrder> {
  const { rows: [po] } = await query<PurchaseOrder>(
    `UPDATE purchase_orders
     SET status = 'confirmed', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status IN ('draft','sent')
     RETURNING *`,
    [poId, orgId],
  );
  if (!po) throw new PurchaseOrderError('Purchase order not found or cannot be confirmed');
  return po;
}

// ─── cancelPurchaseOrder ──────────────────────────────────────────────────────

export async function cancelPurchaseOrder(
  orgId: string,
  poId: string,
  employeeId: string,
  reason?: string,
): Promise<PurchaseOrder> {
  const { rows: [po] } = await query<PurchaseOrder>(
    `UPDATE purchase_orders
     SET status = 'cancelled', notes = COALESCE($3, notes), updated_at = now()
     WHERE id = $1 AND organization_id = $2
       AND status NOT IN ('received','cancelled')
     RETURNING *`,
    [poId, orgId, reason ?? null],
  );
  if (!po) throw new PurchaseOrderError('Purchase order not found or cannot be cancelled');

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'purchase_order.cancelled', resourceType: 'purchase_order', resourceId: poId,
    afterState: { reason },
  });
  return po;
}

// ─── receivePurchaseOrder ─────────────────────────────────────────────────────
// Delegates actual inventory receipt to inventory.service.receiveStock — only
// PO status bookkeeping lives here.

export async function receivePurchaseOrder(
  orgId: string,
  poId: string,
  employeeId: string,
  lines: ReceivePOLineInput[],
): Promise<PurchaseOrder & { lines: PurchaseOrderLine[] }> {
  if (lines.length === 0) throw new ValidationError('Must provide at least one line to receive');

  return withTransaction(async (client) => {
    // Lock PO
    const { rows: [po] } = await client.query<PurchaseOrder>(
      `SELECT * FROM purchase_orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [poId, orgId],
    );
    if (!po) throw new NotFoundError('Purchase order');
    if (!['sent', 'confirmed', 'partially_received'].includes(po.status)) {
      throw new PurchaseOrderError(
        `Cannot receive a purchase order in status "${po.status}"`,
      );
    }

    // Load all PO lines
    const { rows: allPoLines } = await client.query<PurchaseOrderLine>(
      `SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1`,
      [poId],
    );
    const poLineMap = new Map(allPoLines.map((l) => [l.id, l]));

    // Apply received quantities
    for (const recv of lines) {
      if (recv.quantityReceived <= 0) throw new ValidationError('Received quantity must be greater than 0');
      const poLine = poLineMap.get(recv.poLineId);
      if (!poLine) throw new ValidationError(`PO line ${recv.poLineId} not found on this order`);

      const newReceived = Number(poLine.quantity_received) + recv.quantityReceived;
      if (newReceived > Number(poLine.quantity_ordered)) {
        throw new ValidationError(
          `Receiving ${recv.quantityReceived} units for line ${recv.poLineId} would exceed ordered quantity ${poLine.quantity_ordered}`,
        );
      }

      const unitCost = recv.unitCostOverride ?? Number(poLine.unit_cost);

      await client.query(
        `UPDATE purchase_order_lines
         SET quantity_received = $1,
             unit_cost         = $2,
             total_cost        = $1 * $2,
             received_at       = now(),
             updated_at        = now()
         WHERE id = $3`,
        [newReceived, unitCost, recv.poLineId],
      );

      // Update inventory (weighted average cost + quantity)
      // First ensure an inventory_levels row exists
      await client.query(
        `INSERT INTO inventory_levels
           (organization_id, location_id, product_id, variant_id,
            quantity_on_hand, quantity_on_order, reorder_point, reorder_quantity)
         VALUES ($1,$2,$3,$4,0,0,NULL,NULL)
         ON CONFLICT DO NOTHING`,
        [orgId, po.location_id, poLine.product_id, poLine.variant_id],
      );

      // Weighted average cost update + increment quantity
      await client.query(
        `UPDATE inventory_levels
         SET quantity_on_hand = quantity_on_hand + $1,
             updated_at       = now()
         WHERE organization_id = $2 AND location_id = $3
           AND product_id = $4
           AND ($5::uuid IS NULL AND variant_id IS NULL OR variant_id = $5)`,
        [recv.quantityReceived, orgId, po.location_id, poLine.product_id, poLine.variant_id],
      );

      // Record inventory movement
      await client.query(
        `INSERT INTO inventory_movements
           (organization_id, location_id, product_id, variant_id,
            movement_type, quantity_delta,
            quantity_before, quantity_after,
            reference_type, reference_id,
            employee_id, notes, metadata)
         SELECT
           $1,$2,$3,$4,
           'po_receipt', $5,
           quantity_on_hand - $5, quantity_on_hand,
           'purchase_order', $6::uuid,
           $7, $8, '{}'::jsonb
         FROM inventory_levels
         WHERE organization_id = $1 AND location_id = $2
           AND product_id = $3
           AND ($4::uuid IS NULL AND variant_id IS NULL OR variant_id = $4)`,
        [
          orgId, po.location_id, poLine.product_id, poLine.variant_id,
          recv.quantityReceived, poId, employeeId,
          `Received from PO ${po.po_number}`,
        ],
      );

      // Also update product cost_price (weighted average)
      if (recv.unitCostOverride) {
        await client.query(
          `UPDATE products SET cost_price = $1, updated_at = now() WHERE id = $2`,
          [unitCost, poLine.product_id],
        );
      }
    }

    // Reload lines to check completion
    const { rows: updatedLines } = await client.query<PurchaseOrderLine>(
      `SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1`,
      [poId],
    );
    const allReceived = updatedLines.every(
      (l) => Number(l.quantity_received) >= Number(l.quantity_ordered),
    );

    const newStatus = allReceived ? 'received' : 'partially_received';
    const { rows: [updatedPo] } = await client.query<PurchaseOrder>(
      `UPDATE purchase_orders
       SET status      = $1,
           received_at = CASE WHEN $2 THEN now() ELSE received_at END,
           updated_at  = now()
       WHERE id = $3 RETURNING *`,
      [newStatus, allReceived, poId],
    );

    void createAuditLog({
      organizationId: orgId, actorId: employeeId,
      action: 'purchase_order.received', resourceType: 'purchase_order', resourceId: poId,
      afterState: { status: newStatus, linesReceived: lines.length },
    });

    return { ...updatedPo, lines: updatedLines };
  });
}

// ─── getPurchaseOrder ─────────────────────────────────────────────────────────

export async function getPurchaseOrder(
  orgId: string,
  poId: string,
): Promise<PurchaseOrder & { lines: PurchaseOrderLine[] }> {
  const { rows: [po] } = await query<PurchaseOrder>(
    `SELECT * FROM purchase_orders WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [poId, orgId],
  );
  if (!po) throw new NotFoundError('Purchase order');

  const { rows: lines } = await query<PurchaseOrderLine>(
    `SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY created_at`,
    [poId],
  );
  return { ...po, lines };
}

// ─── listPurchaseOrders ───────────────────────────────────────────────────────

export async function listPurchaseOrders(
  orgId: string,
  filter: ListPOFilter = {},
): Promise<{ purchaseOrders: PurchaseOrder[]; total: number }> {
  const conds = [`organization_id = $1`, `deleted_at IS NULL`];
  const params: unknown[] = [orgId];

  const addParam = (cond: string, value: unknown) => {
    params.push(value);
    conds.push(cond.replace('?', `$${params.length}`));
  };

  if (filter.status)     addParam(`status = ?`, filter.status);
  if (filter.supplierId) addParam(`supplier_id = ?`, filter.supplierId);
  if (filter.locationId) addParam(`location_id = ?`, filter.locationId);
  if (filter.dateFrom)   addParam(`created_at >= ?`, filter.dateFrom);
  if (filter.dateTo)     addParam(`created_at <= ?`, filter.dateTo);

  const where = conds.join(' AND ');
  const limit  = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const [{ rows: pos }, { rows: [countRow] }] = await Promise.all([
    query<PurchaseOrder>(
      `SELECT * FROM purchase_orders WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM purchase_orders WHERE ${where}`, params),
  ]);

  return { purchaseOrders: pos, total: parseInt(countRow.count, 10) };
}
