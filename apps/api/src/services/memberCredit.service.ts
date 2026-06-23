/**
 * memberCredit.service — the class-pack credit ledger (v2.1).
 *
 * Credits are integer COUNTS (not money). Buying a class_pack grants a member_credits
 * row; using a class burns one credit down.
 *
 * SAFETY — mirrors the hardened payment patterns:
 *  - deductCredit is ATOMIC like WG-006: a row is locked FOR UPDATE and decremented
 *    with a `credits_remaining >= $n` guard, so concurrent deducts can NEVER drive a
 *    balance negative (0 affected rows ⇒ insufficient). The DB CHECK is a backstop.
 *  - grantCredits is IDEMPOTENT like WG-012 when given a sourceRef (e.g. an order id):
 *    ON CONFLICT (organization_id, source_ref) DO NOTHING means a retried
 *    grant-on-checkout never double-credits.
 *
 * GRACEFUL: guards the member_credits table (to_regclass) so it's safe pre-migration.
 */
import type { QueryResult, QueryResultRow } from 'pg';
import { query, withTransaction } from '../db/client';
import { ValidationError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { MemberCredit } from '@taproot/shared';

// A minimal query runner — satisfied by both the pool (`query`) and a `PoolClient`.
// Lets deduct/restore COMPOSE into a caller's transaction (e.g. booking) so the credit
// move and the booking insert commit atomically, without duplicating credit math.
interface Runner {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface GrantCreditsInput {
  memberId: string;
  count: number;
  creditType?: string;
  sourceCatalogItemId?: string | null;
  /** Idempotency anchor (e.g. order id). When set, a repeat grant is a no-op. */
  sourceRef?: string | null;
  expiresAt?: string | null;
}

let _creditsReady: boolean | null = null;
async function creditsReady(): Promise<boolean> {
  if (_creditsReady !== null) return _creditsReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.member_credits') IS NOT NULL AS ready`,
    );
    _creditsReady = Boolean(rows[0]?.ready);
  } catch {
    _creditsReady = false;
  }
  return _creditsReady;
}

/** Grant a pack of credits to a member. Idempotent when sourceRef is supplied. */
export async function grantCredits(orgId: string, employeeId: string, input: GrantCreditsInput): Promise<MemberCredit | null> {
  if (!(await creditsReady())) throw new ValidationError('Credit ledger not provisioned yet (migration 033 pending)');
  if (!Number.isInteger(input.count) || input.count <= 0) {
    throw new ValidationError('Credit count must be a positive integer');
  }

  const { rows } = await query<MemberCredit>(
    `INSERT INTO member_credits
       (organization_id, member_id, credit_type, source_catalog_item_id, source_ref,
        credits_total, credits_remaining, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7)
     ON CONFLICT (organization_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      orgId, input.memberId, input.creditType ?? 'class_pack',
      input.sourceCatalogItemId ?? null, input.sourceRef ?? null,
      input.count, input.expiresAt ?? null,
    ],
  );
  // 0 rows ⇒ idempotent no-op (this sourceRef was already granted). Not an error.
  const granted = rows[0] ?? null;
  if (granted) {
    void createAuditLog({
      organizationId: orgId, actorId: employeeId,
      action: 'member.credits_granted', resourceType: 'member', resourceId: input.memberId,
      afterState: { count: input.count, creditType: granted.credit_type, sourceRef: input.sourceRef ?? null },
    });
  }
  return granted;
}

/**
 * Burn `count` credits from the member's oldest usable (non-expired) pack. ATOMIC:
 * the chosen row is locked FOR UPDATE and decremented under a `>= count` guard, so
 * the balance can never go negative even under concurrent deducts. Throws
 * ValidationError('Insufficient credits') when no single pack can cover `count`.
 */
export async function deductCredit(
  orgId: string, employeeId: string, memberId: string, count = 1, client?: Runner,
): Promise<{ creditId: string; remaining: number }> {
  if (!(await creditsReady())) throw new ValidationError('Credit ledger not provisioned yet (migration 033 pending)');
  if (!Number.isInteger(count) || count <= 0) throw new ValidationError('Deduct count must be a positive integer');
  // Compose into a caller's transaction when a client is passed; else own one.
  return client ? deductCore(client, orgId, employeeId, memberId, count)
                : withTransaction((c) => deductCore(c, orgId, employeeId, memberId, count));
}

async function deductCore(
  runner: Runner, orgId: string, employeeId: string, memberId: string, count: number,
): Promise<{ creditId: string; remaining: number }> {
  // Pick the oldest usable pack with enough remaining, locking it.
  const { rows: [pick] } = await runner.query<{ id: string }>(
    `SELECT id FROM member_credits
      WHERE organization_id = $1 AND member_id = $2
        AND credits_remaining >= $3
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [orgId, memberId, count],
  );
  if (!pick) throw new ValidationError('Insufficient credits');

  // WG-006-style conditional decrement (belt + suspenders under the row lock).
  const { rows: [upd] } = await runner.query<{ credits_remaining: number }>(
    `UPDATE member_credits
        SET credits_remaining = credits_remaining - $1, updated_at = now()
      WHERE id = $2 AND credits_remaining >= $1
      RETURNING credits_remaining`,
    [count, pick.id],
  );
  if (!upd) throw new ValidationError('Insufficient credits');

  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.credit_deducted', resourceType: 'member', resourceId: memberId,
    afterState: { creditId: pick.id, count, remaining: Number(upd.credits_remaining) },
  });
  return { creditId: pick.id, remaining: Number(upd.credits_remaining) };
}

/**
 * Restore `count` credits to a specific pack — the symmetric inverse of deductCredit,
 * used when a booking that spent a credit is cancelled before cutoff (v2.2) or its
 * session is cancelled. Bounded by `credits_remaining + count <= credits_total` (and
 * the DB CHECK), so a restore can never exceed what the pack originally held. Idempotent
 * at the math level: over-restoring is rejected (0 rows). Returns null if the pack is gone.
 */
export async function restoreCredit(
  orgId: string, employeeId: string, creditId: string, count = 1, client?: Runner,
): Promise<{ creditId: string; remaining: number } | null> {
  if (!(await creditsReady())) return null;
  if (!Number.isInteger(count) || count <= 0) throw new ValidationError('Restore count must be a positive integer');
  const runner: Runner = client ?? { query };
  const { rows: [upd] } = await runner.query<{ credits_remaining: number }>(
    `UPDATE member_credits
        SET credits_remaining = credits_remaining + $1, updated_at = now()
      WHERE id = $2 AND organization_id = $3 AND credits_remaining + $1 <= credits_total
      RETURNING credits_remaining`,
    [count, creditId, orgId],
  );
  if (!upd) return null; // pack gone or would exceed credits_total — nothing restored
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.credit_restored', resourceType: 'member_credit', resourceId: creditId,
    afterState: { count, remaining: Number(upd.credits_remaining) },
  });
  return { creditId, remaining: Number(upd.credits_remaining) };
}

/** Total usable (non-expired) credits + the per-pack breakdown. */
export async function getBalance(orgId: string, memberId: string): Promise<{ total: number; packs: MemberCredit[] }> {
  if (!(await creditsReady())) return { total: 0, packs: [] };
  const { rows } = await query<MemberCredit>(
    `SELECT * FROM member_credits
      WHERE organization_id = $1 AND member_id = $2
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at NULLS LAST, created_at ASC`,
    [orgId, memberId],
  );
  const total = rows.reduce((s, r) => s + Number(r.credits_remaining), 0);
  return { total, packs: rows };
}
