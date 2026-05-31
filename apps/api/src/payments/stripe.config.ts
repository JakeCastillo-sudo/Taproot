/**
 * Centralized Stripe client factory.
 *
 * All Stripe API calls flow through one of two clients:
 *   getStripeClient()               — platform-level calls (Connect mgmt, webhook verification)
 *   getMerchantStripeClient(acctId) — merchant-scoped calls (Terminal, PaymentIntents)
 *
 * Merchant clients have the Stripe-Account header baked in at construction time
 * so callers never have to thread the accountId through per-request options.
 * They are cached by accountId so we create at most one instance per merchant.
 *
 * API version: the installed stripe@22 exposes '2026-05-27.dahlia' as
 * LatestApiVersion. Pin it here so all clients share the same version.
 * To upgrade: change STRIPE_API_VERSION once and revalidate typecheck.
 */

import Stripe from 'stripe';
import { config } from '../config';

// ─── Version pin ──────────────────────────────────────────────────────────────

export const STRIPE_API_VERSION = '2026-05-27.dahlia' as const;

// ─── Fee rate ─────────────────────────────────────────────────────────────────

/** Taproot ISV application fee as a fraction of GPV (default 0.3%). */
export const TAPROOT_APPLICATION_FEE_RATE: number = config.TAPROOT_APPLICATION_FEE_RATE;

// ─── Platform client (cached singleton) ──────────────────────────────────────

// `Stripe` cannot be used as a type directly (namespace collision in stripe@22).
// Use InstanceType<typeof Stripe> everywhere a Stripe client instance is typed.
type StripeClient = InstanceType<typeof Stripe>;

let _platformClient: StripeClient | null = null;

/**
 * Returns the platform Stripe client.
 * Use for: Connect account management, webhook verification, platform-level queries.
 */
export function getStripeClient(): StripeClient {
  if (!_platformClient) {
    _platformClient = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return _platformClient;
}

// ─── Merchant-scoped clients (cached per accountId) ───────────────────────────

const _merchantClients = new Map<string, StripeClient>();

/**
 * Returns a Stripe client whose every request is automatically scoped to the
 * given connected merchant account (Stripe-Account header). Use for:
 * Terminal PaymentIntents, Terminal reader management, any ISV operation that
 * runs on behalf of a merchant.
 *
 * Clients are cached — pass the same accountId and you get the same instance.
 */
export function getMerchantStripeClient(accountId: string): StripeClient {
  if (!_merchantClients.has(accountId)) {
    _merchantClients.set(
      accountId,
      new Stripe(config.STRIPE_SECRET_KEY, {
        apiVersion: STRIPE_API_VERSION,
        stripeAccount: accountId,
      }),
    );
  }
  return _merchantClients.get(accountId)!;
}

// ─── Test helpers (dev / test only) ──────────────────────────────────────────

/**
 * Evict cached clients — useful in tests to inject a fresh mock.
 * @internal
 */
export function _resetClientsForTesting(): void {
  _platformClient = null;
  _merchantClients.clear();
}
