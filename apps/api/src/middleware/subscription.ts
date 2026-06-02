/**
 * Subscription access middleware
 *
 * Runs after authentication on every protected route.
 * Checks org subscription status (cached in Redis, 5min TTL).
 * - Trialing: adds X-Trial-Days-Remaining header, allows through
 * - Past due:  adds X-Payment-Required header, allows through (grace period)
 * - Cancelled / expired: returns 402
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkSubscriptionAccess } from '../services/subscription.service';

// Routes exempt from subscription check (public + webhook + metrics)
const SUBSCRIPTION_EXEMPT_PREFIXES = [
  '/api/health',
  '/api/v1/auth/',
  '/api/v1/webhooks/',
  '/api/v1/register',
  '/api/v1/billing/portal',   // portal redirect still needs auth, but not sub check
  '/metrics',
];

function isExempt(url: string): boolean {
  return SUBSCRIPTION_EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export async function checkSubscription(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (isExempt(request.url)) return;

  // @ts-expect-error — decorated by auth plugin
  const orgId: string | undefined = request.user?.organizationId;
  if (!orgId) return; // anonymous request — auth middleware handles 401

  const access = await checkSubscriptionAccess(orgId);

  if (access.isTrialing && access.daysRemaining >= 0) {
    reply.header('X-Trial-Days-Remaining', String(access.daysRemaining));
  }

  if (access.status === 'past_due') {
    reply.header('X-Payment-Required', 'true');
  }

  if (!access.hasAccess) {
    return reply.code(402).send({
      code:       'SUBSCRIPTION_REQUIRED',
      message:    'Your subscription has ended. Please renew to continue using Taproot POS.',
      upgradeUrl: `${process.env.APP_URL ?? 'https://app.taprootpos.com'}/billing`,
      status:     access.status,
    });
  }
}
