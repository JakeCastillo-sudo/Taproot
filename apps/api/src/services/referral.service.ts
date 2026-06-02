/**
 * Referral service — generic partner code + referral tracking
 *
 * All partner relationships are data-driven:
 *   - Adding a partner = INSERT INTO partner_codes
 *   - No code changes ever needed
 *
 * Trial day logic:
 *   - Default: 14 days for all sources
 *   - partnerCode lookup: returns code's trial_days if valid + active
 *   - If code expired / exhausted / not found: falls back to 14 days
 */

import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';

const DEFAULT_TRIAL_DAYS = 14;

// ─── getTrialDays ─────────────────────────────────────────────────────────────

export async function getTrialDays(
  _referralSource: string,
  partnerCode?: string,
): Promise<number> {
  if (!partnerCode) return DEFAULT_TRIAL_DAYS;

  const result = await query<{
    trial_days: number;
    is_active:  boolean;
    uses_count: number;
    max_uses:   number | null;
    expires_at: Date | null;
  }>(
    `SELECT trial_days, is_active, uses_count, max_uses, expires_at
     FROM partner_codes
     WHERE code = $1`,
    [partnerCode.toUpperCase()],
  );

  const code = result.rows[0];
  if (!code) return DEFAULT_TRIAL_DAYS;
  if (!code.is_active) return DEFAULT_TRIAL_DAYS;
  if (code.max_uses !== null && code.uses_count >= code.max_uses) return DEFAULT_TRIAL_DAYS;
  if (code.expires_at && new Date(code.expires_at) < new Date()) return DEFAULT_TRIAL_DAYS;

  return code.trial_days;
}

// ─── trackReferral ────────────────────────────────────────────────────────────

export async function trackReferral(
  orgId:           string,
  referralSource?: string,
  partnerCode?:    string,
): Promise<void> {
  const trialDays = await getTrialDays(referralSource ?? 'direct', partnerCode);

  // Update org metadata
  await query(
    `UPDATE organizations
     SET metadata   = metadata || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [
      JSON.stringify({
        referral_source:    referralSource ?? 'direct',
        partner_code:       partnerCode ?? null,
        trial_days_granted: trialDays,
      }),
      orgId,
    ],
  );

  // Increment partner code usage counter
  if (partnerCode) {
    await query(
      `UPDATE partner_codes
       SET uses_count = uses_count + 1
       WHERE code = $1 AND is_active = true`,
      [partnerCode.toUpperCase()],
    );
  }

  await createAuditLog({
    organizationId: orgId,
    actorType:      'system',
    action:         'org.referral_tracked',
    resourceType:   'organization',
    resourceId:     orgId,
    metadata:       { referralSource, partnerCode, trialDays },
  });
}
