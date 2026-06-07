import { query, withTransaction } from '../db/client';
import type { PoolClient } from 'pg';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  PricingError,
} from '../errors';
import type {
  Order,
  OrderWithRelations,
  OrderLineItem,
  AppliedDiscount,
  OrderType,
  Discount,
  Payment,
  Customer,
} from '@taproot/shared';
import { publishOrderEvent, buildEvent } from './realtime.service';
import { createAuditLog } from '../auth/audit';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateLineItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPriceOverride?: number;
  notes?: string | null;
  modifiers?: Array<{ modifierId: string; name: string; priceDelta: number }>;
}

export interface CreateOrderInput {
  orderType: OrderType;
  tableId?: string | null;
  customerId?: string | null;
  notes?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
  lineItems: CreateLineItemInput[];
  discountCodes?: string[];
  discountIds?: string[];
}

export interface UpdateOrderInput {
  tableId?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
  lineItemsToAdd?: CreateLineItemInput[];
  lineItemsToVoid?: Array<{ lineItemId: string; voidReason?: string }>;
  discountCodes?: string[];
  discountIds?: string[];
}

export interface SplitOrderInput {
  splits: Array<{
    lineItemIds: string[];
    employeeId?: string;
  }>;
}

export interface ListOrdersFilter {
  status?: string;
  orderType?: string;
  customerId?: string;
  /** When set, restricts results to this employee (cashier self-service) */
  restrictToEmployeeId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ─── Internal calc types ──────────────────────────────────────────────────────

interface ResolvedLineItem {
  productId: string;
  categoryId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  modifiers: Array<{ modifierId: string; name: string; priceDelta: number }>;
  notes: string | null;
}

interface DiscountApplication {
  discountId: string | null;
  name: string;
  discountType: string;
  value: number;
  amountSaved: number;
  lineItemId: string | null;
}

// ─── resolveLineItems ─────────────────────────────────────────────────────────

async function resolveLineItems(
  client: PoolClient,
  orgId: string,
  locationId: string,
  inputs: CreateLineItemInput[],
): Promise<ResolvedLineItem[]> {
  if (inputs.length === 0) {
    throw new ValidationError('Order must have at least one line item');
  }

  const resolved: ResolvedLineItem[] = [];

  for (const item of inputs) {
    if (item.quantity <= 0) {
      throw new ValidationError('Line item quantity must be greater than 0');
    }

    // Load product
    const { rows: [product] } = await client.query<{
      id: string; category_id: string | null; name: string; sku: string | null;
      cost_price: number; is_active: boolean; deleted_at: string | null;
    }>(
      `SELECT id, category_id, name, sku, cost_price, is_active, deleted_at
       FROM products
       WHERE id = $1 AND organization_id = $2`,
      [item.productId, orgId],
    );
    if (!product || product.deleted_at || !product.is_active) {
      throw new ValidationError(`Product ${item.productId} is not available`);
    }

    let variantId: string | null = null;
    let variantLabel: string | null = null;
    let sku = product.sku;
    let costPrice = product.cost_price;

    if (item.variantId) {
      const { rows: [v] } = await client.query<{
        id: string; name: string; sku: string | null; cost_price: number;
        is_active: boolean; deleted_at: string | null;
      }>(
        `SELECT id, name, sku, cost_price, is_active, deleted_at
         FROM product_variants
         WHERE id = $1 AND product_id = $2 AND organization_id = $3`,
        [item.variantId, item.productId, orgId],
      );
      if (!v || v.deleted_at || !v.is_active) {
        throw new ValidationError(`Variant ${item.variantId} is not available`);
      }
      variantId = v.id;
      variantLabel = v.name;
      sku = v.sku ?? product.sku;
      costPrice = v.cost_price;
    } else {
      // Default: first active variant
      const { rows: [dv] } = await client.query<{
        id: string; name: string; sku: string | null; cost_price: number;
      }>(
        `SELECT id, name, sku, cost_price
         FROM product_variants
         WHERE product_id = $1 AND organization_id = $2
           AND is_active = true AND deleted_at IS NULL
         ORDER BY sort_order ASC LIMIT 1`,
        [item.productId, orgId],
      );
      if (dv) {
        variantId = dv.id;
        variantLabel = dv.name;
        sku = dv.sku ?? product.sku;
        costPrice = dv.cost_price;
      }
    }

    // Resolve unit price
    let unitPrice: number;

    if (item.unitPriceOverride !== undefined) {
      unitPrice = item.unitPriceOverride;
    } else if (variantId) {
      // Prefer location-specific price; fall back to org-wide (location_id IS NULL)
      const { rows: [priceRow] } = await client.query<{ price: number }>(
        `SELECT price FROM product_prices
         WHERE variant_id = $1
           AND is_active = true
           AND effective_from <= now()
           AND (effective_until IS NULL OR effective_until >= now())
         ORDER BY (location_id = $2::uuid) DESC NULLS LAST, effective_from DESC
         LIMIT 1`,
        [variantId, locationId],
      );
      if (!priceRow) throw new PricingError(variantId, locationId);
      unitPrice = priceRow.price;
    } else {
      throw new PricingError(item.productId, locationId);
    }

    // Validate modifiers and accumulate price deltas
    const resolvedMods: Array<{ modifierId: string; name: string; priceDelta: number }> = [];
    for (const mod of (item.modifiers ?? [])) {
      const { rows: [m] } = await client.query<{
        id: string; name: string; price_delta: number;
      }>(
        `SELECT id, name, price_delta FROM modifiers
         WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
        [mod.modifierId],
      );
      if (!m) throw new ValidationError(`Modifier ${mod.modifierId} not found or inactive`);
      resolvedMods.push({ modifierId: m.id, name: m.name, priceDelta: m.price_delta });
      unitPrice += m.price_delta;
    }

    resolved.push({
      productId: item.productId,
      categoryId: product.category_id,
      variantId,
      name: variantLabel ? `${product.name} — ${variantLabel}` : product.name,
      sku,
      quantity: item.quantity,
      unitPrice,
      costPrice,
      modifiers: resolvedMods,
      notes: item.notes ?? null,
    });
  }

  return resolved;
}

// ─── applyDiscounts ───────────────────────────────────────────────────────────

async function applyDiscounts(
  client: PoolClient,
  orgId: string,
  subtotal: number,
  lineItems: ResolvedLineItem[],
  discountCodes: string[],
  discountIds: string[],
): Promise<DiscountApplication[]> {
  if (subtotal <= 0) return [];

  const conds = [
    `organization_id = $1`,
    `is_active = true`,
    `deleted_at IS NULL`,
    `active_from <= now()`,
    `(active_until IS NULL OR active_until >= now())`,
    `(usage_limit IS NULL OR usage_count < usage_limit)`,
  ];
  const params: unknown[] = [orgId];

  if (discountCodes.length > 0 || discountIds.length > 0) {
    const parts: string[] = [];
    if (discountCodes.length > 0) {
      const ph = discountCodes.map((_, i) => `$${params.length + i + 1}`);
      parts.push(`code IN (${ph.join(',')})`);
      params.push(...discountCodes);
    }
    if (discountIds.length > 0) {
      const ph = discountIds.map((_, i) => `$${params.length + i + 1}`);
      parts.push(`id IN (${ph.join(',')})`);
      params.push(...discountIds);
    }
    conds.push(`(${parts.join(' OR ')})`);
  } else {
    conds.push(`code IS NULL`);
  }

  const { rows: discounts } = await client.query<Discount>(
    `SELECT * FROM discounts WHERE ${conds.join(' AND ')} ORDER BY priority ASC FOR UPDATE`,
    params,
  );
  if (discounts.length === 0) return [];

  const productIds = new Set(lineItems.map((li) => li.productId));
  const categoryIds = new Set(
    lineItems.map((li) => li.categoryId).filter((id): id is string => id !== null),
  );

  const applications: DiscountApplication[] = [];
  let nonStackableApplied = false;
  let remaining = subtotal;

  for (const d of discounts) {
    if (remaining <= 0) break;

    // applies_to filter
    if (d.applies_to === 'product') {
      const ids = d.applies_to_ids ?? [];
      if (!ids.some((id) => productIds.has(id))) continue;
    } else if (d.applies_to === 'category') {
      const ids = d.applies_to_ids ?? [];
      if (!ids.some((id) => categoryIds.has(id))) continue;
    }

    // minimum order amount
    if (d.minimum_order_amount !== null && subtotal < d.minimum_order_amount) continue;

    // stackability
    if (!d.stackable) {
      if (nonStackableApplied) continue;
      nonStackableApplied = true;
    }

    // compute savings
    let saved = 0;
    if (d.discount_type === 'percentage') {
      saved = Math.round(remaining * (d.value / 100));
    } else if (d.discount_type === 'fixed_amount') {
      saved = Math.min(d.value, remaining);
    } else if (d.discount_type === 'bogo') {
      const eligible = d.applies_to === 'product' && d.applies_to_ids?.length
        ? lineItems.filter((li) => d.applies_to_ids!.includes(li.productId))
        : lineItems;
      saved = eligible.reduce((s, li) => s + Math.floor(li.quantity / 2) * li.unitPrice, 0);
    } else if (d.discount_type === 'free_item') {
      const eligible = d.applies_to === 'product' && d.applies_to_ids?.length
        ? lineItems.filter((li) => d.applies_to_ids!.includes(li.productId))
        : lineItems;
      if (eligible.length > 0) {
        saved = Math.min(...eligible.map((li) => li.unitPrice));
      }
    }

    if (d.maximum_discount_amount !== null) saved = Math.min(saved, d.maximum_discount_amount);
    saved = Math.min(saved, remaining);
    if (saved <= 0) continue;

    remaining -= saved;
    applications.push({
      discountId: d.id,
      name: d.name,
      discountType: d.discount_type,
      value: d.value,
      amountSaved: saved,
      lineItemId: null,
    });
  }

  return applications;
}

// ─── calculateTax ─────────────────────────────────────────────────────────────
// Tax rates are stored in locations.tax_config JSONB as:
//   { rates: [{ name: string, rate: number, included: boolean }] }
// If tax_config is missing or has no rates, returns 0.

async function calculateTax(
  client: PoolClient,
  _orgId: string,
  taxableAmount: number,
  locationId?: string,
): Promise<number> {
  if (taxableAmount <= 0 || !locationId) return 0;
  const { rows } = await client.query<{ tax_config: { rates?: Array<{ rate: number; included?: boolean }> } }>(
    `SELECT tax_config FROM locations WHERE id = $1`,
    [locationId],
  );
  if (rows.length === 0) return 0;
  const rateEntries = rows[0].tax_config?.rates ?? [];
  if (rateEntries.length === 0) return 0;
  // Only sum non-included (exclusive) rates; included taxes are already in the price
  const totalRate = rateEntries
    .filter((r) => !r.included)
    .reduce((s, r) => s + Number(r.rate), 0);
  return Math.round(taxableAmount * totalRate);
}

// ─── incrementDiscountUsage / decrementDiscountUsage ─────────────────────────

async function incrementDiscountUsage(
  client: PoolClient,
  discountApps: DiscountApplication[],
): Promise<void> {
  for (const d of discountApps) {
    if (d.discountId) {
      await client.query(
        `UPDATE discounts SET usage_count = usage_count + 1 WHERE id = $1`,
        [d.discountId],
      );
    }
  }
}

async function decrementDiscountUsage(
  client: PoolClient,
  appliedDiscounts: AppliedDiscount[],
): Promise<void> {
  for (const d of appliedDiscounts) {
    if (d.discount_id) {
      await client.query(
        `UPDATE discounts SET usage_count = GREATEST(0, usage_count - 1) WHERE id = $1`,
        [d.discount_id],
      );
    }
  }
}

// ─── fetchOrderWithRelations ──────────────────────────────────────────────────

async function fetchOrderWithRelations(orderId: string, orgId: string): Promise<OrderWithRelations> {
  const { rows: [order] } = await query<Order>(
    `SELECT * FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');

  const [{ rows: lineItems }, { rows: payments }, { rows: discounts }] = await Promise.all([
    query<OrderLineItem>(
      `SELECT * FROM order_line_items WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    ),
    query<Payment>(`SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at`, [orderId]),
    query<AppliedDiscount>(
      `SELECT * FROM applied_discounts WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    ),
  ]);

  let customer: Customer | null = null;
  if (order.customer_id) {
    const { rows: [c] } = await query<Customer>(
      `SELECT * FROM customers WHERE id = $1 AND organization_id = $2`,
      [order.customer_id, order.organization_id],
    );
    customer = c ?? null;
  }

  return { ...order, lineItems, payments, discounts, customer } as OrderWithRelations;
}

// ─── recalcAndSaveOrder ───────────────────────────────────────────────────────
// Re-runs discount + tax math on existing line items and writes updated totals.

async function recalcAndSaveOrder(
  client: PoolClient,
  orgId: string,
  orderId: string,
  customerId: string | null,
  discountCodes: string[],
  discountIds: string[],
): Promise<void> {
  const { rows: items } = await client.query<OrderLineItem>(
    `SELECT * FROM order_line_items WHERE order_id = $1 AND voided_at IS NULL`,
    [orderId],
  );
  const subtotal = items.reduce((s, li) => s + Number(li.unit_price) * Number(li.quantity), 0);

  // Look up location_id for tax calculation
  const { rows: [orderRow] } = await client.query<{ location_id: string }>(
    `SELECT location_id FROM orders WHERE id = $1`,
    [orderId],
  );
  const locationId = orderRow?.location_id;

  // Reverse old discounts
  const { rows: oldDiscounts } = await client.query<AppliedDiscount>(
    `SELECT * FROM applied_discounts WHERE order_id = $1`,
    [orderId],
  );
  await decrementDiscountUsage(client, oldDiscounts);
  await client.query(`DELETE FROM applied_discounts WHERE order_id = $1`, [orderId]);

  const resolvedForDiscount: ResolvedLineItem[] = items.map((li) => ({
    productId: li.product_id,
    categoryId: null,
    variantId: li.variant_id,
    name: li.name,
    sku: li.sku,
    quantity: Number(li.quantity),
    unitPrice: Number(li.unit_price),
    costPrice: Number(li.cost_price),
    modifiers: Array.isArray(li.modifiers) ? (li.modifiers as Array<{ modifierId: string; name: string; priceDelta: number }>) : [],
    notes: li.notes,
  }));

  const discountApps = await applyDiscounts(
    client, orgId, subtotal, resolvedForDiscount, discountCodes, discountIds,
  );
  const discountTotal = discountApps.reduce((s, d) => s + d.amountSaved, 0);
  const taxTotal = await calculateTax(client, orgId, Math.max(0, subtotal - discountTotal), locationId);
  const total = subtotal - discountTotal + taxTotal;

  // Re-insert applied_discounts
  for (const disc of discountApps) {
    await client.query(
      `INSERT INTO applied_discounts
         (order_id, line_item_id, discount_id, name, discount_type, value, amount_saved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, disc.lineItemId, disc.discountId, disc.name, disc.discountType, disc.value, disc.amountSaved],
    );
  }
  await incrementDiscountUsage(client, discountApps);

  // Update order totals
  await client.query(
    `UPDATE orders
     SET subtotal = $1, discount_total = $2, tax_total = $3, total = $4, updated_at = now()
     WHERE id = $5`,
    [subtotal, discountTotal, taxTotal, total, orderId],
  );
}

// ─── createOrder ──────────────────────────────────────────────────────────────

export async function createOrder(
  orgId: string,
  locationId: string,
  employeeId: string,
  input: CreateOrderInput,
): Promise<OrderWithRelations> {
  const txResult = await withTransaction(async (client) => {
    // Verify location
    const { rows: [loc] } = await client.query<{ id: string; is_active: boolean; deleted_at: string | null }>(
      `SELECT id, is_active, deleted_at FROM locations WHERE id = $1 AND organization_id = $2`,
      [locationId, orgId],
    );
    if (!loc || !loc.is_active || loc.deleted_at) throw new ValidationError('Location not found or inactive');

    // Verify employee (employees uses deleted_at for soft-delete, no is_active column)
    const { rows: [emp] } = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [employeeId, orgId],
    );
    if (!emp) throw new ValidationError('Employee not found or inactive');

    // Verify customer
    if (input.customerId) {
      const { rows: [c] } = await client.query<{ id: string }>(
        `SELECT id FROM customers WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [input.customerId, orgId],
      );
      if (!c) throw new ValidationError('Customer not found');
    }

    // Verify table
    if (input.tableId) {
      const { rows: [t] } = await client.query<{ id: string; is_active: boolean; deleted_at: string | null }>(
        `SELECT id, is_active, deleted_at FROM tables WHERE id = $1 AND location_id = $2 AND organization_id = $3`,
        [input.tableId, locationId, orgId],
      );
      if (!t || !t.is_active || t.deleted_at) throw new ValidationError('Table not found or inactive');
    }

    // Resolve items → prices + modifiers
    const items = await resolveLineItems(client, orgId, locationId, input.lineItems);
    const subtotal = items.reduce((s, li) => s + li.unitPrice * li.quantity, 0);

    // Discounts
    const discountApps = await applyDiscounts(
      client, orgId, subtotal, items,
      input.discountCodes ?? [], input.discountIds ?? [],
    );
    const discountTotal = discountApps.reduce((s, d) => s + d.amountSaved, 0);

    // Tax
    const taxTotal = await calculateTax(client, orgId, Math.max(0, subtotal - discountTotal), locationId);
    const total = subtotal - discountTotal + taxTotal;

    // Insert order (order_number='' → DB trigger generates it)
    const { rows: [newOrder] } = await client.query<Order>(
      `INSERT INTO orders
         (organization_id, location_id, customer_id, employee_id,
          order_number, status, order_type, table_id,
          subtotal, discount_total, tax_total, tip_total, total,
          amount_paid, change_due, notes, source, metadata)
       VALUES ($1,$2,$3,$4,'','open',$5,$6,$7,$8,$9,0,$10,0,0,$11,$12,$13)
       RETURNING *`,
      [
        orgId, locationId, input.customerId ?? null, employeeId,
        input.orderType, input.tableId ?? null,
        subtotal, discountTotal, taxTotal, total,
        input.notes ?? null, input.source ?? 'pos', input.metadata ?? {},
      ],
    );

    // Insert line items (discount/tax proportional by line subtotal share)
    const lineItems: OrderLineItem[] = [];
    for (const li of items) {
      const lineSub = li.unitPrice * li.quantity;
      const pct = subtotal > 0 ? lineSub / subtotal : 0;
      const lineDiscount = Math.round(discountTotal * pct);
      const lineTax = Math.round(taxTotal * pct);
      const { rows: [row] } = await client.query<OrderLineItem>(
        `INSERT INTO order_line_items
           (order_id, product_id, variant_id, name, sku,
            quantity, unit_price, cost_price,
            discount_amount, tax_amount, total,
            modifiers, notes, employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          newOrder.id, li.productId, li.variantId, li.name, li.sku,
          li.quantity, li.unitPrice, li.costPrice,
          lineDiscount, lineTax, lineSub - lineDiscount + lineTax,
          li.modifiers, li.notes, employeeId,
        ],
      );
      lineItems.push(row);
    }

    // Insert applied_discounts + increment usage
    const insertedDiscounts: AppliedDiscount[] = [];
    for (const disc of discountApps) {
      const { rows: [ad] } = await client.query<AppliedDiscount>(
        `INSERT INTO applied_discounts
           (order_id, line_item_id, discount_id, name, discount_type, value, amount_saved)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [newOrder.id, disc.lineItemId, disc.discountId, disc.name, disc.discountType, disc.value, disc.amountSaved],
      );
      insertedDiscounts.push(ad);
    }
    await incrementDiscountUsage(client, discountApps);

    // Customer stats
    if (input.customerId) {
      await client.query(
        `UPDATE customers
         SET visit_count = visit_count + 1, total_spend = total_spend + $1,
             last_visit_at = now(), updated_at = now()
         WHERE id = $2`,
        [total, input.customerId],
      );
    }

    return { order: newOrder, lineItems, discounts: insertedDiscounts };
  });

  void publishOrderEvent(buildEvent('order:created', locationId, txResult.order.id, {
    orderNumber: txResult.order.order_number,
    orderType: txResult.order.order_type,
    total: txResult.order.total,
    employeeId,
  }));
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'order.created', resourceType: 'order', resourceId: txResult.order.id,
    afterState: { orderNumber: txResult.order.order_number, total: txResult.order.total },
  });

