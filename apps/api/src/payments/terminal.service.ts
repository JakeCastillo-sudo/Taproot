/**
 * Stripe Terminal — card-present payment collection via ISV integration.
 *
 * Architecture
 * ────────────
 * Taproot uses "server-driven" Terminal (no client SDK required on the POS
 * device for the payment flow). The sequence for a card-present payment:
 *
 *   1. createConnectionToken(orgId)             — POS device initialises Terminal SDK
 *   2. createPaymentIntent(orgId, orderId, amt) — platform creates PI on merchant account
 *   3. collectPayment(orgId, readerId, piId)    — server tells reader to collect card
 *   4. webhook: payment_intent.succeeded        — platform records completed payment
 *      OR
 *   4b. capturePaymentIntent(orgId, piId)       — manual capture (restaurant pre-auth)
 *
 * All Terminal API calls run through the merchant's scoped Stripe client
 * (getMerchantStripeClient) so charges land on the merchant's account.
 * Taproot earns TAPROOT_APPLICATION_FEE_RATE × amount as an application fee.
 *
 * DB schema (migration 005)
 * ─────────────────────────
 * organizations: stripe_connect_account_id, stripe_connect_status,
 *                payment_processing_enabled
 * terminal_readers: id, organization_id, location_id, stripe_reader_id,
 *                   label, model, status, last_seen_at, metadata jsonb,
 *                   created_at, updated_at
 *
 * Stripe Location linkage
 * ───────────────────────
 * A Stripe Terminal Location must exist before registering a reader.
 * ensureStripeLocation() creates one lazily from the Taproot Location's address
 * and caches stripe_location_id on the locations row.
 *
 * Failure policy
 * ──────────────
 * - No silent failures: every Stripe error surfaces as a ValidationError.
 * - Payment records are created with status='pending' at PI creation time;
 *   webhook promotion to 'completed' ensures we always have a DB record.
 * - cancelPaymentIntent is safe to call idempotently.
 * - handleTerminalWebhook is idempotent — safe to replay.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { getMerchantStripeClient, TAPROOT_APPLICATION_FEE_RATE, getStripeClient } from './stripe.config';
import { createAuditLog } from '../auth/audit';
import { config } from '../config';
import type { TerminalReader, TerminalPaymentIntent } from '@taproot/shared';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RegisterReaderInput {
  registrationCode: string;
  label:            string;
  readerModel:      'bbpos_wisepos_e' | 'stripe_m2' | 'stripe_s700';
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Fetch the organisation's Stripe Connect account ID, throwing if not active. */
async function requireMerchantAccount(orgId: string): Promise<string> {
  const { rows: [org] } = await query<{
    stripe_connect_account_id: string | null;
    payment_processing_enabled: boolean;
    stripe_connect_status: string;
  }>(
    `SELECT stripe_connect_account_id, payment_processing_enabled, stripe_connect_status
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  if (!org) throw new NotFoundError('Organization');
  if (!org.stripe_connect_account_id) {
    throw new ValidationError(
      'Organization has not connected a Stripe account. ' +
      'Complete Connect onboarding before accepting card payments.',
    );
  }
  if (!org.payment_processing_enabled) {
    throw new ValidationError(
      `Stripe account is not ready for charges (status: ${org.stripe_connect_status}). ` +
      'Complete onboarding or resolve outstanding requirements.',
    );
  }
  return org.stripe_connect_account_id;
}

/**
 * Lazily create (or retrieve) the Stripe Terminal Location that corresponds
 * to a Taproot Location. Caches the result on locations.stripe_location_id.
 */
async function ensureStripeLocation(
  locationId: string,
  merchantStripe: ReturnType<typeof getMerchantStripeClient>,
): Promise<string> {
  const { rows: [loc] } = await query<{
    id: string;
    name: string;
    stripe_location_id: string | null;
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    } | null;
  }>(
    `SELECT id, name, stripe_location_id, address FROM locations WHERE id = $1`,
    [locationId],
  );
  if (!loc) throw new NotFoundError('Location');

  // Already created — return cached ID
  if (loc.stripe_location_id) return loc.stripe_location_id;

  const addr = loc.address ?? { line1: '', city: '', state: '', zip: '', country: 'US' };

  let stripeLocation: any;
  try {
    stripeLocation = await merchantStripe.terminal.locations.create({
      display_name: loc.name,
      address: {
        line1:       addr.line1,
        line2:       addr.line2,
        city:        addr.city,
        state:       addr.state,
        postal_code: addr.zip,
        country:     addr.country || 'US',
      },
      metadata: { taprootLocationId: locationId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to create Stripe Terminal Location: ${msg}`);
  }

  // Cache for future registrations
  await query(
    `UPDATE locations SET stripe_location_id = $1, updated_at = now() WHERE id = $2`,
    [stripeLocation.id, locationId],
  );

  return stripeLocation.id;
}

