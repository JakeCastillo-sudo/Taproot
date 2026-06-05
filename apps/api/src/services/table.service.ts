import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError } from '../errors';

export type TableShape = 'rectangle' | 'circle' | 'square';

export interface TableRow {
  id: string; location_id: string; name: string; section: string | null;
  seats: number; position_x: number; position_y: number;
  shape: TableShape; width: number; height: number; is_active: boolean;
}

export interface CreateTableData {
  name: string; section?: string | null; seats?: number;
  positionX?: number; positionY?: number; shape?: TableShape;
  width?: number; height?: number;
}

export interface UpdateTableData {
  name?: string; section?: string | null; seats?: number;
  positionX?: number; positionY?: number; shape?: TableShape;
  width?: number; height?: number; isActive?: boolean;
}

const SHAPES: TableShape[] = ['rectangle', 'circle', 'square'];

export async function listTables(orgId: string, locationId: string): Promise<TableRow[]> {
  const { rows } = await query<TableRow>(
    `SELECT id, location_id, name, section, seats, position_x, position_y, shape, width, height, is_active
       FROM tables
      WHERE organization_id = $1 AND location_id = $2 AND deleted_at IS NULL
      ORDER BY name ASC`,
    [orgId, locationId],
  );
  return rows;
}

export async function createTable(
  orgId: string, locationId: string, data: CreateTableData, employeeId: string,
): Promise<TableRow> {
  if (!data.name?.trim()) throw new ValidationError('Table name is required');
  const shape = data.shape && SHAPES.includes(data.shape) ? data.shape : 'rectangle';
  const { rows: [row] } = await query<TableRow>(
    `INSERT INTO tables (organization_id, location_id, name, section, seats, position_x, position_y, shape, width, height)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, location_id, name, section, seats, position_x, position_y, shape, width, height, is_active`,
    [
      orgId, locationId, data.name.trim(), data.section ?? null, data.seats ?? 2,
      data.positionX ?? 20, data.positionY ?? 20, shape, data.width ?? 80, data.height ?? 80,
    ],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'table.create', resourceType: 'table', resourceId: row.id });
  return row;
}

export async function updateTable(
  orgId: string, tableId: string, data: UpdateTableData, employeeId: string,
): Promise<TableRow> {
  const { rows: [existing] } = await query<{ id: string }>(
    `SELECT id FROM tables WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [tableId, orgId],
  );
  if (!existing) throw new NotFoundError('Table not found');

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if ('section' in data) add('section', data.section);
  if (data.seats !== undefined) add('seats', data.seats);
  if (data.positionX !== undefined) add('position_x', data.positionX);
  if (data.positionY !== undefined) add('position_y', data.positionY);
  if (data.shape !== undefined && SHAPES.includes(data.shape)) add('shape', data.shape);
  if (data.width !== undefined) add('width', data.width);
  if (data.height !== undefined) add('height', data.height);
  if (data.isActive !== undefined) add('is_active', data.isActive);

  if (sets.length === 0) {
    const { rows: [row] } = await query<TableRow>(
      `SELECT id, location_id, name, section, seats, position_x, position_y, shape, width, height, is_active FROM tables WHERE id = $1`, [tableId]);
    return row;
  }
  sets.push('updated_at = now()');
  params.push(tableId, orgId);
  const { rows: [row] } = await query<TableRow>(
    `UPDATE tables SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}
     RETURNING id, location_id, name, section, seats, position_x, position_y, shape, width, height, is_active`,
    params,
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'table.update', resourceType: 'table', resourceId: tableId });
  return row;
}

export async function deleteTable(orgId: string, tableId: string, employeeId: string): Promise<void> {
  const { rows: [existing] } = await query<{ id: string }>(
    `SELECT id FROM tables WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [tableId, orgId],
  );
  if (!existing) throw new NotFoundError('Table not found');
  await query(`UPDATE tables SET deleted_at = now(), updated_at = now() WHERE id = $1`, [tableId]);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'table.delete', resourceType: 'table', resourceId: tableId });
}

export async function bulkUpdatePositions(
  orgId: string,
  positions: Array<{ id: string; positionX: number; positionY: number; width?: number; height?: number }>,
): Promise<void> {
  for (const pos of positions) {
    const sets = ['position_x = $3', 'position_y = $4', 'updated_at = now()'];
    const params: unknown[] = [pos.id, orgId, pos.positionX, pos.positionY];
    if (pos.width !== undefined) { sets.push(`width = $${params.length + 1}`); params.push(pos.width); }
    if (pos.height !== undefined) { sets.push(`height = $${params.length + 1}`); params.push(pos.height); }
    await query(
      `UPDATE tables SET ${sets.join(', ')} WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      params,
    );
  }
}
