/**
 * member.service — studio member identity (v2.1). Members EXTEND customers: a
 * member MAY link to a customer_id for unified retail+class identity, or stand
 * alone. Mirrors customer.service conventions (orgId+id+employeeId+input args,
 * org-scoped queries, soft-delete via deleted_at, raw snake_case row returns).
 *
 * GRACEFUL: every entry point guards `members` table existence (to_regclass) so the
 * branch is safe BEFORE migration 033 runs — reads return empty, writes reject
 * cleanly. Studio-gating (capabilities.studio) is enforced at the route layer.
 */
import { query } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import type { Member, MemberStatus } from '@taproot/shared';

const MEMBER_STATUSES: MemberStatus[] = ['prospect', 'active', 'frozen', 'cancelled', 'lead'];

export interface CreateMemberInput {
  displayName?: string;
  email?: string;
  phone?: string;
  status?: MemberStatus;
  customerId?: string | null;
  homeLocationId?: string | null;
  tags?: string[];
}
export type UpdateMemberInput = Partial<CreateMemberInput> & {
  waiverSignedAt?: string | null;
  waiverDocId?: string | null;
};

export interface ListMembersParams {
  search?: string;
  status?: MemberStatus;
  page?: number;
  perPage?: number;
}
export interface MemberListResult { members: Member[]; total: number; page: number; perPage: number }

// ── Graceful table guard (cached positive, mirrors ingredientSystemReady) ──
let _membersReady: boolean | null = null;
async function membersReady(): Promise<boolean> {
  if (_membersReady !== null) return _membersReady;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.members') IS NOT NULL AS ready`,
    );
    _membersReady = Boolean(rows[0]?.ready);
  } catch {
    _membersReady = false;
  }
  return _membersReady;
}

function assertStatus(s: string): asserts s is MemberStatus {
  if (!MEMBER_STATUSES.includes(s as MemberStatus)) {
    throw new ValidationError(`Invalid member status: ${s}`);
  }
}

const NOT_PROVISIONED = 'Member system not provisioned yet (migration 033 pending)';

export async function createMember(orgId: string, employeeId: string, input: CreateMemberInput): Promise<Member> {
  if (!(await membersReady())) throw new ValidationError(NOT_PROVISIONED);
  if (!input.displayName && !input.email && !input.phone) {
    throw new ValidationError('Provide a name, email, or phone');
  }
  if (input.status !== undefined) assertStatus(input.status);

  const { rows: [m] } = await query<Member>(
    `INSERT INTO members
       (organization_id, customer_id, display_name, email, phone, status, home_location_id, tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      orgId,
      input.customerId ?? null,
      input.displayName ?? null,
      input.email ? input.email.toLowerCase() : null,
      input.phone ?? null,
      input.status ?? 'prospect',
      input.homeLocationId ?? null,
      input.tags ?? null,
    ],
  );
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.created', resourceType: 'member', resourceId: m.id,
  });
  return m;
}

export async function getMember(orgId: string, memberId: string): Promise<Member> {
  if (!(await membersReady())) throw new NotFoundError('Member');
  const { rows: [m] } = await query<Member>(
    `SELECT * FROM members WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [memberId, orgId],
  );
  if (!m) throw new NotFoundError('Member');
  return m;
}

export async function updateMember(
  orgId: string, memberId: string, employeeId: string, input: UpdateMemberInput,
): Promise<Member> {
  if (!(await membersReady())) throw new NotFoundError('Member');
  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown): void => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (input.displayName !== undefined) add('display_name', input.displayName);
  if (input.email !== undefined) add('email', input.email ? input.email.toLowerCase() : null);
  if (input.phone !== undefined) add('phone', input.phone);
  if (input.status !== undefined) { assertStatus(input.status); add('status', input.status); }
  if ('customerId' in input) add('customer_id', input.customerId ?? null);
  if ('homeLocationId' in input) add('home_location_id', input.homeLocationId ?? null);
  if (input.tags !== undefined) add('tags', input.tags ?? null);
  if ('waiverSignedAt' in input) add('waiver_signed_at', input.waiverSignedAt ?? null);
  if ('waiverDocId' in input) add('waiver_doc_id', input.waiverDocId ?? null);

  if (!sets.length) return getMember(orgId, memberId);

  params.push(memberId, orgId);
  const { rows: [m] } = await query<Member>(
    `UPDATE members SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${p} AND organization_id = $${p + 1} AND deleted_at IS NULL
      RETURNING *`,
    params,
  );
  if (!m) throw new NotFoundError('Member');
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.updated', resourceType: 'member', resourceId: m.id,
  });
  return m;
}

export async function deleteMember(orgId: string, memberId: string, employeeId: string): Promise<void> {
  if (!(await membersReady())) return;
  await query(
    `UPDATE members SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [memberId, orgId],
  );
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.deleted', resourceType: 'member', resourceId: memberId,
  });
}

/** Sign (or re-record) the member's waiver — sets waiver_signed_at = now(). */
export async function signWaiver(
  orgId: string, memberId: string, employeeId: string, waiverDocId?: string | null,
): Promise<Member> {
  if (!(await membersReady())) throw new NotFoundError('Member');
  const { rows: [m] } = await query<Member>(
    `UPDATE members SET waiver_signed_at = now(), waiver_doc_id = $3, updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
      RETURNING *`,
    [memberId, orgId, waiverDocId ?? null],
  );
  if (!m) throw new NotFoundError('Member');
  void createAuditLog({
    organizationId: orgId, actorId: employeeId,
    action: 'member.waiver_signed', resourceType: 'member', resourceId: m.id,
  });
  return m;
}

export async function listMembers(orgId: string, params: ListMembersParams = {}): Promise<MemberListResult> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(200, Math.max(1, params.perPage ?? 50));
  const offset = (page - 1) * perPage;
  if (!(await membersReady())) return { members: [], total: 0, page, perPage };

  const conditions: string[] = ['organization_id = $1', 'deleted_at IS NULL'];
  const bindings: unknown[] = [orgId];
  if (params.search) {
    bindings.push(`%${params.search}%`);
    const n = bindings.length;
    conditions.push(`(display_name ILIKE $${n} OR email ILIKE $${n} OR phone ILIKE $${n})`);
  }
  if (params.status) {
    assertStatus(params.status);
    bindings.push(params.status);
    conditions.push(`status = $${bindings.length}`);
  }
  const where = conditions.join(' AND ');

  const { rows: countRows } = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM members WHERE ${where}`, bindings,
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  bindings.push(perPage, offset);
  const { rows: members } = await query<Member>(
    `SELECT * FROM members WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${bindings.length - 1} OFFSET $${bindings.length}`,
    bindings,
  );
  return { members, total, page, perPage };
}