// ─── registerReader ───────────────────────────────────────────────────────────

/**
 * Register a physical Stripe Terminal reader and store it locally.
 * The registrationCode is printed on the reader during pairing mode.
 * Extended reader details (serial number, IP, SW version) are stored in
 * the metadata jsonb column.
 */
export async function registerReader(
  orgId:      string,
  locationId: string,
  employeeId: string,
  input:      RegisterReaderInput,
): Promise<TerminalReader> {
  const merchantAccountId = await requireMerchantAccount(orgId);
  const merchantStripe    = getMerchantStripeClient(merchantAccountId);

  const stripeLocationId = await ensureStripeLocation(locationId, merchantStripe);

  let stripeReader: any;
  try {
    stripeReader = await merchantStripe.terminal.readers.create({
      registration_code: input.registrationCode,
      label:             input.label,
      location:          stripeLocationId,
      metadata:          { taprootOrgId: orgId, taprootLocationId: locationId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to register Terminal reader: ${msg}`);
  }

  const metadata = {
    stripeAccountId:  merchantAccountId,
    stripeLocationId,
    serialNumber:     stripeReader.serial_number     ?? null,
    deviceSwVersion:  stripeReader.device_sw_version ?? null,
    ipAddress:        stripeReader.ip_address        ?? null,
  };

  const { rows: [reader] } = await query<TerminalReader>(
    `INSERT INTO terminal_readers
       (organization_id, location_id, stripe_reader_id, label, model, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      orgId,
      locationId,
      stripeReader.id,
      input.label,
      input.readerModel,
      stripeReader.status === 'online' ? 'online' : 'offline',
      JSON.stringify(metadata),
    ],
  );

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'terminal.reader.registered',
    resourceType:   'terminal_reader',
    resourceId:     reader.id,
    afterState:     { stripeReaderId: stripeReader.id, label: input.label, model: input.readerModel },
  });

  return reader;
}

// ─── listReaders ──────────────────────────────────────────────────────────────

/** List all Terminal readers for an org, optionally filtered by location. */
export async function listReaders(
  orgId:       string,
  locationId?: string,
): Promise<TerminalReader[]> {
  const params: unknown[] = [orgId];
  let locationClause = '';
  if (locationId) {
    params.push(locationId);
    locationClause = `AND location_id = $${params.length}`;
  }

  const { rows } = await query<TerminalReader>(
    `SELECT * FROM terminal_readers
     WHERE organization_id = $1 ${locationClause}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

// ─── createPaymentIntent ──────────────────────────────────────────────────────

/**
 * Create a card_present PaymentIntent on the merchant's Stripe account.
 * The application_fee_amount is Taproot's ISV revenue share.
 *
 * A pending Payment record is written to the DB immediately so in-flight
 * payments are visible; the webhook promotes it to 'completed' on success.
 *
 * @param currency ISO-4217 lowercase (default 'usd')
 */
export async function createPaymentIntent(
  orgId:    string,
  orderId:  string,
  amount:   number,
  currency = 'usd',
): Promise<TerminalPaymentIntent> {
  if (amount <= 0) throw new ValidationError('Payment amount must be greater than 0');

  const merchantAccountId = await requireMerchantAccount(orgId);

  // Validate order belongs to org and is payable
  const { rows: [order] } = await query<{ id: string; status: string; total: number }>(
    `SELECT id, status, total FROM orders WHERE id = $1 AND organization_id = $2`,
    [orderId, orgId],
  );
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'voided')    throw new ValidationError('Cannot charge a voided order');
  if (order.status === 'completed') throw new ValidationError('Order is already completed');

  const applicationFeeAmount = Math.floor(amount * TAPROOT_APPLICATION_FEE_RATE);
  const merchantStripe       = getMerchantStripeClient(merchantAccountId);

  let pi: any;
  try {
    pi = await merchantStripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['card_present'],
      capture_method:       'automatic',
      application_fee_amount: applicationFeeAmount,
      metadata: {
        taprootOrderId: orderId,
        taprootOrgId:   orgId,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to create Terminal PaymentIntent: ${msg}`);
  }

  // Create a pending payment record — webhook will promote to 'completed'
  await query(
    `INSERT INTO payments
       (order_id, payment_method, amount, tip_amount, status,
        processor, processor_payment_id, processor_response, refunded_amount)
     VALUES ($1, 'credit_card', $2, 0, 'pending', 'stripe_terminal', $3, $4, 0)
     ON CONFLICT DO NOTHING`,
    [
      orderId,
      amount,
      pi.id,
      JSON.stringify({
        paymentIntentId:     pi.id,
        applicationFeeAmount,
        currency,
        taprootOrgId:        orgId,
      }),
    ],
  );

  return {
    paymentIntentId:     pi.id,
    clientSecret:        pi.client_secret as string,
    amount,
    currency,
    status:              pi.status,
    applicationFeeAmount,
  };
}