  return {
    ...txResult.order,
    lineItems: txResult.lineItems,
    payments: [],
    discounts: txResult.discounts,
    customer: null,
  } as OrderWithRelations;
}

// ─── getOrder ────────────────────────────────────────────────────────────────

export async function getOrder(
  orgId: string,
  orderId: string,
  /** Cashier restriction: when set, only allows viewing own orders */
  restrictToEmployeeId?: string,
): Promise<OrderWithRelations> {
  const order = await fetchOrderWithRelations(orderId, orgId);
  if (restrictToEmployeeId && order.employee_id !== restrictToEmployeeId) {
    throw new ForbiddenError('Access denied to this order');
  }
  return order;
}

// ─── listOrders ───────────────────────────────────────────────────────────────

export async function listOrders(
  orgId: string,
  locationId: string,
  filter: ListOrdersFilter = {},
): Promise<{ orders: Order[]; total: number }> {
  const conds = [`o.organization_id = $1`, `o.location_id = $2`];
  const params: unknown[] = [orgId, locationId];

  const addParam = (cond: string, value: unknown) => {
    params.push(value);
    conds.push(cond.replace('?', `$${params.length}`));
  };

  if (filter.status)               addParam(`o.status = ?`, filter.status);
  if (filter.orderType)            addParam(`o.order_type = ?`, filter.orderType);
  if (filter.customerId)           addParam(`o.customer_id = ?`, filter.customerId);
  if (filter.restrictToEmployeeId) addParam(`o.employee_id = ?`, filter.restrictToEmployeeId);
  if (filter.dateFrom)             addParam(`o.created_at >= ?`, filter.dateFrom);
  if (filter.dateTo)               addParam(`o.created_at <= ?`, filter.dateTo);

  const where = conds.join(' AND ');
  const limit  = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const [{ rows: orders }, { rows: [countRow] }] = await Promise.all([
    query<Order>(
      `SELECT o.* FROM orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<{ count: string }>(`SELECT COUNT(*) AS count FROM orders o WHERE ${where}`, params),
  ]);

  return { orders, total: parseInt(countRow.count, 10) };
}

// ─── listOrderHistory ───────────────────────────────────────────────────────
// Org-wide enriched order list for the Order History screen. Joins employee +
// customer names, payment methods, and line-item counts.

export interface OrderHistoryFilter {
  status?:        string;   // 'all' | order status
  employeeId?:    string;
  paymentMethod?: string;
  from?:          string;   // ISO
  to?:            string;   // ISO
  search?:        string;   // order number or customer name
  locationId?:    string;
  page?:          number;
  limit?:         number;
  restrictToEmployeeId?: string;
}

export interface OrderHistoryRow {
  id:              string;
  order_number:    string;
  status:          string;
  order_type:      string;
  total:           number;
  amount_paid:     number;
  tip_total:       number;
  created_at:      string;
  employee_name:   string;
  customer_name:   string | null;
  item_count:      number;
  payment_methods: string | null;
}

export async function listOrderHistory(
  orgId: string,
  filter: OrderHistoryFilter = {},
): Promise<{ orders: OrderHistoryRow[]; total: number }> {
  const conds = [`o.organization_id = $1`];
  const params: unknown[] = [orgId];
  const add = (cond: string, value: unknown) => { params.push(value); conds.push(cond.replace('?', `$${params.length}`)); };

  if (filter.locationId)  add(`o.location_id = ?`, filter.locationId);
  if (filter.status && filter.status !== 'all') {
    if (filter.status === 'refunded') conds.push(`o.status IN ('refunded','partially_refunded')`);
    else add(`o.status = ?`, filter.status);
  }
  if (filter.employeeId)  add(`o.employee_id = ?`, filter.employeeId);
  if (filter.restrictToEmployeeId) add(`o.employee_id = ?`, filter.restrictToEmployeeId);
  if (filter.from)        add(`o.created_at >= ?`, filter.from);
  if (filter.to)          add(`o.created_at <= ?`, filter.to);
  if (filter.paymentMethod) {
    add(`EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.payment_method = ?)`, filter.paymentMethod);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    const i = params.length;
    conds.push(`(o.order_number ILIKE $${i} OR (c.first_name || ' ' || c.last_name) ILIKE $${i})`);
  }

  const where = conds.join(' AND ');
  const limit  = Math.min(filter.limit ?? 50, 200);
  const offset = ((filter.page ?? 1) - 1) * limit;

  const selectBody = `
    FROM orders o
    JOIN employees e ON e.id = o.employee_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${where}`;

  const [{ rows }, { rows: [countRow] }] = await Promise.all([
    query<OrderHistoryRow>(
      `SELECT o.id, o.order_number, o.status, o.order_type, o.total, o.amount_paid,
              o.tip_total, o.created_at,
              e.first_name || ' ' || e.last_name AS employee_name,
              NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS customer_name,
              (SELECT COUNT(*)::int FROM order_line_items oli WHERE oli.order_id = o.id AND oli.voided_at IS NULL) AS item_count,
              (SELECT STRING_AGG(DISTINCT p.payment_method, ',') FROM payments p
                 WHERE p.order_id = o.id AND p.status IN ('completed','refunded','partially_refunded')) AS payment_methods
       ${selectBody}
       ORDER BY o.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query<{ count: string }>(`SELECT COUNT(*) AS count ${selectBody}`, params),
  ]);

  return { orders: rows, total: parseInt(countRow?.count ?? '0', 10) };
}

