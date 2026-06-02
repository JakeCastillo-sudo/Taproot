/**
 * Billing routes — subscription management
 *
 * GET  /api/v1/billing/subscription  — current plan + status
 * POST /api/v1/billing/portal        — create Stripe billing portal session
 * GET  /api/v1/billing/invoices      — recent invoice history
 * POST /api/v1/billing/subscribe     — start/upgrade subscription
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/client';
import { getStripeClient } from '../payments/stripe.config';
import {
  createSubscription,
  getSubscriptionPortalUrl,
} from '../services/subscription.service';
import { config } from '../config';

// ─── Schema ───────────────────────────────────────────────────────────────────

const SubscribeBody = z.object({
  paymentMethodId: z.string().min(1),
  locationCount:   z.number().int().min(1).max(50).optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function billingRoutes(fastify: FastifyInstance) {

  // ── GET /api/v1/billing/subscription ─────────────────────────────────────

  fastify.get('/api/v1/billing/subscription', async (request, reply) => {
    // @ts-expect-error — decorated by auth plugin
    const orgId: string = request.user?.organizationId;
    if (!orgId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Not authenticated' });

    const result = await query<{
      stripe_customer_id:     string | null;
      stripe_subscription_id: string | null;
      subscription_status:    string;
      subscription_plan:      string;
      trial_ends_at:          Date;
      subscription_ends_at:   Date | null;
      location_count:         number;
    }>(
      `SELECT stripe_customer_id, stripe_subscription_id, subscription_status,
              subscription_plan, trial_ends_at, subscription_ends_at, location_count
       FROM organizations WHERE id = $1`,
      [orgId],
    );

    const org = result.rows[0];
    if (!org) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Organization not found' });

    const now          = new Date();
    const trialEndsAt  = new Date(org.trial_ends_at);
    const daysRemaining = Math.max(
      0,
      Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const isTrialing = org.subscription_status === 'trialing';

    return {
      status:             org.subscription_status,
      plan:               org.subscription_plan,
      isTrialing,
      daysRemaining:      isTrialing ? daysRemaining : 0,
      trialEndsAt:        isTrialing ? trialEndsAt.toISOString() : null,
      subscriptionEndsAt: org.subscription_ends_at
        ? new Date(org.subscription_ends_at).toISOString()
        : null,
      locationCount:      org.location_count,
      stripeCustomerId:   org.stripe_customer_id,
    };
  });

  // ── POST /api/v1/billing/portal ───────────────────────────────────────────

  fastify.post('/api/v1/billing/portal', async (request, reply) => {
    // @ts-expect-error — decorated by auth plugin
    const orgId: string = request.user?.organizationId;
    if (!orgId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Not authenticated' });

    try {
      const url = await getSubscriptionPortalUrl(orgId);
      return { url };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create portal session';
      return reply.code(422).send({ code: 'PORTAL_ERROR', message });
    }
  });

  // ── GET /api/v1/billing/invoices ──────────────────────────────────────────

  fastify.get('/api/v1/billing/invoices', async (request, reply) => {
    // @ts-expect-error — decorated by auth plugin
    const orgId: string = request.user?.organizationId;
    if (!orgId) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Not authenticated' });

    const orgResult = await query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM organizations WHERE id = $1',
      [orgId],
    );
    const customerId = orgResult.rows[0]?.stripe_customer_id;
    if (!customerId) return { invoices: [] };

    const stripe = getStripeClient();
    const invoiceList = await stripe.invoices.list({
      customer: customerId,
      limit:    10,
      status:   'paid',
    });

    return {
      invoices: invoiceList.data.map((inv) => ({
        id:         inv.id,
        number:     inv.number ?? inv.id,
        amountPaid: inv.amount_paid,
        currency:   inv.currency,
        status:     inv.status ?? 'unknown',
        created:    inv.created,
        invoicePdf: inv.invoice_pdf ?? null,
      })),
    };
  });

  // ── POST /api/v1/billing/subscribe ────────────────────────────────────────

  fastify.post('/api/v1/billing/subscribe', async (request, reply) => {
    // @ts-expect-error — decorated by auth plugin
    const user = request.user as { organizationId: string; employeeId: string } | undefined;
    if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Not authenticated' });

    const parsed = SubscribeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code:    'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: parsed.error.flatten(),
      });
    }

    const priceId = config.STRIPE_BILLING_PRICE_ID;
    if (!priceId) {
      return reply.code(500).send({ code: 'CONFIG_ERROR', message: 'Billing not configured' });
    }

    // Get org referral source
    const orgResult = await query<{ referral_source: string | null; location_count: number }>(
      'SELECT referral_source, location_count FROM organizations WHERE id = $1',
      [user.organizationId],
    );
    const org = orgResult.rows[0];

    const sub = await createSubscription(user.organizationId, user.employeeId, {
      priceId,
      paymentMethodId: parsed.data.paymentMethodId,
      locationCount:   parsed.data.locationCount ?? org?.location_count ?? 1,
      referralSource:  org?.referral_source ?? undefined,
    });

    return reply.code(201).send({
      status:             sub.subscriptionStatus,
      stripeCustomerId:   sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
    });
  });
}