// ─── collectPayment ───────────────────────────────────────────────────────────

/**
 * Instruct a Terminal reader to collect the card for an existing PaymentIntent.
 * This is the "server-driven" collection call — no client SDK needed on the POS.
 *
 * Returns when the reader has accepted the intent (status = 'in_progress').
 * The payment completes asynchronously; listen for payment_intent.succeeded webhook.
 */
export async function collectPayment(
  orgId:           string,
  readerId:        string,
  paymentIntentId: string,
): Promise<{ readerId: string; readerStatus: string; actionStatus: string }> {
  const merchantAccountId = await requireMerchantAccount(orgId);

  // Verify the reader belongs to this org
  const { rows: [reader] } = await query<{ stripe_reader_id: string; status: string }>(
    `SELECT stripe_reader_id, status FROM terminal_readers
     WHERE id = $1 AND organization_id = $2`,
    [readerId, orgId],
  );
  if (!reader) throw new NotFoundError('Terminal reader');
  if (reader.status !== 'online') {
    throw new ValidationError(
      `Reader is ${reader.status} and cannot accept payments. Check the device.`,
    );
  }

  const merchantStripe = getMerchantStripeClient(merchantAccountId);
  let updatedReader: any;
  try {
    updatedReader = await merchantStripe.terminal.readers.processPaymentIntent(
      reader.stripe_reader_id,
      { payment_intent: paymentIntentId },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to send payment to reader: ${msg}`);
  }

  const actionStatus = updatedReader.action?.status ?? 'unknown';

  if (actionStatus === 'failed') {
    const failureMsg = updatedReader.action?.failure_message ?? 'Unknown reader failure';
    throw new ValidationError(`Reader rejected the payment intent: ${failureMsg}`);
  }

  return {
    readerId,
    readerStatus: updatedReader.status,
    actionStatus,
  };
}

// ─── capturePaymentIntent ─────────────────────────────────────────────────────

/**
 * Capture a PaymentIntent that was authorised but not yet captured.
 * Used in manual-capture flows (e.g., restaurant pre-authorisation).
 *
 * amountToCapture defaults to the full authorised amount. Pass a smaller value
 * for partial captures (e.g., after removing items from an order).
 */
export async function capturePaymentIntent(
  orgId:           string,
  paymentIntentId: string,
  amountToCapture?: number,
): Promise<{ paymentIntentId: string; status: string; amountCaptured: number }> {
  const merchantAccountId = await requireMerchantAccount(orgId);
  const merchantStripe    = getMerchantStripeClient(merchantAccountId);

  let pi: any;
  try {
    pi = await merchantStripe.paymentIntents.capture(
      paymentIntentId,
      amountToCapture !== undefined ? { amount_to_capture: amountToCapture } : {},
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to capture PaymentIntent: ${msg}`);
  }

  if (pi.status !== 'succeeded') {
    throw new ValidationError(
      `Capture did not succeed. PaymentIntent status: ${pi.status}`,
    );
  }

  // Update the pending payment record to completed
  await query(
    `UPDATE payments
     SET status = 'completed', updated_at = now()
     WHERE processor_payment_id = $1 AND status = 'pending'`,
    [paymentIntentId],
  );

  return {
    paymentIntentId,
    status:         pi.status,
    amountCaptured: pi.amount_received ?? pi.amount,
  };
}

