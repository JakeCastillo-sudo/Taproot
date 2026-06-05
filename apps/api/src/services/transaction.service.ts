/**
 * transaction.service — order-level void & refund orchestration.
 *
 * Sits above order.service + payment.service: voiding/refunding a *completed*
 * order means reversing its payments (Stripe refunds for card, balance restore for
 * gift cards) and then setting the right order status. Amounts are in cents.
 */

import { query } from '../db/client';
import * as PaymentSvc from './payment.service';
import { NotFoundError, ValidationError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { Payment } from '@taproot/shared';

interface OrderRow {
  id: string; location_id: string; status: string;
  total: number; amount_paid: number;
}

async function loadOrder(orgId: string, orderId: string): Promise<OrderRow> {
  const { rows: [order] } = await query<OrderRow>(
    `SELECT id, location_id, status, total, amount_paid
       FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');
  return order;
}

async function refundablePayments(orderId: string): Promise<Payment[]> {
  const { rows } = await query<Payment>(
    `SELECT * FROM payments
      WHERE order_id = $1 AND status IN ('completed','partially_refunded')
      ORDER BY created_at ASC`,
    [orderId],
  );
  return rows.filter((p) => Number(p.amount) - Number(p.refunded_amount) > 0);
}

/** Distribute a refund amount (cents) across an order's payments, greedily. */
async function distributeRefund(
  orgId: string, employeeId: string, orderId: string, amount: number, reason?: string,
): Promise<number> {
  let remaining = amount;
  let refunded = 0;
  for (const p of await refundablePayments(orderId)) {
    if (remaining <= 0) break;
    const refundable = Number(p.amount) - Number(p.refunded_amount);
    const take = Math.min(refundable, remaining);
    if (take <= 0) continue;
    await PaymentSvc.refundPayment(orgId, employeeId, { paymentId: p.id, amount: take, reason });
    remaining -= take;
    refunded += take;
  }
  return refunded;
}

// ─── listOrderLineItems ─────────────────────────────────────────────────────
// Minimal line items (with ids) for the by-item refund picker.

export interface RefundableLineItem {
  id:       string;
  name:     string;
  quantity: number;
  total:    number;
  voided:   boolean;
}

export async function listOrderLineItems(orgId: string, orderId: string): Promise<RefundableLineItem[]> {
  await loadOrder(orgId, orderId); // validates org ownership
  const { rows } = await query<RefundableLineItem>(
    `SELECT oli.id, oli.name, oli.quantity, oli.total, (oli.voided_at IS NOT NULL) AS voided
       FROM order_line_items oli
      WHERE oli.order_id = $1
      ORDER BY oli.created_at ASC`,
    [orderId],
  );
  return rows;
}

// ─── voidOrder ────────────────────────────────────────────────────────────────

export async function voidOrder(
  orgId: string, employeeId: string, orderId: string, reason: string,
): Promise<{ success: boolean; refundedAmount: number }> {
  const order = await loadOrder(orgId, orderId);
  if (order.status === 'voided') throw new ValidationError('Order is already voided');
  if (order.status === 'refunded') throw new ValidationError('Order is already refunded');
  if (!reason?.trim()) throw new ValidationError('A void reason is required');

  // Reverse any captured payments (Stripe refund / gift-card restore handled per payment).
  const refundedAmount = await distributeRefund(orgId, employeeId, orderId, Number(order.amount_paid), reason);

  // Void line items + force order status to 'voided' (overriding any 'refunded' set by refunds).
  await query(
    `UPDATE order_line_items SET voided_at = now(), void_reason = $1, updated_at = now()
      WHERE order_id = $2 AND voided_at IS NULL`,
    [reason, orderId],
  );
  await query(
    `UPDATE orders SET status = 'voided', voided_at = now(), void_reason = $1, updated_at = now()
      WHERE id = $2 AND organization_id = $3`,
    [reason, orderId, orgId],
  );

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'order.voided', resourceType: 'order', resourceId: orderId,
    afterState: { reason, refundedAmount },
  });

  return { success: true, refundedAmount };
}

// ─── refundOrder ──────────────────────────────────────────────────────────────

export interface RefundOrderInput {
  type:        'full' | 'partial';
  amount?:     number;        // cents (partial)
  lineItemIds?: string[];     // item-level refund → refunds the sum of these items
  reason:      string;
}

export async function refundOrder(
  orgId: string, employeeId: string, orderId: string, input: RefundOrderInput,
): Promise<{ success: boolean; refundedAmount: number }> {
  const order = await loadOrder(orgId, orderId);
  if (order.status === 'voided') throw new ValidationError('Cannot refund a voided order');
  if (!input.reason?.trim()) throw new ValidationError('A refund reason is required');

  let amount: number;
  if (input.lineItemIds && input.lineItemIds.length > 0) {
    const { rows } = await query<{ sum: string | null }>(
      `SELECT SUM(total)::numeric AS sum FROM order_line_items
        WHERE order_id = $1 AND voided_at IS NULL AND id = ANY($2::uuid[])`,
      [orderId, input.lineItemIds],
    );
    amount = Math.round(Number(rows[0]?.sum ?? 0));
  } else if (input.type === 'full') {
    amount = Number(order.amount_paid);
  } else {
    amount = Math.round(input.amount ?? 0);
  }

  if (amount <= 0) throw new ValidationError('Refund amount must be greater than 0');

  const refundedAmount = await distributeRefund(orgId, employeeId, orderId, amount, input.reason);
  if (refundedAmount <= 0) throw new ValidationError('No captured payments available to refund');

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'order.refunded', resourceType: 'order', resourceId: orderId,
    afterState: { type: input.type, refundedAmount, reason: input.reason },
  });

  return { success: true, refundedAmount };
}
