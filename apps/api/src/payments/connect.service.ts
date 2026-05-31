/**
 * Stripe Connect — ISV merchant onboarding and account lifecycle.
 *
 * DB schema (migration 005):
 *   organizations.stripe_connect_account_id — Stripe Express account ID
 *   organizations.stripe_connect_status     — 'not_connected'|'onboarding'|'active'|'restricted'|'deauthorized'
 *   organizations.stripe_connect_enabled_at — when charges first became enabled
 *   organizations.payment_processing_enabled — true when account can accept payments
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { query } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { getStripeClient } from './stripe.config';
import { createAuditLog } from '../auth/audit';
import { config } from '../config';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateConnectAccountInput {
  businessType: 'individual' | 'company';
  email: string;
  country: string;
  businessName?: string;
}

export interface ConnectAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requiresInformation: boolean;
  requirementsDue: string[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getOrg(orgId: string): Promise<{
  stripe_connect_account_id: string | null;
  payment_processing_enabled: boolean;
  stripe_connect_status: string;
}> {
  const { rows: [org] } = await query(
    `SELECT stripe_connect_account_id, payment_processing_enabled, stripe_connect_status
     FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  if (!org) throw new NotFoundError('Organization');
  return org as any;
}

// ─── createConnectAccount ─────────────────────────────────────────────────────

export async function createConnectAccount(
  orgId: string,
  employeeId: string,
  input: CreateConnectAccountInput,
): Promise<{ accountId: string; onboardingUrl: string }> {
  const stripe = getStripeClient();
  const org = await getOrg(orgId);

  if (org.stripe_connect_account_id) {
    throw new ValidationError(
      'Organization already has a connected Stripe account. ' +
      'Use refreshOnboardingLink() if onboarding is incomplete.',
    );
  }

  let account: any;
  try {
    account = await stripe.accounts.create({
      type: 'express',
      country: input.country,
      email: input.email,
      business_type: input.businessType,
      ...(input.businessName && { business_profile: { name: input.businessName } }),
      capabilities: {
        card_payments: { requested: true },
        transfers:     { requested: true },
      },
      metadata: { taprootOrgId: orgId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to create Stripe account: ${msg}`);
  }

  await query(
    `UPDATE organizations
     SET stripe_connect_account_id = $1,
         stripe_connect_status     = 'onboarding',
         updated_at                = now()
     WHERE id = $2`,
    [account.id, orgId],
  );

  let link: any;
  try {
    link = await stripe.accountLinks.create({
      account:     account.id,
      refresh_url: `${config.APP_URL}/settings/payments/connect/refresh`,
      return_url:  `${config.APP_URL}/settings/payments/connect/return`,
      type:        'account_onboarding',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Account created (${account.id}) but onboarding link failed: ${msg}`);
  }

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'stripe.connect.account_created',
    resourceType:   'organization',
    resourceId:     orgId,
    afterState:     { stripeAccountId: account.id, country: input.country },
  });

  return { accountId: account.id, onboardingUrl: link.url };
}

// ─── getConnectAccountStatus ──────────────────────────────────────────────────

export async function getConnectAccountStatus(orgId: string): Promise<ConnectAccountStatus> {
  const org = await getOrg(orgId);
  if (!org.stripe_connect_account_id) {
    throw new ValidationError('Organization has no connected Stripe account');
  }

  const stripe = getStripeClient();
  let account: any;
  try {
    account = await stripe.accounts.retrieve(org.stripe_connect_account_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to retrieve Stripe account: ${msg}`);
  }

  const requirements = account.requirements ?? {};
  const requirementsDue: string[] = [
    ...(requirements.currently_due ?? []),
    ...(requirements.past_due     ?? []),
  ].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const requiresInformation = requirementsDue.length > 0 || !!requirements.disabled_reason;

  const newStatus = chargesEnabled ? 'active' : requirementsDue.length > 0 ? 'restricted' : 'onboarding';

  await query(
    `UPDATE organizations
     SET stripe_connect_status      = $1,
         payment_processing_enabled = $2,
         stripe_connect_enabled_at  = CASE
           WHEN $2 = true AND stripe_connect_enabled_at IS NULL
           THEN now()
           ELSE stripe_connect_enabled_at
         END,
         updated_at = now()
     WHERE id = $3`,
    [newStatus, chargesEnabled, orgId],
  );

  return {
    accountId:          org.stripe_connect_account_id,
    chargesEnabled,
    payoutsEnabled,
    requiresInformation,
    requirementsDue,
  };
}

// ─── refreshOnboardingLink ────────────────────────────────────────────────────

export async function refreshOnboardingLink(orgId: string): Promise<string> {
  const org = await getOrg(orgId);
  if (!org.stripe_connect_account_id) {
    throw new ValidationError('Organization has no connected Stripe account');
  }
  if (org.payment_processing_enabled) {
    throw new ValidationError('Stripe account onboarding is already complete');
  }

  const stripe = getStripeClient();
  let link: any;
  try {
    link = await stripe.accountLinks.create({
      account:     org.stripe_connect_account_id,
      refresh_url: `${config.APP_URL}/settings/payments/connect/refresh`,
      return_url:  `${config.APP_URL}/settings/payments/connect/return`,
      type:        'account_onboarding',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Failed to generate onboarding link: ${msg}`);
  }

  return link.url;
}

// ─── handleConnectWebhook ─────────────────────────────────────────────────────

export async function handleConnectWebhook(
  payload:   string | Buffer,
  signature: string,
): Promise<void> {
  if (!config.STRIPE_CONNECT_WEBHOOK_SECRET) {
    throw new ValidationError('STRIPE_CONNECT_WEBHOOK_SECRET is not configured');
  }

  const stripe = getStripeClient();
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, config.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Connect webhook signature verification failed: ${msg}`);
  }

  const connectedAccountId: string | null = (event as { account?: string }).account ?? null;

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object;
      const requirements = account.requirements ?? {};
      const requirementsDue: string[] = [
        ...(requirements.currently_due ?? []),
        ...(requirements.past_due ?? []),
      ].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

      const chargesEnabled = !!account.charges_enabled;
      const newStatus = chargesEnabled ? 'active' : requirementsDue.length > 0 ? 'restricted' : 'onboarding';

      await query(
        `UPDATE organizations
         SET stripe_connect_status      = $1,
             payment_processing_enabled = $2,
             stripe_connect_enabled_at  = CASE
               WHEN $2 = true AND stripe_connect_enabled_at IS NULL
               THEN now()
               ELSE stripe_connect_enabled_at
             END,
             updated_at = now()
         WHERE stripe_connect_account_id = $3`,
        [newStatus, chargesEnabled, account.id],
      );
      break;
    }

    case 'account.application.deauthorized': {
      if (connectedAccountId) {
        await query(
          `UPDATE organizations
           SET stripe_connect_status      = 'deauthorized',
               payment_processing_enabled = false,
               updated_at                 = now()
           WHERE stripe_connect_account_id = $1`,
          [connectedAccountId],
        );
      }
      break;
    }

    case 'capability.updated': {
      const cap = event.data.object;
      const capAccountId =
        typeof cap.account === 'string' ? cap.account : (cap.account as { id: string }).id;

      await query(
        `INSERT INTO audit_logs (organization_id, actor_type, action, metadata)
         SELECT id, 'system', 'stripe.connect.capability_updated', $1
         FROM organizations WHERE stripe_connect_account_id = $2`,
        [
          JSON.stringify({ capability: cap.id, status: cap.status, accountId: capAccountId }),
          capAccountId,
        ],
      );
      break;
    }

    default:
      break;
  }
}