// ─── cancelPaymentIntent ──────────────────────────────────────────────────────

/**
 * Cancel a PaymentIntent that has not yet been captured.
 * Safe to call if the PI is already canceled (idempotent).
 * Also cancels any in-progress reader action.
 */
export async function cancelPaymentIntent(
  orgId:           string,
  paymentIntentId: string,
): Promise<void> {
  const merchantAccountId = await requireMerchantAccount(orgId);
  const merchantStripe    = getMerchantStripeClient(merchantAccountId);

  try {
    const pi: any = await merchantStripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'canceled') return; // already canceled — idempotent

    await merchantStripe.paymentIntents.cancel(paymentIntentId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to cancel PaymentIntent: ${msg}`);
  }

  // Remove the pending payment record (it was never completed)
  await query(
    `DELETE FROM payments
     WHERE processor_payment_id = $1 AND status = 'pending'`,
    [paymentIntentId],
  );
}

// ─── createConnectionToken ────────────────────────────────────────────────────

/**
 * Create a Stripe Terminal SDK connection token for the given org.
 * The token is short-lived and used by the POS device's Terminal SDK to
 * authenticate with Stripe's Terminal backend.
 *
 * The token is single-use — request a new one each time the SDK initialises.
 */
export async function createConnectionToken(orgId: string): Promise<string> {
  const merchantAccountId = await requireMerchantAccount(orgId);
  const merchantStripe    = getMerchantStripeClient(merchantAccountId);

  let token: any;
  try {
    token = await merchantStripe.terminal.connectionTokens.create({});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to create Terminal connection token: ${msg}`);
  }

  return token.secret;
}

// ─── handleTerminalWebhook ────────────────────────────────────────────────────

/**
 * Verify and process a Stripe Terminal webhook event.
 *
 * Handled events:
 *   payment_intent.succeeded         — promote pending payment to completed
 *   payment_intent.payment_failed    — mark payment as failed, update order
 *   terminal.reader.action_succeeded — sync reader status to DB
 *   terminal.reader.action_failed    — log failure, sync reader status
 */
