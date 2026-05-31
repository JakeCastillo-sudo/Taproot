import { jest } from '@jest/globals';

// ─── connect.service.ts — unit tests ─────────────────────────────────────────
// Tests the full Connect onboarding lifecycle: create, status sync,
// refresh link, and webhook event processing.

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn<() => Promise<any>>();
jest.mock('../../db/client', () => ({ query: mockQuery }));
jest.mock('../../auth/audit', () => ({ createAuditLog: jest.fn() }));

// Stripe mock
const mockAccountsCreate   = jest.fn<() => Promise<any>>();
const mockAccountsRetrieve = jest.fn<() => Promise<any>>();
const mockAccountLinksCreate = jest.fn<() => Promise<any>>();
const mockWebhooksConstructEvent = jest.fn<() => any>();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    accounts:     { create: mockAccountsCreate, retrieve: mockAccountsRetrieve },
    accountLinks: { create: mockAccountLinksCreate },
    webhooks:     { constructEvent: mockWebhooksConstructEvent },
  })),
);

jest.mock('../../config', () => ({
  config: {
    STRIPE_SECRET_KEY:              'sk_test_fake',
    STRIPE_CONNECT_WEBHOOK_SECRET:  'whsec_test_connect',
    APP_URL:                        'http://localhost:5173',
    TAPROOT_APPLICATION_FEE_RATE:   0.003,
  },
}));

import {
  createConnectAccount,
  getConnectAccountStatus,
  refreshOnboardingLink,
  handleConnectWebhook,
} from '../../payments/connect.service';
import { ValidationError, NotFoundError } from '../../errors';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function orgWithNoAccount() {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      stripe_connect_account_id: null,
      payment_processing_enabled: false,
      stripe_connect_status: 'not_connected',
    }],
  });
}

function orgWithAccount(overrides: Record<string, unknown> = {}) {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      stripe_connect_account_id: 'acct_test_001',
      payment_processing_enabled: false,
      stripe_connect_status: 'onboarding',
      ...overrides,
    }],
  });
}

