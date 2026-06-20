/**
 * memberSubscription.service — MANUAL-mode memberships (v2.1).
 *
 * The owner RECORDS an existing membership (e.g. one migrated from Mindbody) and its
 * entitlements; Taproot tracks access state but does NOT charge. `managed_externally`
 * defaults true to make that explicit. Taproot-native recurring billing (charging,
 * dunning, gateway_ref, proration) is v2.5 — deliberately absent here.
 *
 * GRACEFUL: guards the member_subscriptions table (to_regclass), safe pre-migration.
 */
import { query } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { MemberSubscription, MemberSubscriptionState } from '@taproot/shared';

const STATES: MemberSubscriptionState[] = ['active', 'frozen', 'cancelled'];

export interface RecordSubscriptionInput {
  catalogItemId?: string | null;
  state?: MemberSubscriptionState;
  notes?: string;
  currentPeriodEnd?: string | null;
}
export type UpdateSubscriptionInput = Partial<RecordSubscriptionInput>;

let _subsReady: boolean | null = null;
async function subsReady(): Promise<boolean> {
  if (_subsReady !== null) return _subsReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.member_subscriptions') IS NOT NULL AS ready`,
    );
    _subsReady = Boolean(rows[0]?.ready);
  } catch {
    _subsReady = false;
  }
  return _subsReady;
}

function assertState(s: string): asserts s is MemberSubscriptionState {
  if (!STATES.includes(s as MemberSubscriptionState)) throw new ValidationError(`Invalid subscription state: ${s}`);
}

/** Record a manually-managed membership for a member (v2.1: Taproot does NOT charge). */
export async function recordSubscription(
  orgId: string, employeeId: string, memberId: string, input: RecordSubscriptionInput,
): Promise<MemberSubscription> {
  if (!(await subsReady())) throw new ValidationError('Subscriptions not provisioned yet (migration 033 pending)');
  if (input.state !== undefined) assertState(input.state);
  const { rows: [s] } = await query<MemberSubscription>(
    `INSERT INTO member_subscriptions
       (organization_id, member_id, catalog_item_id, state, managed_externally, notes, current_period_end)
     VALUES ($1,$2,$3,$4,true,$5,$6)
     RETURNING *`,
    [orgId, memberId, input.catalogItemId ?? null, input.state ?? 'active',
      input.notes ?? null, input.currentPeriodEnd ?? null],
  );
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.subscription_recorded', resourceType: 'member', resourceId: memberId,
    afterState: { subscriptionId: s.id, state: s.state },
  });
  return s;
}

export async function listSubscriptions(orgId: string, memberId: string): Promise<MemberSubscription[]> {
  if (!(await subsReady())) return [];
  const { rows } = await query<MemberSubscription>(
    `SELECT * FROM member_subscriptions
      WHERE organization_id = $1 AND member_id = $2 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [orgId, memberId],
  );
  return rows;
}

export async function updateSubscription(
  orgId: string, subscriptionId: string, employeeId: string, input: UpdateSubscriptionInput,
): Promise<MemberSubscription> {
  if (!(await subsReady())) throw new NotFoundError('Subscription');
  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown): void => { sets.push(`${col} = $${p++}`); params.push(val); };
  if (input.state !== undefined) { assertState(input.state); add('state', input.state); }
  if ('catalogItemId' in input) add('catalog_item_id', input.catalogItemId ?? null);
  if (input.notes !== undefined) add('notes', input.notes);
  if ('currentPeriodEnd' in input) add('current_period_end', input.currentPeriodEnd ?? null);
  if (!sets.length) {
    const { rows: [s] } = await query<MemberSubscription>(
      `SELECT * FROM member_subscriptions WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [subscriptionId, orgId],
    );
    if (!s) throw new NotFoundError('Subscription');
    return s;
  }
  params.push(subscriptionId, orgId);
  const { rows: [s] } = await query<MemberSubscription>(
    `UPDATE member_subscriptions SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${p} AND organization_id = $${p + 1} AND deleted_at IS NULL
      RETURNING *`,
    params,
  );
  if (!s) throw new NotFoundError('Subscription');
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.subscription_updated', resourceType: 'member', resourceId: s.member_id,
    afterState: { subscriptionId: s.id, state: s.state },
  });
  return s;
}

/** Cancel = set state cancelled (kept for history). */
export async function cancelSubscription(orgId: string, subscriptionId: string, employeeId: string): Promise<MemberSubscription> {
  return updateSubscription(orgId, subscriptionId, employeeId, { state: 'cancelled' });
}