export async function handleTerminalWebhook(
  payload:   string | Buffer,
  signature: string,
): Promise<void> {
  if (!config.STRIPE_TERMINAL_WEBHOOK_SECRET) {
    throw new ValidationError('STRIPE_TERMINAL_WEBHOOK_SECRET is not configured');
  }

  const stripe = getStripeClient();
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.STRIPE_TERMINAL_WEBHOOK_SECRET,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Terminal webhook signature verification failed: ${msg}`);
  }

  switch (event.type) {
    // ── payment_intent.succeeded — card was charged ────────────────────────
    case 'payment_intent.succeeded': {
      const pi = event.data.object;

      await withTransaction(async (client) => {
        // Promote pending → completed
        const { rows: [payment] } = await client.query<{ id: string; order_id: string }>(
          `UPDATE payments
           SET status     = 'completed',
               updated_at = now()
           WHERE processor_payment_id = $1
             AND status = 'pending'
           RETURNING id, order_id`,
          [pi.id],
        );
        if (!payment) return; // Already processed or not a terminal payment

        // Recalculate amount_paid and maybe complete the order
        const { rows: [totals] } = await client.query<{
          amount_paid: number;
          total:       number;
        }>(
          `SELECT
             COALESCE(SUM(amount + tip_amount), 0) FILTER (
               WHERE status IN ('completed','offline_queued')
             ) AS amount_paid,
             o.total
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           WHERE p.order_id = $1
           GROUP BY o.total`,
          [payment.order_id],
        );
        if (!totals) return;

        const newAmountPaid = Number(totals.amount_paid);
        const changeDue     = Math.max(0, newAmountPaid - Number(totals.total));
        const fullyPaid     = newAmountPaid >= Number(totals.total);

        await client.query(
          `UPDATE orders
           SET amount_paid  = $1,
               change_due   = $2,
               status       = CASE WHEN $3 THEN 'completed' ELSE status END,
               fulfilled_at = CASE WHEN $3 THEN now() ELSE fulfilled_at END,
               updated_at   = now()
           WHERE id = $4`,
          [newAmountPaid, changeDue, fullyPaid, payment.order_id],
        );
      });
      break;
    }

    // ── payment_intent.payment_failed — card was declined / error ──────────
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      const failMsg = pi.last_payment_error?.message ?? 'Payment failed';

      await query(
        `UPDATE payments
         SET status             = 'failed',
             processor_response = processor_response || $1::jsonb,
             updated_at         = now()
         WHERE processor_payment_id = $2
           AND status = 'pending'`,
        [JSON.stringify({ failure_message: failMsg, failed_at: new Date().toISOString() }), pi.id],
      );
      break;
    }

    // ── terminal.reader.action_succeeded — card collected ─────────────────
    case 'terminal.reader.action_succeeded': {
      const reader = event.data.object;
      await query(
        `UPDATE terminal_readers
         SET status       = 'online',
             last_seen_at = now(),
             updated_at   = now()
         WHERE stripe_reader_id = $1`,
        [reader.id],
      );
      break;
    }

    // ── terminal.reader.action_failed — reader error ───────────────────────
    case 'terminal.reader.action_failed': {
      const reader   = event.data.object;
      const failMsg  = reader.action?.failure_message ?? 'Unknown reader failure';
      const failCode = reader.action?.failure_code    ?? 'unknown';

      await query(
        `UPDATE terminal_readers
         SET last_seen_at = now(), updated_at = now()
         WHERE stripe_reader_id = $1`,
        [reader.id],
      );

      // Log for ops visibility — look up org from reader
      await query(
        `INSERT INTO audit_logs (organization_id, actor_type, action, metadata)
         SELECT organization_id, 'system', 'terminal.reader.action_failed', $1
         FROM terminal_readers WHERE stripe_reader_id = $2`,
        [
          JSON.stringify({ readerId: reader.id, failureCode: failCode, failureMessage: failMsg }),
          reader.id,
        ],
      );
      break;
    }

    default:
      break;
  }
}

// ─── simulatePayment (test mode only) ────────────────────────────────────────

/**
 * Simulate a card presentation on a simulated reader.
 * Only works in test mode (STRIPE_SECRET_KEY starts with 'sk_test_').
 *
 * Useful for integration tests and sandbox demos.
 */
export async function simulatePayment(
  orgId:    string,
  readerId: string,
  testCard: 'visa' | 'mastercard' | 'amex' | 'declined' = 'visa',
): Promise<void> {
  if (!config.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    throw new ValidationError('simulatePayment is only available in test mode');
  }

  const merchantAccountId = await requireMerchantAccount(orgId);

  const { rows: [reader] } = await query<{ stripe_reader_id: string }>(
    `SELECT stripe_reader_id FROM terminal_readers
     WHERE id = $1 AND organization_id = $2`,
    [readerId, orgId],
  );
  if (!reader) throw new NotFoundError('Terminal reader');

  const TEST_CARD_NUMBERS: Record<string, string> = {
    visa:       '4242424242424242',
    mastercard: '5555555555554444',
    amex:       '378282246310005',
    declined:   '4000000000000002',
  };

  const merchantStripe = getMerchantStripeClient(merchantAccountId);
  try {
    await merchantStripe.testHelpers.terminal.readers.presentPaymentMethod(
      reader.stripe_reader_id,
      { card_present: { number: TEST_CARD_NUMBERS[testCard] } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to simulate card presentation: ${msg}`);
  }
}
