import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError } from '../errors';

export interface LocationRow {
  id: string; name: string; address: Record<string, unknown>; phone: string | null;
  timezone: string; currency: string; is_active: boolean;
}

export interface CreateLocationData {
  name: string; address?: Record<string, unknown>; phone?: string;
  timezone?: string; currency?: string;
  taxConfig?: Record<string, unknown>; receiptConfig?: Record<string, unknown>;
}

export interface UpdateLocationData {
  name?: string; address?: Record<string, unknown>; phone?: string;
  timezone?: string; currency?: string; isActive?: boolean;
}

export async function listLocations(orgId: string): Promise<LocationRow[]> {
  const { rows } = await query<LocationRow>(
    `SELECT id, name, address, phone, timezone, currency, is_active
       FROM locations WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [orgId],
  );
  return rows;
}

export async function createLocation(orgId: string, data: CreateLocationData, employeeId: string): Promise<LocationRow> {
  if (!data.name?.trim()) throw new ValidationError('Location name is required');

  const row = await withTransaction(async (client) => {
    const { rows: [loc] } = await client.query<LocationRow>(
      `INSERT INTO locations (organization_id, name, address, phone, timezone, currency, tax_config, receipt_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, address, phone, timezone, currency, is_active`,
      [
        orgId, data.name.trim(), JSON.stringify(data.address ?? {}), data.phone ?? null,
        data.timezone ?? 'America/New_York', data.currency ?? 'USD',
        JSON.stringify(data.taxConfig ?? {}), JSON.stringify(data.receiptConfig ?? {}), employeeId,
      ],
    );
    // Grant access to owners/managers (append to their location_ids, unless they already have all-access []).
    await client.query(
      `UPDATE employees
          SET location_ids = (
            SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(location_ids, ARRAY[]::uuid[]) || $2::uuid))
          ), updated_at = now()
        WHERE organization_id = $1 AND deleted_at IS NULL
          AND role IN ('owner','manager')
          AND location_ids IS NOT NULL AND array_length(location_ids, 1) > 0`,
      [orgId, loc.id],
    );
    return loc;
  });

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'location.create', resourceType: 'location', resourceId: row.id });
  return row;
}

export async function updateLocation(orgId: string, id: string, data: UpdateLocationData, employeeId: string): Promise<LocationRow> {
  const { rows: [exists] } = await query<{ id: string }>(
    `SELECT id FROM locations WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [id, orgId]);
  if (!exists) throw new NotFoundError('Location not found');

  const sets: string[] = []; const params: unknown[] = []; let p = 1;
  const add = (c: string, v: unknown) => { sets.push(`${c} = $${p++}`); params.push(v); };
  if (data.name !== undefined) add('name', data.name.trim());
  if (data.address !== undefined) add('address', JSON.stringify(data.address));
  if (data.phone !== undefined) add('phone', data.phone);
  if (data.timezone !== undefined) add('timezone', data.timezone);
  if (data.currency !== undefined) add('currency', data.currency);
  if (data.isActive !== undefined) add('is_active', data.isActive);
  if (sets.length === 0) {
    const { rows: [row] } = await query<LocationRow>(`SELECT id, name, address, phone, timezone, currency, is_active FROM locations WHERE id = $1`, [id]);
    return row;
  }
  sets.push('updated_at = now()'); params.push(id, orgId);
  const { rows: [row] } = await query<LocationRow>(
    `UPDATE locations SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}
     RETURNING id, name, address, phone, timezone, currency, is_active`, params);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'location.update', resourceType: 'location', resourceId: id });
  return row;
}

export async function deleteLocation(orgId: string, id: string, employeeId: string): Promise<void> {
  // Don't delete the last location
  const { rows: locs } = await query<{ count: string }>(
    `SELECT COUNT(*) FROM locations WHERE organization_id = $1 AND deleted_at IS NULL`, [orgId]);
  if (parseInt(locs[0]?.count ?? '0', 10) <= 1) throw new ValidationError('Cannot delete the only location');

  const rowCount = await withTransaction(async (client) => {
    const { rowCount: rc } = await client.query(
      `UPDATE locations SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, orgId]);
    if (!rc) return 0;
    // BUG-LOC-002: strip the deleted location from every employee's location_ids so stale
    // (deleted) ids never end up in a JWT or drive queries against a removed location.
    await client.query(
      `UPDATE employees
          SET location_ids = array_remove(location_ids, $2::uuid), updated_at = now()
        WHERE organization_id = $1 AND location_ids IS NOT NULL AND $2::uuid = ANY(location_ids)`,
      [orgId, id]);
    return rc;
  });

  if (!rowCount) throw new NotFoundError('Location not found');
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'location.delete', resourceType: 'location', resourceId: id });
}
