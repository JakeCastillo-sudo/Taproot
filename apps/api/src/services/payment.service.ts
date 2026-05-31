import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { config } from '../config';
import type { Payment, Order, GiftCard, PaymentMethod, PaymentStatus } from '@taproot/shared';
import { createAuditLog } from '../auth/audit';
import { getStripeClient } from '../payments/stripe.config';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface ProcessPaymentInput {
  paymentMethod: PaymentMethod;
  amount: number;       // in cents
  tipAmount?: number;
  /** Stripe PaymentMethod ID (required for card payments) */
  stripePaymentMethodId?: string;
  /** Gift card code (required for gift_card payments) */
  giftCardCode?: string;
  /** If true, queue the payment for offline sync instead of processing live */
  offlineMode?: boolean;
  notes?: string;
}

export interface RefundPaymentInput {
  paymentId: string;
  amount: number;  // partial refund supported
  reason?: string;
}

// ─── Dead-letter queue helper ─────────────────────────────────────────────────
// Used when Stripe charge succeeds but the DB write fails.

async function logDeadLetter(context: Record<string, unknown>): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs
         (organization_id, actor_type, action, metadata)
       VALUES ($1, 'system', 'payment.dead_letter', $2)`,
      [context.orgId ?? null, JSON.stringify(context)],
    );
  } catch {
    // Last-resort: log to stderr
    console.error('[payment] Dead letter log failed:', JSON.stringify(context));
  }
}

// ─── processPayment ───────────────────────────────────────────────────────────

export async function processPayment(
  orgId: string,
  orderId: string,
  employeeId: string,
  input: ProcessPaymentInput,
): Promise<Payment> {
  if (input.amount <= 0) throw new ValidationError('Payment amount must be greater than 0');

  // Load order
  const { rows: [order] } = await query<Order>(
    `SELECT * FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'voided') throw new ValidationError('Cannot process payment for a voided order');
  if (order.status === 'completed') throw new ValidationError('Order is already completed');

  const tipAmount = input.tipAmount ?? 0;
  let processorPaymentId: string | null = null;
  let processorResponse: Record<string, unknown> | null = null;
  let card_last4: string | null = null;
  let card_brand: string | null = null;
  let status: PaymentStatus = 'completed';

  // ── Cash / check / account_credit — no external processor ────────────────
  if (
    input.paymentMethod === 'cash' ||
    input.paymentMethod === 'check' ||
    input.paymentMethod === 'account_credit' ||
    input.paymentMethod === 'other'
  ) {
    if (input.paymentMethod === 'account_credit') {
      // Validate sufficient account credit
      const { rows: [cust] } = await query<{ account_credit: number; customer_id: string }>(
        `SELECT c.account_credit, c.id AS customer_id
         FROM customers c
         JOIN orders o ON o.customer_id = c.id
         WHERE o.id = $1 AND c.organization_id = $2`,
        [orderId, orgId],
      );
      if (!cust) throw new ValidationError('No customer attached to use account credit');
      if (cust.account_credit < input.amount) {
        throw new ValidationError(
          `Insufficient account credit: ${cust.account_credit} available, ${input.amount} requested`,
        );
      }
    }
    // Handled fully inside DB transaction below
  }

  // ── Gift card ─────────────────────────────────────────────────────────────
  else if (input.paymentMethod === 'gift_card') {
    if (!input.giftCardCode) throw new ValidationError('Gift card code is required');
    const { rows: [gc] } = await query<GiftCard>(
      `SELECT * FROM gift_cards
       WHERE code = $1 AND organization_id = $2
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > now())`,
      [input.giftCardCode, orgId],
    );
    if (!gc) throw new ValidationError('Gift card not found, expired, or inactive');
    if (gc.current_balance < input.amount) {
      throw new ValidationError(
        `Insufficient gift card balance: ${gc.current_balance} available, ${input.amount} requested`,
      );
    }
    processorPaymentId = gc.id;
    processorResponse = { gift_card_id: gc.id, code: gc.code };
  }

  // ── Offline queue ─────────────────────────────────────────────────────────
  else if (input.offlineMode) {
    status = 'offline_queued';
  }

  // ── Stripe (card / Apple Pay / Google Pay / BNPL) ─────────────────────────
  else if (
    input.paymentMethod === 'credit_card' ||
    input.paymentMethod === 'debit_card' ||
    input.paymentMethod === 'apple_pay' ||
    input.paymentMethod === 'google_pay' ||
    input.paymentMethod === 'bnpl'
  ) {
    if (!input.stripePaymentMethodId) {
      throw new ValidationError('stripePaymentMethodId is required for card payments');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stripeCharge: any;
    try {
      stripeCharge = await getStripeClient().paymentIntents.create({
        amount: input.amount + tipAmount,
        currency: 'usd',
        payment_method: input.stripePaymentMethodId,
        confirm: true,
        metadata: { orderId, orgId, employeeId },
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(`Card payment failed: ${msg}`);
    }

    if (stripeCharge.status !== 'succeeded') {
      throw new ValidationError(`Payment not completed. Status: ${stripeCharge.status}`);
    }

    processorPaymentId = stripeCharge.id;
    processorResponse = {
      status: stripeCharge.status,
      client_secret: stripeCharge.client_secret,
    };

    // Extract card details
    if (stripeCharge.payment_method) {
      try {
        const pm = await getStripeClient().paymentMethods.retrieve(
          stripeCharge.payment_method as string,
        );
        card_last4 = pm.card?.last4 ?? null;
        card_brand = pm.card?.brand ?? null;
      } catch {
        // Non-fatal
      }
    }
  }

  // ── Write to DB ───────────────────────────────────────────────────────────
  let payment: Payment;
  try {
    payment = await withTransaction(async (client) => {
      const { rows: [p] } = await client.query<Payment>(
        `INSERT INTO payments
           (order_id, payment_method, amount, tip_amount, status,
            processor, processor_payment_id, processor_response,
            card_last4, card_brand, refunded_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
         RETURNING *`,
        [
          orderId, input.paymentMethod, input.amount, tipAmount, status,
          processorPaymentId ? 'stripe' : null,
          processorPaymentId, processorResponse,
          card_last4, card_brand,
        ],
      );

      // Gift card: deduct balance + record transaction
      if (input.paymentMethod === 'gift_card' && input.giftCardCode) {
        await client.query(
          `UPDATE gift_cards SET current_balance = current_balance - $1, updated_at = now()
           WHERE code = $2 AND organization_id = $3`,
          [input.amount, input.giftCardCode, orgId],
        );
        await client.query(
          `INSERT INTO gift_card_transactions
             (gift_card_id, transaction_type, amount, order_id, employee_id)
           SELECT id, 'redemption', $1, $2, $3
           FROM gift_cards WHERE code = $4 AND organization_id = $5`,
          [input.amount, orderId, employeeId, input.giftCardCode, orgId],
        );
      }

      // Account credit: deduct from customer
      if (input.paymentMethod === 'account_credit') {
        await client.query(
          `UPDATE customers
           SET account_credit = account_credit - $1, updated_at = now()
           WHERE id = (SELECT customer_id FROM orders WHERE id = $2)`,
          [input.amount, orderId],
        );
      }

      // Offline queue: push to Redis queue
      if (status === 'offline_queued') {
        try {
          const { getPublisher, CHANNELS } = await import('../db/redis');
          await getPublisher().rpush(
            CHANNELS.offlineQueue,
            JSON.stringify({ paymentId: p.id, orderId, orgId, employeeId, createdAt: p.created_at }),
          );
          await client.query(
            `UPDATE payments SET offline_queued_at = now() WHERE id = $1`,
            [p.id],
          );
        } catch {
          // Non-fatal: will be picked up on next sync
        }
      }

      // Recalculate amount_paid / change_due and maybe mark order completed
      const { rows: [totals] } = await client.query<{
        amount_paid: number; total: number;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount + tip_amount), 0)
            FROM payments
            WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS amount_paid,
           total
         FROM orders WHERE id = $1`,
        [orderId],
      );

      const newAmountPaid = Number(totals.amount_paid);
      const changeDue = Math.max(0, newAmountPaid - Number(totals.total));

      const fullyPaid = newAmountPaid >= Number(totals.total);
      await client.query(
        `UPDATE orders
         SET amount_paid = $1, change_due = $2,
             status     = CASE WHEN $3 THEN 'completed' ELSE status END,
             fulfilled_at = CASE WHEN $3 THEN now() ELSE fulfilled_at END,
             updated_at = now()
         WHERE id = $4`,
        [newAmountPaid, changeDue, fullyPaid, orderId],
      );

      return p;
    });
  } catch (err) {
    // If DB fails after Stripe charge succeeded, log dead letter
    if (processorPaymentId && (
      input.paymentMethod === 'credit_card' ||
      input.paymentMethod === 'debit_card' ||
      input.paymentMethod === 'apple_pay' ||
      input.paymentMethod === 'google_pay' ||
      input.paymentMethod === 'bnpl'
    )) {
      await logDeadLetter({
        orgId, orderId, employeeId,
        stripePaymentIntentId: processorPaymentId,
        amount: input.amount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'payment.processed', resourceType: 'payment', resourceId: payment.id,
    afterState: { orderId, amount: input.amount, method: input.paymentMethod, status },
  });

  return payment;
}

// ─── refundPayment ────────────────────────────────────────────────────────────

export async function refundPayment(
  orgId: string,
  employeeId: string,
  input: RefundPaymentInput,
): Promise<Payment> {
  const { rows: [payment] } = await query<Payment & { order_organization_id: string }>(
    `SELECT p.*, o.organization_id AS order_organization_id
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1 AND o.organization_id = $2`,
    [input.paymentId, orgId],
  );
  if (!payment) throw new NotFoundError('Payment');
  if (payment.status === 'refunded') throw new ValidationError('Payment is already fully refunded');

  const maxRefundable = Number(payment.amount) - Number(payment.refunded_amount);
  if (input.amount > maxRefundable) {
    throw new ValidationError(
      `Refund amount ${input.amount} exceeds refundable amount ${maxRefundable}`,
    );
  }

  // Stripe refund
  if (payment.processor === 'stripe' && payment.processor_payment_id) {
    try {
      await getStripeClient().refunds.create({
        payment_intent: payment.processor_payment_id,
        amount: input.amount,
        reason: 'requested_by_customer',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(`Stripe refund failed: ${msg}`);
    }
  }

  // Gift card refund: restore balance
  if (payment.payment_method === 'gift_card' && payment.processor_payment_id) {
    await query(
      `UPDATE gift_cards SET current_balance = current_balance + $1, updated_at = now()
       WHERE id = $2`,
      [input.amount, payment.processor_payment_id],
    );
  }

  const newRefunded = Number(payment.refunded_amount) + input.amount;
  const newStatus: PaymentStatus = newRefunded >= Number(payment.amount) ? 'refunded' : 'partially_refunded';

  const { rows: [updated] } = await query<Payment>(
    `UPDATE payments
     SET refunded_amount = $1, status = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [newRefunded, newStatus, payment.id],
  );

  // Update order status
  await query(
    `UPDATE orders
     SET status = CASE
           WHEN $1 = 'refunded' THEN 'refunded'
           WHEN $1 = 'partially_refunded' THEN 'partially_refunded'
           ELSE status
         END,
         amount_paid = amount_paid - $2,
         updated_at  = now()
     WHERE id = $3`,
    [newStatus, input.amount, payment.order_id],
  );

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'payment.refunded', resourceType: 'payment', resourceId: payment.id,
    afterState: { orderId: payment.order_id, refundAmount: input.amount, reason: input.reason },
  });

  return updated;
}

// ─── getPayment ───────────────────────────────────────────────────────────────

export async function getPayment(orgId: string, paymentId: string): Promise<Payment> {
  const { rows: [payment] } = await query<Payment>(
    `SELECT p.* FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1 AND o.organization_id = $2`,
    [paymentId, orgId],
  );
  if (!payment) throw new NotFoundError('Payment');
  return payment;
}

// ─── listPaymentsForOrder ─────────────────────────────────────────────────────

export async function listPaymentsForOrder(
  orgId: string,
  orderId: string,
): Promise<Payment[]> {
  const { rows } = await query<Payment>(
    `SELECT p.* FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.order_id = $1 AND o.organization_id = $2
     ORDER BY p.created_at`,
    [orderId, orgId],
  );
  return rows;
}

// ─── syncOfflinePayment ───────────────────────────────────────────────────────
// Called by the offline sync worker to promote an offline_queued payment.

export async function syncOfflinePayment(
  paymentId: string,
  stripePaymentMethodId: string,
): Promise<Payment> {
  const { rows: [payment] } = await query<Payment & { organization_id: string }>(
    `SELECT p.*, o.organization_id
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.id = $1 AND p.status = 'offline_queued'`,
    [paymentId],
  );
  if (!payment) throw new NotFoundError('Offline-queued payment');

  // Charge via Stripe
  let piId: string;
  try {
    const pi = await getStripeClient().paymentIntents.create({
      amount: Number(payment.amount) + Number(payment.tip_amount),
      currency: 'usd',
      payment_method: stripePaymentMethodId,
      confirm: true,
      metadata: { paymentId, offlineSync: 'true' },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });
    if (pi.status !== 'succeeded') throw new Error(`Unexpected status: ${pi.status}`);
    piId = pi.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Offline sync charge failed: ${msg}`);
  }

  const { rows: [updated] } = await query<Payment>(
    `UPDATE payments
     SET status = 'completed',
         processor = 'stripe',
         processor_payment_id = $1,
         offline_synced_at    = now(),
         updated_at           = now()
     WHERE id = $2 RETURNING *`,
    [piId, paymentId],
  );

  return updated;
}
