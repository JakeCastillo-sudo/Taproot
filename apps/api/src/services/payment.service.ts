import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { config } from '../config';
import type { Payment, Order, GiftCard, PaymentMethod, PaymentStatus } from '@taproot/shared';
import { createAuditLog } from '../auth/audit';
import { getStripeClient } from '../payments/stripe.config';
import * as LoyaltySvc from './loyalty.service';
import { deliverWebhook } from './webhook.service';
import { invalidateOrgCache } from '../lib/cache';
import { deductOrderIngredients, reverseOrderIngredients } from './ingredientInventory.service';
import * as Sentry from '@sentry/node';

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

// ─── Dead-letter recovery (WG-001) ────────────────────────────────────────────
// When a Stripe charge SUCCEEDS but the order/payment DB write fails, we record
// a durable payment_dead_letters row (+ alert) so the opportunistic reconciler
// can replay the write idempotently. Card payments only — the only dead-lettered
// path.

interface DeadLetterContext {
  orgId: string;
  orderId: string;
  employeeId: string;
  paymentMethod: PaymentMethod;
  amount: number;
  tipAmount: number;
  processorPaymentId: string;
  cardLast4: string | null;
  cardBrand: string | null;
  error: string;
}

interface DeadLetterRow {
  id: string;
  organization_id: string;
  order_id: string;
  employee_id: string | null;
  payment_method: PaymentMethod;
  amount: number;
  tip_amount: number;
  processor_payment_id: string;
  card_last4: string | null;
  card_brand: string | null;
}

// Caches only the positive result: re-checks while the table is absent so the
// reconciler starts working as soon as migration 029 runs (no restart needed).
let _deadLetterReady = false;
async function deadLetterTableReady(): Promise<boolean> {
  if (_deadLetterReady) return true;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.payment_dead_letters') IS NOT NULL AS ready`,
    );
    _deadLetterReady = Boolean(rows[0]?.ready);
  } catch {
    _deadLetterReady = false;
  }
  return _deadLetterReady;
}

async function logDeadLetter(ctx: DeadLetterContext): Promise<void> {
  // Alert immediately. No-op when SENTRY_DSN is unset (Sentry SDK stays inert).
  try {
    Sentry.captureMessage(
      `[payment] charge-without-order dead letter: order ${ctx.orderId} PI ${ctx.processorPaymentId}`,
      'error',
    );
  } catch { /* alerting must never throw */ }

  try {
    await query(
      `INSERT INTO payment_dead_letters
         (organization_id, order_id, employee_id, payment_method, amount,
          tip_amount, processor, processor_payment_id, card_last4, card_brand,
          error, status)
       VALUES ($1,$2,$3,$4,$5,$6,'stripe',$7,$8,$9,$10,'pending')
       ON CONFLICT (processor_payment_id) DO NOTHING`,
      [
        ctx.orgId, ctx.orderId, ctx.employeeId, ctx.paymentMethod, ctx.amount,
        ctx.tipAmount, ctx.processorPaymentId, ctx.cardLast4, ctx.cardBrand,
        ctx.error,
      ],
    );
  } catch {
    // Last resort if the durable table isn't available (e.g. pre-migration):
    // keep the audit_logs record so nothing is silently lost.
    try {
      await query(
        `INSERT INTO audit_logs (organization_id, actor_type, action, metadata)
         VALUES ($1, 'system', 'payment.dead_letter', $2)`,
        [ctx.orgId, JSON.stringify(ctx)],
      );
    } catch {
      console.error('[payment] Dead letter persist failed:', JSON.stringify(ctx));
    }
  }
}

