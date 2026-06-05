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

export interface TableStatus extends TableRow {
  currentOrder: {
    id: string; orderNumber: string; status: string;
    itemCount: number; total: number; openedAt: string; minutesOpen: number;
  } | null;
}

export async function getTableStatus(orgId: string, locationId: string): Promise<TableStatus[]> {
  const { rows } = await query<TableStatus & {
    order_id: string | null; order_number: string | null; order_status: string | null;
    item_count: number | null; order_total: number | null; opened_at: string | null;
  }>(
    `SELECT t.id, t.location_id, t.name, t.section, t.seats, t.position_x, t.position_y,
            t.shape, t.width, t.height, t.is_active,
            o.id AS order_id, o.order_number, o.status AS order_status, o.total AS order_total,
            o.created_at AS opened_at,
            (SELECT COUNT(*)::int FROM order_line_items oli WHERE oli.order_id = o.id AND oli.voided_at IS NULL) AS item_count
       FROM tables t
       LEFT JOIN LATERAL (
         SELECT * FROM orders o2
          WHERE o2.table_id = t.id AND o2.status IN ('open','in_progress')
          ORDER BY o2.created_at DESC LIMIT 1
       ) o ON true
      WHERE t.organization_id = $1 AND t.location_id = $2 AND t.deleted_at IS NULL
      ORDER BY t.name ASC`,
    [orgId, locationId],
  );

  return rows.map((r) => ({
    id: r.id, location_id: r.location_id, name: r.name, section: r.section, seats: r.seats,
    position_x: r.position_x, position_y: r.position_y, shape: r.shape, width: r.width, height: r.height, is_active: r.is_active,
    currentOrder: r.order_id ? {
      id: r.order_id, orderNumber: r.order_number ?? '', status: r.order_status ?? 'open',
      itemCount: Number(r.item_count ?? 0), total: Number(r.order_total ?? 0),
      openedAt: r.opened_at ?? '',
      minutesOpen: r.opened_at ? Math.max(0, Math.floor((Date.now() - new Date(r.opened_at).getTime()) / 60000)) : 0,
    } : null,
  }));
}

export async function assignOrderToTable(orgId: string, orderId: string, tableId: string | null): Promise<void> {
  const { rows: [order] } = await query<{ id: string }>(
    `SELECT id FROM orders WHERE id = $1 AND organization_id = $2`, [orderId, orgId]);
  if (!order) throw new NotFoundError('Order not found');
  if (tableId) {
    const { rows: [t] } = await query<{ id: string }>(
      `SELECT id FROM tables WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [tableId, orgId]);
    if (!t) throw new ValidationError('Table not found');
  }
  await query(`UPDATE orders SET table_id = $1, updated_at = now() WHERE id = $2`, [tableId, orderId]);
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