function orgNotFound() {
  mockQuery.mockResolvedValueOnce({ rows: [] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockAccountsCreate.mockReset();
  mockAccountsRetrieve.mockReset();
  mockAccountLinksCreate.mockReset();
  mockWebhooksConstructEvent.mockReset();
});

// ─── createConnectAccount ─────────────────────────────────────────────────────

describe('createConnectAccount', () => {
  const input = { businessType: 'individual' as const, email: 'owner@cafe.com', country: 'US' };

  it('creates a Stripe account and returns accountId + onboardingUrl', async () => {
    orgWithNoAccount();
    mockAccountsCreate.mockResolvedValueOnce({ id: 'acct_new' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE org
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/onboard' });

    const result = await createConnectAccount('org-1', 'emp-1', input);

    expect(result.accountId).toBe('acct_new');
    expect(result.onboardingUrl).toBe('https://connect.stripe.com/onboard');
    expect(mockAccountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type:          'express',
        email:         'owner@cafe.com',
        country:       'US',
        business_type: 'individual',
      }),
    );
  });

  it('throws ValidationError if org already has a connected account', async () => {
    orgWithAccount();
    await expect(createConnectAccount('org-1', 'emp-1', input)).rejects.toBeInstanceOf(ValidationError);
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('throws NotFoundError if org does not exist', async () => {
    orgNotFound();
    await expect(createConnectAccount('org-1', 'emp-1', input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when Stripe account creation fails', async () => {
    orgWithNoAccount();
    mockAccountsCreate.mockRejectedValueOnce(new Error('Stripe internal error'));
    await expect(createConnectAccount('org-1', 'emp-1', input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('includes businessName in business_profile when provided', async () => {
    orgWithNoAccount();
    mockAccountsCreate.mockResolvedValueOnce({ id: 'acct_biz' });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/biz' });

    await createConnectAccount('org-1', 'emp-1', { ...input, businessName: 'Blue Bottle' });

    expect(mockAccountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        business_profile: { name: 'Blue Bottle' },
      }),
    );
  });
});

// ─── getConnectAccountStatus ──────────────────────────────────────────────────

describe('getConnectAccountStatus', () => {
  it('returns active status when charges_enabled=true', async () => {
    orgWithAccount();
    mockAccountsRetrieve.mockResolvedValueOnce({
      charges_enabled: true,
      payouts_enabled: true,
      requirements:    { currently_due: [], past_due: [] },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const status = await getConnectAccountStatus('org-1');

    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
    expect(status.requiresInformation).toBe(false);
  });

  it('returns restricted status when requirements are due', async () => {
    orgWithAccount();
    mockAccountsRetrieve.mockResolvedValueOnce({
      charges_enabled: false,
      payouts_enabled: false,
      requirements:    { currently_due: ['business.url'], past_due: [] },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const status = await getConnectAccountStatus('org-1');

    expect(status.requiresInformation).toBe(true);
    expect(status.requirementsDue).toContain('business.url');
  });

  it('deduplicates requirements that appear in both currently_due and past_due', async () => {
    orgWithAccount();
    mockAccountsRetrieve.mockResolvedValueOnce({
      charges_enabled: false,
      payouts_enabled: false,
      requirements:    {
        currently_due: ['person.verification.document'],
        past_due:      ['person.verification.document'],
      },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const status = await getConnectAccountStatus('org-1');
    const deduplicated = status.requirementsDue.filter(
      (r) => r === 'person.verification.document',
    );
    expect(deduplicated).toHaveLength(1);
  });

  it('throws ValidationError when org has no Stripe account', async () => {
    orgWithNoAccount();
    await expect(getConnectAccountStatus('org-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when org does not exist', async () => {
    orgNotFound();
    await expect(getConnectAccountStatus('org-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── refreshOnboardingLink ────────────────────────────────────────────────────

describe('refreshOnboardingLink', () => {
  it('returns a new onboarding URL', async () => {
    orgWithAccount(); // payment_processing_enabled=false
    mockAccountLinksCreate.mockResolvedValueOnce({ url: 'https://connect.stripe.com/refresh' });

    const url = await refreshOnboardingLink('org-1');
    expect(url).toBe('https://connect.stripe.com/refresh');
  });

  it('throws ValidationError when org has no Stripe account', async () => {
    orgWithNoAccount();
    await expect(refreshOnboardingLink('org-1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when onboarding is already complete', async () => {
    orgWithAccount({ payment_processing_enabled: true });
    await expect(refreshOnboardingLink('org-1')).rejects.toBeInstanceOf(ValidationError);
    expect(mockAccountLinksCreate).not.toHaveBeenCalled();
  });
});

// ─── handleConnectWebhook ─────────────────────────────────────────────────────

describe('handleConnectWebhook', () => {
  const fakePayload   = Buffer.from('{}');
  const fakeSignature = 'sig_test';

  function mockEvent(type: string, data: object, accountId?: string) {
    mockWebhooksConstructEvent.mockReturnValueOnce({
      type,
      data:    { object: data },
      account: accountId,
    });
  }

  it('throws ValidationError when signature is invalid', async () => {
    mockWebhooksConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    await expect(handleConnectWebhook(fakePayload, fakeSignature)).rejects.toBeInstanceOf(ValidationError);
  });

  it('processes account.updated — promotes to active when charges_enabled', async () => {
    mockEvent('account.updated', {
      id:               'acct_test_001',
      charges_enabled:  true,
      requirements:     { currently_due: [], past_due: [] },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    await handleConnectWebhook(fakePayload, fakeSignature);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE organizations'),
      expect.arrayContaining(['active', true, 'acct_test_001']),
    );
  });

  it('processes account.updated — sets restricted when charges disabled with requirements', async () => {
    mockEvent('account.updated', {
      id:               'acct_test_001',
      charges_enabled:  false,
      requirements:     { currently_due: ['business.url'], past_due: [] },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleConnectWebhook(fakePayload, fakeSignature);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE organizations'),
      expect.arrayContaining(['restricted', false, 'acct_test_001']),
    );
  });

  it('processes account.application.deauthorized — marks org as deauthorized', async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce({
      type:    'account.application.deauthorized',
      data:    { object: {} },
      account: 'acct_deauth',
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleConnectWebhook(fakePayload, fakeSignature);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("stripe_connect_status      = 'deauthorized'"),
      ['acct_deauth'],
    );
  });

  it('processes capability.updated — inserts audit log', async () => {
    mockEvent('capability.updated', {
      id:      'card_payments',
      status:  'active',
      account: 'acct_cap',
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleConnectWebhook(fakePayload, fakeSignature);

    // The SQL contains the action string; params are [jsonMetadata, accountId]
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [
        expect.stringContaining('card_payments'), // metadata JSON contains capability id
        'acct_cap',
      ],
    );
  });

  it('silently ignores unknown event types', async () => {
    mockWebhooksConstructEvent.mockReturnValueOnce({ type: 'unknown.event', data: { object: {} } });
    await expect(handleConnectWebhook(fakePayload, fakeSignature)).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