// ─── updateOrder ──────────────────────────────────────────────────────────────

export async function updateOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  employeeId: string,
  input: UpdateOrderInput,
): Promise<OrderWithRelations> {
  await withTransaction(async (client) => {
    const { rows: [order] } = await client.query<Order>(
      `SELECT * FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [orderId, orgId],
    );
    if (!order) throw new NotFoundError('Order');
    if (order.status !== 'open' && order.status !== 'in_progress') {
      throw new ValidationError(`Cannot update an order with status "${order.status}"`);
    }

    // Patch scalar fields
    if (input.tableId !== undefined || input.notes !== undefined || input.metadata !== undefined) {
      await client.query(
        `UPDATE orders
         SET table_id   = COALESCE($1, table_id),
             notes      = COALESCE($2, notes),
             metadata   = COALESCE($3::jsonb, metadata),
             updated_at = now()
         WHERE id = $4`,
        [
          input.tableId ?? null,
          input.notes ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          orderId,
        ],
      );
    }

    // Void requested line items
    for (const v of (input.lineItemsToVoid ?? [])) {
      await client.query(
        `UPDATE order_line_items
         SET voided_at = now(), void_reason = $1, updated_at = now()
         WHERE id = $2 AND order_id = $3 AND voided_at IS NULL`,
        [v.voidReason ?? null, v.lineItemId, orderId],
      );
    }

    // Add new line items (no discount/tax yet — recalculated below)
    if (input.lineItemsToAdd?.length) {
      const newItems = await resolveLineItems(client, orgId, locationId, input.lineItemsToAdd);
      for (const li of newItems) {
        await client.query(
          `INSERT INTO order_line_items
             (order_id, product_id, variant_id, name, sku,
              quantity, unit_price, cost_price,
              discount_amount, tax_amount, total, modifiers, notes, employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,$9,$10,$11,$12)`,
          [
            orderId, li.productId, li.variantId, li.name, li.sku,
            li.quantity, li.unitPrice, li.costPrice,
            li.unitPrice * li.quantity,
            li.modifiers, li.notes, employeeId,
          ],
        );
      }
    }

    // Recalculate all totals + re-apply discounts
    await recalcAndSaveOrder(
      client, orgId, orderId, order.customer_id,
      input.discountCodes ?? [], input.discountIds ?? [],
    );
  });

  void publishOrderEvent(buildEvent('order:updated', locationId, orderId, { employeeId }));
  return fetchOrderWithRelations(orderId, orgId);
}

// ─── voidOrder ────────────────────────────────────────────────────────────────

export async function voidOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  employeeId: string,
  voidReason: string,
): Promise<Order> {
  const voided = await withTransaction(async (client) => {
    const { rows: [order] } = await client.query<Order>(
      `SELECT * FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [orderId, orgId],
    );
    if (!order) throw new NotFoundError('Order');
    if (order.status === 'voided') throw new ValidationError('Order is already voided');
    if (order.status === 'completed') throw new ValidationError('Cannot void a completed order');

    // Reverse discount usage counts
    const { rows: ads } = await client.query<AppliedDiscount>(
      `SELECT * FROM applied_discounts WHERE order_id = $1`,
      [orderId],
    );
    await decrementDiscountUsage(client, ads);

    // Void all active line items
    await client.query(
      `UPDATE order_line_items
       SET voided_at = now(), void_reason = $1, updated_at = now()
       WHERE order_id = $2 AND voided_at IS NULL`,
      [voidReason, orderId],
    );

    const { rows: [voidedOrder] } = await client.query<Order>(
      `UPDATE orders
       SET status = 'voided', voided_at = now(), void_reason = $1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [voidReason, orderId],
    );
    return voidedOrder;
  });

  void publishOrderEvent(buildEvent('order:voided', locationId, orderId, { voidReason, employeeId }));
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'order.voided', resourceType: 'order', resourceId: orderId,
    afterState: { voidReason },
  });

  return voided;
}

// ─── parkOrder ────────────────────────────────────────────────────────────────

export async function parkOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  employeeId: string,
): Promise<Order> {
  const { rows: [order] } = await query<Order>(
    `UPDATE orders
     SET status = 'parked', updated_at = now()
     WHERE id = $1 AND organization_id = $2 AND status IN ('open','in_progress')
     RETURNING *`,
    [orderId, orgId],
  );
  if (!order) throw new ValidationError('Order not found or cannot be parked in its current status');

  void publishOrderEvent(buildEvent('order:parked', locationId, orderId, { employeeId }));
  return order;
}

// ─── resumeOrder ─────────────────────────────────────────────────────────────

export async function resumeOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  employeeId: string,
): Promise<OrderWithRelations> {
  await withTransaction(async (client) => {
    const { rows: [order] } = await client.query<Order>(
      `SELECT * FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [orderId, orgId],
    );
    if (!order) throw new NotFoundError('Order');
    if (order.status !== 'parked') throw new ValidationError('Order is not parked');

    // Re-validate prices and refresh line item unit_price
    const { rows: items } = await client.query<OrderLineItem>(
      `SELECT * FROM order_line_items WHERE order_id = $1 AND voided_at IS NULL`,
      [orderId],
    );

    for (const li of items) {
      if (li.variant_id) {
        const { rows: [pr] } = await client.query<{ price: number }>(
          `SELECT price FROM product_prices
           WHERE variant_id = $1 AND is_active = true
             AND effective_from <= now() AND (effective_until IS NULL OR effective_until >= now())
           ORDER BY (location_id = $2::uuid) DESC NULLS LAST LIMIT 1`,
          [li.variant_id, locationId],
        );
        if (pr && Number(pr.price) !== Number(li.unit_price)) {
          await client.query(
            `UPDATE order_line_items SET unit_price = $1, updated_at = now() WHERE id = $2`,
            [pr.price, li.id],
          );
        }
      }
    }

    // Recalculate totals with refreshed prices (keep existing discount codes)
    await recalcAndSaveOrder(client, orgId, orderId, order.customer_id, [], []);

    await client.query(
      `UPDATE orders SET status = 'open', updated_at = now() WHERE id = $1`,
      [orderId],
    );
  });

  void publishOrderEvent(buildEvent('order:resumed', locationId, orderId, { employeeId }));
  return fetchOrderWithRelations(orderId, orgId);
}

