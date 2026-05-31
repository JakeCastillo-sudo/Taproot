import { jest } from '@jest/globals';

// ─── stripe.config.ts — unit tests ───────────────────────────────────────────
// Tests caching behaviour, merchant-scope isolation, and the test-reset helper.
// We mock the Stripe constructor so no real HTTP calls are made.

const mockStripeConstructor = jest.fn<() => object>().mockImplementation(() => ({}));

jest.mock('stripe', () => mockStripeConstructor);

// Mock config to supply a fake secret key
jest.mock('../../config', () => ({
  config: {
    STRIPE_SECRET_KEY:         'sk_test_fake',
    TAPROOT_APPLICATION_FEE_RATE: 0.003,
  },
}));

import {
  getStripeClient,
  getMerchantStripeClient,
  _resetClientsForTesting,
  STRIPE_API_VERSION,
  TAPROOT_APPLICATION_FEE_RATE,
} from '../../payments/stripe.config';

beforeEach(() => {
  _resetClientsForTesting();
  mockStripeConstructor.mockClear();
});

// ─── STRIPE_API_VERSION ───────────────────────────────────────────────────────

describe('STRIPE_API_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof STRIPE_API_VERSION).toBe('string');
    expect(STRIPE_API_VERSION.length).toBeGreaterThan(0);
  });
});

// ─── TAPROOT_APPLICATION_FEE_RATE ─────────────────────────────────────────────

describe('TAPROOT_APPLICATION_FEE_RATE', () => {
  it('equals the config value (0.003)', () => {
    expect(TAPROOT_APPLICATION_FEE_RATE).toBe(0.003);
  });
});

// ─── getStripeClient ──────────────────────────────────────────────────────────

describe('getStripeClient', () => {
  it('constructs a Stripe client on first call', () => {
    getStripeClient();
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
    expect(mockStripeConstructor).toHaveBeenCalledWith('sk_test_fake', {
      apiVersion: STRIPE_API_VERSION,
    });
  });

  it('returns the same instance on subsequent calls (singleton)', () => {
    const a = getStripeClient();
    const b = getStripeClient();
    expect(a).toBe(b);
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh client after _resetClientsForTesting()', () => {
    const a = getStripeClient();
    _resetClientsForTesting();
    mockStripeConstructor.mockClear();
    const b = getStripeClient();
    // After reset, a fresh constructor call is made
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
    // The two instances may differ (mock returns fresh objects each time)
    expect(a).not.toBe(b);
  });
});

// ─── getMerchantStripeClient ──────────────────────────────────────────────────

describe('getMerchantStripeClient', () => {
  it('constructs a merchant-scoped client with stripeAccount set', () => {
    getMerchantStripeClient('acct_abc');
    expect(mockStripeConstructor).toHaveBeenCalledWith('sk_test_fake', {
      apiVersion:   STRIPE_API_VERSION,
      stripeAccount: 'acct_abc',
    });
  });

  it('caches clients by accountId', () => {
    const a = getMerchantStripeClient('acct_abc');
    const b = getMerchantStripeClient('acct_abc');
    expect(a).toBe(b);
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
  });

  it('creates separate clients for different accountIds', () => {
    const a = getMerchantStripeClient('acct_001');
    const b = getMerchantStripeClient('acct_002');
    expect(a).not.toBe(b);
    expect(mockStripeConstructor).toHaveBeenCalledTimes(2);
  });

  it('does not share cache with the platform client', () => {
    getStripeClient();
    getMerchantStripeClient('acct_001');
    // Platform + 1 merchant = 2 constructor calls
    expect(mockStripeConstructor).toHaveBeenCalledTimes(2);
  });

  it('creates fresh clients after _resetClientsForTesting()', () => {
    const a = getMerchantStripeClient('acct_xyz');
    _resetClientsForTesting();
    mockStripeConstructor.mockClear();
    const b = getMerchantStripeClient('acct_xyz');
    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
    expect(a).not.toBe(b);
  });
});
