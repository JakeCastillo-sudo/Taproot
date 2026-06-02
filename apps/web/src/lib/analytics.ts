/**
 * Analytics — privacy-respecting event tracking via Plausible
 *
 * No cookies, no PII, GDPR compliant by design.
 * The Plausible script is loaded in index.html.
 * This module provides typed event helpers.
 *
 * Events fire in production only (silent no-op in development).
 */

type PlausibleFn = (
  event: string,
  options?: { props?: Record<string, string | number | boolean> },
) => void;

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

function track(event: string, props?: Record<string, string | number | boolean>): void {
  if (typeof window === 'undefined') return;
  if (!window.plausible) return;  // Script not loaded (dev or blocked)
  try {
    window.plausible(event, props ? { props } : undefined);
  } catch {
    // Never let analytics break the app
  }
}

// ─── Typed event helpers ──────────────────────────────────────────────────────

export const analytics = {
  /** Fired on every route change (also done automatically by Plausible script) */
  pageView() {
    track('pageview');
  },

  login() {
    track('login');
  },

  /** @param valueCents order total in cents (no customer data) */
  orderCompleted(valueCents: number) {
    track('order_completed', { value: Math.round(valueCents / 100) });
  },

  productAddedToCart() {
    track('product_added_to_cart');
  },

  importUploaded(fileType: string) {
    track('import_uploaded', { file_type: fileType });
  },

  migrationStarted(provider: string) {
    track('migration_started', { provider });
  },

  migrationCompleted(provider: string) {
    track('migration_completed', { provider });
  },

  subscriptionStarted() {
    track('subscription_started');
  },

  /** @param referralSource 'legalzoom' | 'google' | 'referral' | 'other' */
  trialStarted(referralSource?: string) {
    track('trial_started', referralSource ? { referral_source: referralSource } : undefined);
  },

  upgradePageViewed() {
    track('upgrade_page_viewed');
  },
} as const;