// ─── splitOrder ───────────────────────────────────────────────────────────────

export async function splitOrder(
  orgId: string,
  locationId: string,
  orderId: string,
  employeeId: string,
  input: SplitOrderInput,
): Promise<OrderWithRelations[]> {
  if (input.splits.length < 2) throw new ValidationError('Split requires at least 2 groups');

  const allIds = input.splits.flatMap((s) => s.lineItemIds);
  if (new Set(allIds).size !== allIds.length) {
    throw new ValidationError('Duplicate line item IDs across split groups');
  }

  const newOrderIds = await withTransaction(async (client) => {
    const { rows: [original] } = await client.query<Order>(
      `SELECT * FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [orderId, orgId],
    );
    if (!original) throw new NotFoundError('Order');
    if (original.status !== 'open' && original.status !== 'in_progress') {
      throw new ValidationError(`Cannot split order in status "${original.status}"`);
    }

    const { rows: lineItems } = await client.query<OrderLineItem>(
      `SELECT * FROM order_line_items WHERE order_id = $1 AND voided_at IS NULL`,
      [orderId],
    );
    const liMap = new Map(lineItems.map((li) => [li.id, li]));

    // Validate: every item in the order must appear in exactly one split group
    const assignedIds = new Set(allIds);
    for (const id of allIds) {
      if (!liMap.has(id)) throw new ValidationError(`Line item ${id} not found`);
    }
    for (const li of lineItems) {
      if (!assignedIds.has(li.id)) {
        throw new ValidationError(`Line item ${li.id} must be assigned to a split group`);
      }
    }

    const { rows: originalAds } = await client.query<AppliedDiscount>(
      `SELECT * FROM applied_discounts WHERE order_id = $1`,
      [orderId],
    );
    const totalSaved = originalAds.reduce((s, d) => s + Number(d.amount_saved), 0);
    const originalSubtotal = Number(original.subtotal);

    const createdIds: string[] = [];

    for (const split of input.splits) {
      const splitItems = split.lineItemIds.map((id) => liMap.get(id)!);
      const splitSubtotal = splitItems.reduce(
        (s, li) => s + Number(li.unit_price) * Number(li.quantity),
        0,
      );
      const pct = originalSubtotal > 0 ? splitSubtotal / originalSubtotal : 0;
      const splitDiscount = Math.round(totalSaved * pct);
      const splitTax = Math.round(Number(original.tax_total) * pct);
      const splitTotal = splitSubtotal - splitDiscount + splitTax;

      const { rows: [newOrder] } = await client.query<Order>(
        `INSERT INTO orders
           (organization_id, location_id, customer_id, employee_id,
            order_number, status, order_type, table_id,
            subtotal, discount_total, tax_total, tip_total, total,
            amount_paid, change_due, notes, source, metadata)
         VALUES ($1,$2,$3,$4,'','open',$5,$6,$7,$8,$9,0,$10,0,0,$11,$12,$13)
         RETURNING *`,
        [
          orgId, locationId, original.customer_id, split.employeeId ?? employeeId,
          original.order_type, original.table_id,
          splitSubtotal, splitDiscount, splitTax, splitTotal,
          original.notes, original.source, original.metadata,
        ],
      );

      // Copy line items to new order
      for (const li of splitItems) {
        await client.query(
          `INSERT INTO order_line_items
             (order_id, product_id, variant_id, name, sku,
              quantity, unit_price, cost_price,
              discount_amount, tax_amount, total,
              modifiers, notes, employee_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            newOrder.id, li.product_id, li.variant_id, li.name, li.sku,
            li.quantity, li.unit_price, li.cost_price,
            Math.round(Number(li.discount_amount) * pct),
            Math.round(Number(li.tax_amount) * pct),
            Math.round(Number(li.total) * pct),
            li.modifiers, li.notes, li.employee_id,
          ],
        );
      }

      // Proportional discounts for split order
      for (const ad of originalAds) {
        const proportional = Math.round(Number(ad.amount_saved) * pct);
        if (proportional > 0) {
          await client.query(
            `INSERT INTO applied_discounts
               (order_id, line_item_id, discount_id, name, discount_type, value, amount_saved)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [newOrder.id, null, ad.discount_id, ad.name, ad.discount_type, ad.value, proportional],
          );
          if (ad.discount_id) {
            await client.query(
              `UPDATE discounts SET usage_count = usage_count + 1 WHERE id = $1`,
              [ad.discount_id],
            );
          }
        }
      }

      createdIds.push(newOrder.id);
    }

    // Void original (reverse original usage counts — split orders already got their own)
    await decrementDiscountUsage(client, originalAds);
    await client.query(
      `UPDATE order_line_items
       SET voided_at = now(), void_reason = 'split', updated_at = now()
       WHERE order_id = $1 AND voided_at IS NULL`,
      [orderId],
    );
    await client.query(
      `UPDATE orders
       SET status = 'voided', voided_at = now(), void_reason = 'split', updated_at = now()
       WHERE id = $1`,
      [orderId],
    );

    return createdIds;
  });

  const results = await Promise.all(newOrderIds.map((id) => fetchOrderWithRelations(id, orgId)));
  for (const o of results) {
    void publishOrderEvent(
      buildEvent('order:created', locationId, o.id, { splitFrom: orderId, orderNumber: o.order_number }),
    );
  }
  return results;
}

// ─── mergeOrders ──────────────────────────────────────────────────────────────

export async function mergeOrders(
  orgId: string,
  locationId: string,
  orderIds: string[],
  employeeId: string,
): Promise<OrderWithRelations> {
  if (orderIds.length < 2) throw new ValidationError('Merge requires at least 2 orders');

  const [primaryId, ...secondaryIds] = orderIds;

  await withTransaction(async (client) => {
    // Lock in sorted order to prevent deadlocks
    const sorted = [...orderIds].sort();
    const { rows: orders } = await client.query<Order>(
      `SELECT * FROM orders WHERE id = ANY($1) AND organization_id = $2 ORDER BY id FOR UPDATE`,
      [sorted, orgId],
    );
    if (orders.length !== orderIds.length) throw new NotFoundError('One or more orders not found');

    for (const o of orders) {
      if (!['open', 'in_progress', 'parked'].includes(o.status)) {
        throw new ValidationError(`Cannot merge order ${o.id} in status "${o.status}"`);
      }
    }

    // Move line items and discounts from secondaries to primary
    for (const secId of secondaryIds) {
      await client.query(
        `UPDATE order_line_items SET order_id = $1, updated_at = now()
         WHERE order_id = $2 AND voided_at IS NULL`,
        [primaryId, secId],
      );
      await client.query(
        `UPDATE applied_discounts SET order_id = $1 WHERE order_id = $2`,
        [primaryId, secId],
      );
      await client.query(
        `UPDATE orders
         SET status = 'voided', voided_at = now(), void_reason = 'merged', updated_at = now()
         WHERE id = $1`,
        [secId],
      );
    }

    // Recalculate primary order totals
    const primary = orders.find((o) => o.id === primaryId)!;
    await recalcAndSaveOrder(client, orgId, primaryId, primary.customer_id, [], []);

    await client.query(
      `UPDATE orders SET status = 'open', updated_at = now() WHERE id = $1`,
      [primaryId],
    );
  });

  void publishOrderEvent(
    buildEvent('order:updated', locationId, primaryId, { mergedFrom: secondaryIds, employeeId }),
  );
  return fetchOrderWithRelations(primaryId, orgId);
}
