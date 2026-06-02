/**
 * Subscription service — Stripe Billing + access control
 *
 * Manages the $199/mo per-location SaaS subscription.
 * Billing flow: trialing (14d) → active → past_due (7d grace) → cancelled
 *
 * All Stripe Billing operations use the platform Stripe client (not the
 * merchant-scoped client) since subscriptions are charged to the restaurant
 * owner's card via Taproot's platform account, not their Connect account.
 */

import { query, withTransaction } from '../db/client';
import { getPublisher } from '../db/redis';
import { getStripeClient } from '../payments/stripe.config';
import { config } from '../config';
import { createAuditLog } from '../auth/audit';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'unpaid';

export interface OrgSubscription {
  orgId:                  string;
  stripeCustomerId:       string | null;
  stripeSubscriptionId:   string | null;
  subscriptionStatus:     SubscriptionStatus;
  subscriptionPlan:       string;
  trialEndsAt:            Date;
  subscriptionEndsAt:     Date | null;
  locationCount:          number;
}

export interface SubscriptionAccess {
  hasAccess:        boolean;
  status:           SubscriptionStatus;
  daysRemaining:    number;
  isTrialing:       boolean;
}

// ─── Redis cache key ──────────────────────────────────────────────────────────

const CACHE_KEY = (orgId: string) => `sub:access:${orgId}`;
const CACHE_TTL = 300; // 5 minutes

// ─── createSubscription ───────────────────────────────────────────────────────

export async function createSubscription(
  orgId: string,
  employeeId: string,
  input: {
    priceId:         string;
    paymentMethodId: string;
    locationCount:   number;
    referralSource?: string;
  },
): Promise<OrgSubscription> {
  const stripe = getStripeClient();

  // Get org details
  const orgRow = await query<{
    id: string; name: string; billing_email: string | null;
    stripe_customer_id: string | null;
  }>('SELECT id, name, billing_email, stripe_customer_id FROM organizations WHERE id = $1', [orgId]);
  if (!orgRow.rows[0]) throw new Error('Organization not found');
  const org = orgRow.rows[0];

  // Get billing employee email
  const empRow = await query<{ email: string }>(
    'SELECT email FROM employees WHERE id = $1', [employeeId],
  );
  const email = empRow.rows[0]?.email ?? org.billing_email ?? '';

  // ── Create or fetch Stripe Customer ─────────────────────────────────────────
  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      name: org.name,
      metadata: { taproot_org_id: orgId },
    });
    customerId = customer.id;
  }

  // Attach payment method to customer
  await stripe.paymentMethods.attach(input.paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: input.paymentMethodId },
  });

  // ── Trial end: LegalZoom gets 30 days, everyone else 14 ─────────────────────
  const isLegalZoom = input.referralSource === 'legalzoom';
  const trialDays   = isLegalZoom ? 30 : 14;
  const trialEnd    = Math.floor((Date.now() + trialDays * 24 * 60 * 60 * 1000) / 1000);

  // ── Create Stripe Subscription with trial ────────────────────────────────────
  const subscription = await stripe.subscriptions.create({
    customer:   customerId,
    items:      [{ price: input.priceId, quantity: input.locationCount }],
    trial_end:  trialEnd,
    metadata: {
      taproot_org_id:      orgId,
      taproot_employee_id: employeeId,
    },
    expand: ['latest_invoice.payment_intent'],
  });

  // ── Persist to DB ────────────────────────────────────────────────────────────
  const trialEndsAt = new Date(trialEnd * 1000);
  await query(
    `UPDATE organizations
     SET stripe_customer_id     = $1,
         stripe_subscription_id = $2,
         subscription_status    = 'trialing',
         subscription_plan      = 'starter',
         trial_ends_at          = $3,
         location_count         = $4,
         updated_at             = now()
     WHERE id = $5`,
    [customerId, subscription.id, trialEndsAt, input.locationCount, orgId],
  );

  // ── Audit log ────────────────────────────────────────────────────────────────
  await createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    actorType:      'employee',
    action:         'subscription.created',
    resourceType:   'subscription',
    resourceId:     subscription.id,
    metadata:       { priceId: input.priceId, locationCount: input.locationCount, trialDays },
  });

  // Bust cache
  await getPublisher().del(CACHE_KEY(orgId));

  return {
    orgId,
    stripeCustomerId:     customerId,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus:   'trialing',
    subscriptionPlan:     'starter',
    trialEndsAt,
    subscriptionEndsAt:   null,
    locationCount:        input.locationCount,
  };
}

// ─── handleSubscriptionWebhook ────────────────────────────────────────────────