// Replay a single dead-letter's DB write. Idempotent: locks the order, then
// re-checks for an existing payment by PaymentIntent id UNDER the lock so two
// concurrent passes can never double-insert. Never resurrects a voided/refunded
// order to 'completed'.
async function reconcileOne(dl: DeadLetterRow): Promise<void> {
  await withTransaction(async (client) => {
    const { rows: [order] } = await client.query<{ id: string; status: string; total: number }>(
      `SELECT id, status, total FROM orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [dl.order_id, dl.organization_id],
    );

    const { rows: [existing] } = await client.query<{ id: string }>(
      `SELECT id FROM payments WHERE processor_payment_id = $1`,
      [dl.processor_payment_id],
    );

    if (!existing) {
      if (!order) throw new Error(`order ${dl.order_id} not found`);

      // Re-insert the payment row the original transaction failed to write.
      await client.query(
        `INSERT INTO payments
           (order_id, payment_method, amount, tip_amount, status,
            processor, processor_payment_id, processor_response,
            card_last4, card_brand, refunded_amount)
         VALUES ($1,$2,$3,$4,'completed','stripe',$5,$6,$7,$8,0)`,
        [
          dl.order_id, dl.payment_method, dl.amount, dl.tip_amount,
          dl.processor_payment_id, { reconciledFrom: 'dead_letter' },
          dl.card_last4, dl.card_brand,
        ],
      );

      // Recalc totals (mirror processPayment) — but never resurrect a voided /
      // refunded order to 'completed'.
      const { rows: [totals] } = await client.query<{
        amount_paid: number; amount_only: number; tip_total: number; total: number;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount + tip_amount), 0) FROM payments
              WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS amount_paid,
           (SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS amount_only,
           (SELECT COALESCE(SUM(tip_amount), 0) FROM payments
              WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS tip_total,
           total
         FROM orders WHERE id = $1`,
        [dl.order_id],
      );
      const amountOnly = Number(totals.amount_only);
      const fullyPaid = amountOnly >= Number(totals.total);
      const changeDue = Math.max(0, amountOnly - Number(totals.total));

      await client.query(
        `UPDATE orders
           SET amount_paid = $1, tip_total = $2, change_due = $3,
               status = CASE WHEN $4 AND status NOT IN ('voided','refunded','partially_refunded')
                             THEN 'completed' ELSE status END,
               fulfilled_at = CASE WHEN $4 AND status NOT IN ('voided','refunded','partially_refunded')
                                   THEN now() ELSE fulfilled_at END,
               updated_at = now()
         WHERE id = $5`,
        [Number(totals.amount_paid), Number(totals.tip_total), changeDue, fullyPaid, dl.order_id],
      );
    }

    // Close out the dead letter (whether we inserted now or a prior pass did).
    await client.query(
      `UPDATE payment_dead_letters
          SET status = 'reconciled', reconciled_at = now(),
              reconcile_attempts = reconcile_attempts + 1, last_attempt_at = now()
        WHERE id = $1`,
      [dl.id],
    );
  });
}

