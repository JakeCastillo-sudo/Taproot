/**
 * Stripe client — safe initialization with publishable-key guard.
 *
 * loadStripe('') throws an unhandled promise rejection at module load time,
 * which crashes the login flow even though the user never visits /upgrade.
 *
 * This module guards against that: if VITE_STRIPE_PUBLISHABLE_KEY is absent
 * or empty the promise resolves to null and all payment UI shows a
 * "Demo mode — payments disabled" message instead of crashing.
 */
import { loadStripe, type Stripe } from '@stripe/stripe-js';

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

if (!STRIPE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[Stripe] VITE_STRIPE_PUBLISHABLE_KEY is not set — payment features disabled. ' +
    'Add the key to your .env or Vercel environment variables to enable billing.',
  );
}

/**
 * True when a publishable key is configured; use this to gate payment UI
 * before the promise resolves (avoids "loading" vs "no key" ambiguity).
 */
export const hasStripe = !!STRIPE_KEY;

/**
 * Resolves to the Stripe instance, or null when no key is configured.
 * Pass directly to <Elements stripe={stripePromise}>.
 */
export const stripePromise: Promise<Stripe | null> = STRIPE_KEY
  ? loadStripe(STRIPE_KEY)
  : Promise.resolve(null);
