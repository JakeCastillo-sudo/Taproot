import { query, withTransaction } from '../db/client';
import { hashPin, hashPassword, generateSecureToken } from '../auth/crypto';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError, ConflictError } from '../errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmployeeRole = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'readonly';
const VALID_ROLES: EmployeeRole[] = ['owner', 'manager', 'cashier', 'kitchen', 'readonly'];

export interface EmployeeListRow {
  id:            string;
  first_name:    string;
  last_name:     string;
  email:         string;
  role:          EmployeeRole;
  location_ids:  string[] | null;
  hourly_rate:   number | null;
  has_pin:       boolean;
  last_login_at: string | null;
  created_at:    string;
}

export interface CreateEmployeeData {
  firstName:   string;
  lastName:    string;
  email:       string;
  role:        EmployeeRole;
  pin?:        string;
  locationIds?: string[];
  hourlyRate?: number | null;
}

export interface UpdateEmployeeData {
  firstName?:   string;
  lastName?:    string;
  email?:       string;
  role?:        EmployeeRole;
  locationIds?: string[];
  hourlyRate?:  number | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function assertRole(role: string): asserts role is EmployeeRole {
  if (!VALID_ROLES.includes(role as EmployeeRole)) {
    throw new ValidationError(`Invalid role: ${role}`);
  }
}

function assertPin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new ValidationError('PIN must be 4–6 digits');
}

function toUuidArrayLiteral(ids: string[] | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  return `{${ids.join(',')}}`;
}

// ─── listEmployees ──────────────────────────────────────────────────────────

export async function listEmployees(orgId: string): Promise<EmployeeListRow[]> {
  const { rows } = await query<EmployeeListRow>(
    `SELECT id, first_name, last_name, email, role, location_ids, hourly_rate,
            (pin_hash IS NOT NULL) AS has_pin, last_login_at, created_at
       FROM employees
      WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY first_name ASC, last_name ASC`,
    [orgId],
  );
  return rows;
}

// ─── listSelectableEmployees ─────────────────────────────────────────────────
// Minimal, non-sensitive list for the POS PIN lock screen. Only PIN-enabled staff.

export interface SelectableEmployee {
  id:         string;
  first_name: string;
  last_name:  string;
  role:       EmployeeRole;
}

export async function listSelectableEmployees(orgId: string): Promise<SelectableEmployee[]> {
  const { rows } = await query<SelectableEmployee>(
    `SELECT id, first_name, last_name, role
       FROM employees
      WHERE organization_id = $1 AND deleted_at IS NULL AND pin_hash IS NOT NULL
      ORDER BY first_name ASC, last_name ASC`,
    [orgId],
  );
  return rows;
}

// ─── createEmployee ─────────────────────────────────────────────────────────

export async function createEmployee(
  orgId: string, data: CreateEmployeeData, creatorId: string,
): Promise<{ id: string }> {
  if (!data.firstName?.trim() || !data.lastName?.trim()) throw new ValidationError('First and last name are required');
  if (!data.email?.trim()) throw new ValidationError('Email is required');
  assertRole(data.role);
  if (data.pin) assertPin(data.pin);

  // Unique email per org
  const { rows: existing } = await query(
    `SELECT id FROM employees WHERE organization_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
    [orgId, data.email.trim()],
  );
  if (existing.length) throw new ConflictError('An employee with that email already exists');

  // Every employee row needs a password_hash (NOT NULL). PIN-only staff get a
  // random unusable password until an owner sets one via password reset.
  const passwordHash = await hashPassword(generateSecureToken(24));
  const pinHash = data.pin ? await hashPin(data.pin) : null;

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO employees
       (organization_id, email, password_hash, first_name, last_name, role,
        pin_hash, location_ids, hourly_rate, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      orgId, data.email.trim(), passwordHash,
      data.firstName.trim(), data.lastName.trim(), data.role,
      pinHash, toUuidArrayLiteral(data.locationIds),
      data.hourlyRate ?? null, creatorId,
    ],
  );

  void createAuditLog({ organizationId: orgId, actorId: creatorId, action: 'employee.create', resourceType: 'employee', resourceId: row.id });
  return row;
}

// ─── updateEmployee ─────────────────────────────────────────────────────────

export async function updateEmployee(
  orgId: string, employeeId: string, data: UpdateEmployeeData, actorId: string,
): Promise<void> {
  const { rows: [emp] } = await query<{ id: string }>(
    `SELECT id FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [employeeId, orgId],
  );
  if (!emp) throw new NotFoundError('Employee not found');
  if (data.role !== undefined) assertRole(data.role);

  if (data.email) {
    const { rows: dup } = await query(
      `SELECT id FROM employees WHERE organization_id = $1 AND lower(email) = lower($2)
         AND id <> $3 AND deleted_at IS NULL`,
      [orgId, data.email.trim(), employeeId],
    );
    if (dup.length) throw new ConflictError('An employee with that email already exists');
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.firstName !== undefined) add('first_name', data.firstName.trim());
  if (data.lastName !== undefined) add('last_name', data.lastName.trim());
  if (data.email !== undefined) add('email', data.email.trim());
  if (data.role !== undefined) add('role', data.role);
  if (data.locationIds !== undefined) add('location_ids', toUuidArrayLiteral(data.locationIds));
  if ('hourlyRate' in data) add('hourly_rate', data.hourlyRate ?? null);

  if (sets.length === 0) return;
  sets.push('updated_at = now()');
  params.push(employeeId, orgId);
  await query(`UPDATE employees SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`, params);
  void createAuditLog({ organizationId: orgId, actorId, action: 'employee.update', resourceType: 'employee', resourceId: employeeId });
}

// ─── deleteEmployee ─────────────────────────────────────────────────────────

export async function deleteEmployee(
  orgId: string, employeeId: string, actorId: string,
): Promise<void> {
  if (employeeId === actorId) throw new ValidationError('You cannot deactivate your own account');
  const { rows: [emp] } = await query<{ id: string; role: string }>(
    `SELECT id, role FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [employeeId, orgId],
  );
  if (!emp) throw new NotFoundError('Employee not found');

  // Don't allow removing the last owner
  if (emp.role === 'owner') {
    const { rows: owners } = await query<{ count: string }>(
      `SELECT COUNT(*) FROM employees WHERE organization_id = $1 AND role = 'owner' AND deleted_at IS NULL`,
      [orgId],
    );
    if (parseInt(owners[0]?.count ?? '0', 10) <= 1) throw new ValidationError('Cannot deactivate the last owner');
  }

  await withTransaction(async (client) => {
    await client.query(`UPDATE employees SET deleted_at = now(), updated_at = now() WHERE id = $1`, [employeeId]);
    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE employee_id = $1 AND revoked_at IS NULL`, [employeeId]);
  });
  void createAuditLog({ organizationId: orgId, actorId, action: 'employee.delete', resourceType: 'employee', resourceId: employeeId });
}

// ─── resetPin ───────────────────────────────────────────────────────────────

export async function resetPin(
  orgId: string, employeeId: string, newPin: string, actorId: string,
): Promise<void> {
  assertPin(newPin);
  const { rows: [emp] } = await query<{ id: string }>(
    `SELECT id FROM employees WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [employeeId, orgId],
  );
  if (!emp) throw new NotFoundError('Employee not found');

  const pinHash = await hashPin(newPin);
  await query(`UPDATE employees SET pin_hash = $1, updated_at = now() WHERE id = $2`, [pinHash, employeeId]);
  void createAuditLog({ organizationId: orgId, actorId, action: 'employee.reset_pin', resourceType: 'employee', resourceId: employeeId });
}
