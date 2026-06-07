/**
 * API key service (S8-04) — public API bearer keys.
 *
 * Key format:  taproot_live_<32 url-safe chars>
 * Storage:     SHA-256 hex of the full key (key_hash, unique-indexed) +
 *              display prefix. The full key is returned ONCE at creation.
 * Auth:        auth/middleware.ts routes Bearer taproot_live_* tokens here;
 *              resolveApiKey() returns a synthetic AccessTokenPayload whose
 *              permissions come from the key's scopes (SCOPE_MAP below).
 *
 * RESILIENCE: api_keys lands in migration 018 — every entry point checks the
 * table exists (cached) and degrades gracefully until Jake runs it.
 */

import { createHash, randomBytes } from 'crypto';
import { query } from '../db/client';
import { NotFoundError, ValidationError } from '../errors';
import type { AccessTokenPayload } from '../auth/jwt';
import type { EmployeeRole } from '@taproot/shared';

export const API_KEY_PREFIX = 'taproot_live_';

const MIGRATION_MSG = 'API keys require migration 018 — ask your administrator to run pending migrations.';

// ─── Migration-pending resilience ─────────────────────────────────────────────

let _ready: boolean | null = null;

async function apiKeysReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'api_keys'
     ) AS ready`,
  );
  _ready = Boolean(rows[0]?.ready);
  return _ready;
}

// ─── Scopes ───────────────────────────────────────────────────────────────────

export const API_SCOPES = [
  'orders:read', 'orders:write',
  'products:read', 'products:write',
  'customers:read', 'customers:write',
  'reports:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Map public API scopes → internal Permission strings (auth/permissions.ts). */
const SCOPE_MAP: Record<ApiScope, string[]> = {
  'orders:read':     ['order:view', 'order:view:all'],
  'orders:write':    ['order:view', 'order:view:all', 'order:create'],
  'products:read':   ['product:view', 'inventory:view'],
  'products:write':  ['product:view', 'product:create', 'product:edit'],
  'customers:read':  ['customer:view'],
  'customers:write': ['customer:view', 'customer:create', 'customer:edit'],
  'reports:read':    ['report:view', 'report:view:basic', 'report:view:advanced', 'report:export'],
};

function scopesToPermissions(scopes: string[]): string[] {
  const perms = new Set<string>();
  for (const s of scopes) {
    for (const p of SCOPE_MAP[s as ApiScope] ?? []) perms.add(p);
  }
  return Array.from(perms);
}

// ─── Key generation / hashing ─────────────────────────────────────────────────

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString('base64url').slice(0, 32);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function listApiKeys(orgId: string): Promise<ApiKeyRow[]> {
  if (!(await apiKeysReady())) return [];
  const { rows } = await query<ApiKeyRow>(
    `SELECT id, name, key_prefix, permissions, last_used_at, expires_at, created_at, revoked_at
       FROM api_keys
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [orgId],
  );
  return rows;
}

export async function createApiKey(
  orgId: string,
  employeeId: string,
  data: { name: string; permissions: string[]; expiresAt?: string | null },
): Promise<{ id: string; key: string; prefix: string; name: string }> {
  if (!(await apiKeysReady())) throw new ValidationError(MIGRATION_MSG);
  if (!data.name?.trim()) throw new ValidationError('Key name is required');

  const scopes = (data.permissions ?? []).filter((p): p is ApiScope =>
    (API_SCOPES as readonly string[]).includes(p));
  if (!scopes.length) throw new ValidationError('At least one permission scope is required');

  const key = generateKey();
  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO api_keys (organization_id, name, key_hash, key_prefix, permissions, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [orgId, data.name.trim(), hashKey(key), API_KEY_PREFIX, scopes, data.expiresAt ?? null, employeeId],
  );

  return { id: row.id, key, prefix: API_KEY_PREFIX, name: data.name.trim() };
}

export async function revokeApiKey(orgId: string, keyId: string): Promise<void> {
  if (!(await apiKeysReady())) throw new ValidationError(MIGRATION_MSG);
  const { rowCount } = await query(
    `UPDATE api_keys SET revoked_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
    [keyId, orgId],
  );
  if (!rowCount) throw new NotFoundError('API key not found (or already revoked)');
}

// ─── Auth resolution (called from auth/middleware.ts) ─────────────────────────

/**
 * Validate a full bearer key. Returns a synthetic AccessTokenPayload (role
 * 'readonly' — API keys never pass owner/manager role checks; capability
 * comes from scoped permissions) or null when invalid/revoked/expired.
 */
export async function resolveApiKey(token: string): Promise<AccessTokenPayload | null> {
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  if (!(await apiKeysReady())) return null;

  const { rows: [row] } = await query<{
    id: string; organization_id: string; permissions: string[];
    expires_at: string | null; revoked_at: string | null;
  }>(
    `SELECT id, organization_id, permissions, expires_at, revoked_at
       FROM api_keys
      WHERE key_hash = $1`,
    [hashKey(token)],
  );

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

  // Fire-and-forget usage stamp
  void query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
    .catch(() => { /* non-fatal */ });

  const nowSec = Math.floor(Date.now() / 1000);
  return {
    sub: `apikey:${row.id}`,
    orgId: row.organization_id,
    locationIds: [],                     // [] = all locations
    role: 'readonly' as EmployeeRole,    // role checks fail closed; scopes grant access
    permissions: scopesToPermissions(row.permissions ?? []),
    sessionId: `apikey:${row.id}`,
    iat: nowSec,
    exp: nowSec + 60,
  };
}