// Opportunistic reconciler. Drains the oldest few unreconciled dead-letters by
// replaying the order DB write using the known Stripe PaymentIntent id. NEVER
// throws — failures bump the attempt counter and are left for a later pass.
export async function reconcilePending(limit = 5): Promise<void> {
  if (!(await deadLetterTableReady())) return;

  let pending: DeadLetterRow[];
  try {
    const { rows } = await query<DeadLetterRow>(
      `SELECT id, organization_id, order_id, employee_id, payment_method, amount,
              tip_amount, processor_payment_id, card_last4, card_brand
         FROM payment_dead_letters
        WHERE reconciled_at IS NULL
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit],
    );
    pending = rows;
  } catch (err) {
    console.error('[Reconcile] fetch failed:', err instanceof Error ? err.message : String(err));
    return;
  }

  for (const dl of pending) {
    try {
      await reconcileOne(dl);
    } catch (err) {
      try {
        await query(
          `UPDATE payment_dead_letters
              SET reconcile_attempts = reconcile_attempts + 1, last_attempt_at = now()
            WHERE id = $1`,
          [dl.id],
        );
      } catch { /* ignore */ }
      console.error('[Reconcile] order', dl.order_id, 'failed:',
        err instanceof Error ? err.message : String(err));
    }
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
  // WG-005: a refunded order must not accept a new payment.
  if (order.status === 'refunded' || order.status === 'partially_refunded') {
    throw new ValidationError('Cannot process payment for a refunded order');
  }

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
      }, {
        // WG-002: deterministic idempotency key — same order + charged amount +
        // payment method = same key, so Stripe dedupes a concurrent retry / double-tap.
        idempotencyKey: `order_${orderId}_${input.amount + tipAmount}_${input.stripePaymentMethodId ?? 'nopm'}`,
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
  let orderCompleted = false; // set inside the txn when this payment completes the order
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

      // Recalculate amount_paid / tip_total / change_due and maybe mark order completed.
      // Balance + change are based on `amount` only; tips are tracked separately so a
      // card tip never shows up as "change due".
      const { rows: [totals] } = await client.query<{
        amount_paid: number; amount_only: number; tip_total: number; total: number; customer_id: string | null;
      }>(
        `SELECT
           (SELECT COALESCE(SUM(amount + tip_amount), 0)
            FROM payments
            WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS amount_paid,
           (SELECT COALESCE(SUM(amount), 0)
            FROM payments
            WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS amount_only,
           (SELECT COALESCE(SUM(tip_amount), 0)
            FROM payments
            WHERE order_id = $1 AND status IN ('completed','offline_queued')) AS tip_total,
           total, customer_id
         FROM orders WHERE id = $1`,
        [orderId],
      );

      const newAmountPaid = Number(totals.amount_paid);
      const amountOnly = Number(totals.amount_only);
      const tipTotal = Number(totals.tip_total);
      const changeDue = Math.max(0, amountOnly - Number(totals.total));

      const fullyPaid = amountOnly >= Number(totals.total);
      const justCompleted = fullyPaid && totals.customer_id;
      orderCompleted = fullyPaid; // processPayment throws earlier if already completed

      await client.query(
        `UPDATE orders
         SET amount_paid = $1, tip_total = $2, change_due = $3,
             status     = CASE WHEN $4 THEN 'completed' ELSE status END,
             fulfilled_at = CASE WHEN $4 THEN now() ELSE fulfilled_at END,
             updated_at = now()
         WHERE id = $5`,
        [newAmountPaid, tipTotal, changeDue, fullyPaid, orderId],
      );

      // Accrue loyalty points when the order completes with a customer attached (non-fatal).
      if (justCompleted) {
        try {
          await LoyaltySvc.awardPoints(orgId, totals.customer_id as string, orderId, Number(totals.total) / 100, employeeId);
        } catch { /* loyalty accrual must never block payment */ }
      }

      // Outbound webhooks (S8-04) — fire-and-forget, never blocks payment
      void deliverWebhook(orgId, 'payment.completed', {
        orderId, paymentId: p.id, method: input.paymentMethod,
        amount: input.amount, tipAmount: input.tipAmount ?? 0,
      });
      if (fullyPaid) {
        void deliverWebhook(orgId, 'order.completed', {
          orderId, total: Number(totals.total), amountPaid: newAmountPaid, tipTotal,
        });
        // Fresh sales numbers on next report load (S8-06)
        void invalidateOrgCache(orgId, ['reports']);
      }

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
        paymentMethod: input.paymentMethod,
        amount: input.amount,
        tipAmount,
        processorPaymentId,
        cardLast4: card_last4,
        cardBrand: card_brand,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }

  // Ingredient inventory deduction (Session 1) — fire-and-forget, NEVER blocks payment.
  // Only acts on recipe_mode products; no-ops otherwise. Self-logs on failure.
  if (orderCompleted) {
    void deductOrderIngredients(orgId, orderId).catch((err) =>
      console.error('[Inventory] Deduction failed:', err instanceof Error ? err.message : String(err)));
  }

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'payment.processed', resourceType: 'payment', resourceId: payment.id,
    afterState: { orderId, amount: input.amount, method: input.paymentMethod, status },
  });

  // WG-001: opportunistic dead-letter recovery — bounded, fire-and-forget,
  // never blocks or affects this charge/response.
  void reconcilePending().catch((err) =>
    console.error('[Reconcile]', err instanceof Error ? err.message : String(err)));

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

  // Ingredient inventory reversal (Session 1) — when the order is fully refunded
  // (the path a void travels through). Fire-and-forget, idempotent, NEVER throws.
  if (newStatus === 'refunded') {
    void reverseOrderIngredients(orgId, payment.order_id).catch((err) =>
      console.error('[Inventory] Reversal failed:', err instanceof Error ? err.message : String(err)));
  }

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
    }, {
      // WG-002: deterministic idempotency key — re-syncing the same offline payment
      // with the same payment method dedupes at Stripe instead of double-charging.
      idempotencyKey: `offline_${paymentId}_${Number(payment.amount) + Number(payment.tip_amount)}_${stripePaymentMethodId}`,
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
