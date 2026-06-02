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

  // ─── Onboarding funnel ──────────────────────────────────────────────────────

  onboardingStarted(referralSource?: string, businessType?: string) {
    track('onboarding_started', {
      ...(referralSource ? { referral_source: referralSource } : {}),
      ...(businessType   ? { business_type:   businessType   } : {}),
    });
  },

  onboardingStepViewed(step: string) {
    track('onboarding_step_viewed', { step });
  },

  onboardingStepCompleted(step: string, timeSpentSeconds: number) {
    track('onboarding_step_completed', { step, time_spent_seconds: timeSpentSeconds });
  },

  onboardingStepSkipped(step: string) {
    track('onboarding_step_skipped', { step });
  },

  menuUploadStarted(method: 'pdf' | 'csv' | 'url' | 'manual' | 'demo') {
    track('menu_upload_started', { method });
  },

  menuUploadCompleted(itemCount: number, confidenceAvg: number) {
    track('menu_upload_completed', {
      item_count:      itemCount,
      confidence_avg:  Math.round(confidenceAvg * 100),
    });
  },

  menuItemsApproved(count: number, editedCount: number) {
    track('menu_items_approved', { count, edited_count: editedCount });
  },

  recipeSetupCompleted(recipeCount: number) {
    track('recipe_setup_completed', { recipe_count: recipeCount });
  },

  recipeSetupSkipped() {
    track('recipe_setup_skipped');
  },

  stripeConnected() {
    track('stripe_connected');
  },

  onboardingCompleted(opts: {
    totalTimeSeconds:    number;
    itemsImported:       number;
    recipesConfigured:   number;
    stripeConnected:     boolean;
    referralSource?:     string;
  }) {
    track('onboarding_completed', {
      total_time_seconds:  opts.totalTimeSeconds,
      items_imported:      opts.itemsImported,
      recipes_configured:  opts.recipesConfigured,
      stripe_connected:    opts.stripeConnected,
      ...(opts.referralSource ? { referral_source: opts.referralSource } : {}),
    });
  },

  onboardingAbandoned(lastStep: string, timeSpentSeconds: number) {
    track('onboarding_abandoned', { last_step: lastStep, time_spent_seconds: timeSpentSeconds });
  },
} as const;