export async function handleSubscriptionWebhook(event: {
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<void> {
  const stripe = getStripeClient();

  switch (event.type) {

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as {
        id: string; customer: string; status: string;
        current_period_end: number; trial_end: number | null;
      };
      const stripeStatus = mapStripeStatus(sub.status);
      const endsAt = new Date(sub.current_period_end * 1000);
      const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;

      await query(
        `UPDATE organizations
         SET subscription_status    = $1,
             subscription_ends_at   = $2,
             ${trialEndsAt ? 'trial_ends_at = $4,' : ''}
             updated_at             = now()
         WHERE stripe_subscription_id = $3`,
        trialEndsAt
          ? [stripeStatus, endsAt, sub.id, trialEndsAt]
          : [stripeStatus, endsAt, sub.id],
      );

      // Bust cache for affected org
      const orgRow = await query<{ id: string }>(
        'SELECT id FROM organizations WHERE stripe_customer_id = $1', [sub.customer],
      );
      if (orgRow.rows[0]) {
        await getPublisher().del(CACHE_KEY(orgRow.rows[0].id));
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as { id: string; customer: string };
      // Grace period: 7 days before hard cutoff
      const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await query(
        `UPDATE organizations
         SET subscription_status  = 'cancelled',
             subscription_ends_at = $1,
             updated_at           = now()
         WHERE stripe_subscription_id = $2`,
        [gracePeriodEndsAt, sub.id],
      );

      const orgRow = await query<{ id: string }>(
        'SELECT id FROM organizations WHERE stripe_customer_id = $1', [sub.customer],
      );
      if (orgRow.rows[0]) {
        await getPublisher().del(CACHE_KEY(orgRow.rows[0].id));
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const inv = event.data.object as { customer: string; subscription: string | null };
      if (!inv.subscription) break;

      // Re-activate if past_due after successful payment
      await query(
        `UPDATE organizations
         SET subscription_status = 'active',
             updated_at = now()
         WHERE stripe_subscription_id = $1 AND subscription_status = 'past_due'`,
        [inv.subscription],
      );

      const orgRow = await query<{ id: string }>(
        'SELECT id FROM organizations WHERE stripe_customer_id = $1', [inv.customer],
      );
      if (orgRow.rows[0]) {
        await getPublisher().del(CACHE_KEY(orgRow.rows[0].id));
      }
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as {
        customer: string; subscription: string | null;
        customer_email: string | null;
      };
      if (!inv.subscription) break;

      // Mark past_due with 7-day grace period
      const graceEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await query(
        `UPDATE organizations
         SET subscription_status  = 'past_due',
             subscription_ends_at = $1,
             updated_at           = now()
         WHERE stripe_subscription_id = $2`,
        [graceEnd, inv.subscription],
      );

      // Retrieve org for email
      const orgRow = await query<{ id: string; name: string }>(
        'SELECT id, name FROM organizations WHERE stripe_subscription_id = $1', [inv.subscription],
      );
      if (orgRow.rows[0]) {
        await getPublisher().del(CACHE_KEY(orgRow.rows[0].id));

        // Fire payment-failed email directly (non-blocking)
        if (inv.customer_email) {
          const { sendPaymentFailedEmail } = await import('./email.service');
          sendPaymentFailedEmail(
            { email: inv.customer_email, firstName: '' },
            { name: orgRow.rows[0].name },
          ).catch(() => { /* non-blocking */ });
        }
      }
      break;
    }

    default:
      // Unhandled billing event — ignore silently
      break;
  }
}

// ─── checkSubscriptionAccess ──────────────────────────────────────────────────

export async function checkSubscriptionAccess(orgId: string): Promise<SubscriptionAccess> {
  const redis = getPublisher();

  // Check Redis cache first
  const cached = await redis.get(CACHE_KEY(orgId));
  if (cached) {
    try {
      return JSON.parse(cached) as SubscriptionAccess;
    } catch { /* cache miss — fall through */ }
  }

  const row = await query<{
    subscription_status:  string;
    trial_ends_at:        Date;
    subscription_ends_at: Date | null;
  }>(
    `SELECT subscription_status, trial_ends_at, subscription_ends_at
     FROM organizations WHERE id = $1`,
    [orgId],
  );

  const org = row.rows[0];
  if (!org) {
    return { hasAccess: false, status: 'cancelled', daysRemaining: 0, isTrialing: false };
  }

  const status    = org.subscription_status as SubscriptionStatus;
  const now       = Date.now();
  const isTrialing = status === 'trialing';
  let hasAccess   = false;
  let daysRemaining = 0;

  if (isTrialing) {
    const trialEnd = new Date(org.trial_ends_at).getTime();
    daysRemaining  = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
    hasAccess      = daysRemaining > 0;
  } else if (status === 'active') {
    hasAccess      = true;
    daysRemaining  = -1; // unlimited
  } else if (status === 'past_due' || status === 'cancelled') {
    // Grace period: allow access until subscription_ends_at
    const endsAt  = org.subscription_ends_at
      ? new Date(org.subscription_ends_at).getTime()
      : 0;
    daysRemaining = Math.max(0, Math.ceil((endsAt - now) / (24 * 60 * 60 * 1000)));
    hasAccess     = daysRemaining > 0;
  }

  const result: SubscriptionAccess = { hasAccess, status, daysRemaining, isTrialing };

  // Cache result
  await redis.setex(CACHE_KEY(orgId), CACHE_TTL, JSON.stringify(result));

  return result;
}

// ─── getSubscriptionPortalUrl ─────────────────────────────────────────────────

export async function getSubscriptionPortalUrl(orgId: string): Promise<string> {
  const stripe = getStripeClient();

  const orgRow = await query<{ stripe_customer_id: string | null }>(
    'SELECT stripe_customer_id FROM organizations WHERE id = $1', [orgId],
  );
  const customerId = orgRow.rows[0]?.stripe_customer_id;
  if (!customerId) throw new Error('No Stripe customer found for this organization');

  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: `${config.APP_URL}/billing`,
  });

  return session.url;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':  return 'trialing';
    case 'active':    return 'active';
    case 'past_due':  return 'past_due';
    case 'canceled':
    case 'cancelled': return 'cancelled';
    case 'unpaid':    return 'unpaid';
    default:          return 'cancelled';
  }
}
