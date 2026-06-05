import { query, withTransaction } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError } from '../errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SelectionType = 'single' | 'multiple' | 'required_single' | 'required_multiple';

export interface ModifierData {
  id:         string;
  name:       string;
  priceDelta: number;  // cents
  isDefault:  boolean;
  sortOrder:  number;
}

export interface ModifierGroupFull {
  id:             string;
  name:           string;
  selectionType:  SelectionType;
  minSelections:  number;
  maxSelections:  number | null;
  sortOrder:      number;
  modifiers:      ModifierData[];
  productIds:     string[]; // products this group is assigned to
}

export interface CreateGroupData {
  name:           string;
  selectionType?: SelectionType;
  minSelections?: number;
  maxSelections?: number | null;
}

export interface UpdateGroupData {
  name?:          string;
  selectionType?: SelectionType;
  minSelections?: number;
  maxSelections?: number | null;
}

export interface CreateModifierData {
  name:       string;
  priceDelta?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateModifierData {
  name?:       string;
  priceDelta?: number;
  isDefault?:  boolean;
  sortOrder?:  number;
}

// ─── listModifierGroups ─────────────────────────────────────────────────────

export async function listModifierGroups(orgId: string): Promise<ModifierGroupFull[]> {
  const { rows } = await query<{
    id: string; name: string; selection_type: SelectionType;
    min_selections: number; max_selections: number | null; sort_order: number;
    modifiers: ModifierData[] | null;
    product_ids: string[] | null;
  }>(
    `SELECT
        mg.id, mg.name, mg.selection_type, mg.min_selections, mg.max_selections, mg.sort_order,
        COALESCE((
          SELECT JSON_AGG(JSON_BUILD_OBJECT(
            'id', m.id, 'name', m.name, 'priceDelta', m.price_delta,
            'isDefault', m.is_default, 'sortOrder', m.sort_order
          ) ORDER BY m.sort_order ASC)
          FROM modifiers m
          WHERE m.group_id = mg.id AND m.deleted_at IS NULL AND m.is_active = true
        ), '[]'::json) AS modifiers,
        COALESCE((
          SELECT JSON_AGG(pmg.product_id)
          FROM product_modifier_groups pmg
          JOIN products p ON p.id = pmg.product_id AND p.deleted_at IS NULL
          WHERE pmg.modifier_group_id = mg.id
        ), '[]'::json) AS product_ids
      FROM modifier_groups mg
      WHERE mg.organization_id = $1 AND mg.deleted_at IS NULL
      ORDER BY mg.sort_order ASC, mg.name ASC`,
    [orgId],
  );

  return rows.map((g) => ({
    id:            g.id,
    name:          g.name,
    selectionType: g.selection_type,
    minSelections: g.min_selections,
    maxSelections: g.max_selections,
    sortOrder:     g.sort_order,
    modifiers:     g.modifiers ?? [],
    productIds:    g.product_ids ?? [],
  }));
}

// ─── createModifierGroup ────────────────────────────────────────────────────

export async function createModifierGroup(
  orgId: string, data: CreateGroupData, employeeId: string,
): Promise<{ id: string }> {
  if (!data.name?.trim()) throw new ValidationError('Group name is required');
  const selectionType = data.selectionType ?? 'single';

  const { rows: [max] } = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM modifier_groups WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  const sortOrder = (max?.max ?? -1) + 1;

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO modifier_groups
       (organization_id, name, selection_type, min_selections, max_selections, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      orgId, data.name.trim(), selectionType,
      data.minSelections ?? 0, data.maxSelections ?? null, sortOrder, employeeId,
    ],
  );

  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier_group.create', resourceType: 'modifier_group', resourceId: row.id });
  return row;
}

// ─── updateModifierGroup ────────────────────────────────────────────────────

export async function updateModifierGroup(
  orgId: string, groupId: string, data: UpdateGroupData, employeeId: string,
): Promise<void> {
  await assertGroup(orgId, groupId);

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if (data.selectionType !== undefined) add('selection_type', data.selectionType);
  if (data.minSelections !== undefined) add('min_selections', data.minSelections);
  if ('maxSelections' in data) add('max_selections', data.maxSelections);

  if (sets.length === 0) return;
  sets.push('updated_at = now()');
  params.push(groupId, orgId);

  await query(
    `UPDATE modifier_groups SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`,
    params,
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier_group.update', resourceType: 'modifier_group', resourceId: groupId });
}

// ─── deleteModifierGroup ────────────────────────────────────────────────────

export async function deleteModifierGroup(
  orgId: string, groupId: string, employeeId: string,
): Promise<void> {
  await assertGroup(orgId, groupId);
  await withTransaction(async (client) => {
    await client.query(`UPDATE modifiers SET deleted_at = now(), updated_at = now() WHERE group_id = $1`, [groupId]);
    await client.query(`DELETE FROM product_modifier_groups WHERE modifier_group_id = $1`, [groupId]);
    await client.query(`UPDATE modifier_groups SET deleted_at = now(), updated_at = now() WHERE id = $1`, [groupId]);
  });
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier_group.delete', resourceType: 'modifier_group', resourceId: groupId });
}

// ─── addModifier ────────────────────────────────────────────────────────────

export async function addModifier(
  orgId: string, groupId: string, data: CreateModifierData, employeeId: string,
): Promise<{ id: string }> {
  await assertGroup(orgId, groupId);
  if (!data.name?.trim()) throw new ValidationError('Modifier name is required');

  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const { rows: [max] } = await query<{ max: number | null }>(
      `SELECT MAX(sort_order) AS max FROM modifiers WHERE group_id = $1 AND deleted_at IS NULL`,
      [groupId],
    );
    sortOrder = (max?.max ?? -1) + 1;
  }

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO modifiers (group_id, name, price_delta, is_default, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [groupId, data.name.trim(), data.priceDelta ?? 0, data.isDefault ?? false, sortOrder],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier.create', resourceType: 'modifier', resourceId: row.id });
  return row;
}

// ─── updateModifier ─────────────────────────────────────────────────────────

export async function updateModifier(
  orgId: string, modifierId: string, data: UpdateModifierData, employeeId: string,
): Promise<void> {
  const { rows: [m] } = await query<{ id: string }>(
    `SELECT m.id FROM modifiers m
       JOIN modifier_groups mg ON mg.id = m.group_id
      WHERE m.id = $1 AND mg.organization_id = $2 AND m.deleted_at IS NULL`,
    [modifierId, orgId],
  );
  if (!m) throw new NotFoundError('Modifier not found');

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if (data.priceDelta !== undefined) add('price_delta', data.priceDelta);
  if (data.isDefault !== undefined) add('is_default', data.isDefault);
  if (data.sortOrder !== undefined) add('sort_order', data.sortOrder);

  if (sets.length === 0) return;
  sets.push('updated_at = now()');
  params.push(modifierId);
  await query(`UPDATE modifiers SET ${sets.join(', ')} WHERE id = $${p}`, params);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier.update', resourceType: 'modifier', resourceId: modifierId });
}

// ─── deleteModifier ─────────────────────────────────────────────────────────

export async function deleteModifier(
  orgId: string, modifierId: string, employeeId: string,
): Promise<void> {
  const { rows: [m] } = await query<{ id: string }>(
    `SELECT m.id FROM modifiers m
       JOIN modifier_groups mg ON mg.id = m.group_id
      WHERE m.id = $1 AND mg.organization_id = $2 AND m.deleted_at IS NULL`,
    [modifierId, orgId],
  );
  if (!m) throw new NotFoundError('Modifier not found');
  await query(`UPDATE modifiers SET deleted_at = now(), updated_at = now() WHERE id = $1`, [modifierId]);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'modifier.delete', resourceType: 'modifier', resourceId: modifierId });
}

// ─── setGroupProducts ───────────────────────────────────────────────────────
// Replace the set of products this modifier group is assigned to.

export async function setGroupProducts(
  orgId: string, groupId: string, productIds: string[],
): Promise<void> {
  await assertGroup(orgId, groupId);

  // Only assign products that belong to this org
  const { rows: valid } = await query<{ id: string }>(
    `SELECT id FROM products WHERE organization_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [orgId, productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']],
  );
  const validIds = new Set(valid.map((v) => v.id));

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM product_modifier_groups WHERE modifier_group_id = $1`, [groupId]);
    for (const pid of productIds) {
      if (!validIds.has(pid)) continue;
      await client.query(
        `INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
         VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
        [pid, groupId],
      );
    }
  });
}

// ─── setProductGroups ───────────────────────────────────────────────────────
// Replace the set of modifier groups assigned to a product (product-centric).

export async function setProductGroups(
  orgId: string, productId: string, groupIds: string[],
): Promise<void> {
  const { rows: [prod] } = await query<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [productId, orgId],
  );
  if (!prod) throw new NotFoundError('Product not found');

  const { rows: valid } = await query<{ id: string }>(
    `SELECT id FROM modifier_groups WHERE organization_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
    [orgId, groupIds.length ? groupIds : ['00000000-0000-0000-0000-000000000000']],
  );
  const validIds = new Set(valid.map((v) => v.id));

  await withTransaction(async (client) => {
    await client.query(`DELETE FROM product_modifier_groups WHERE product_id = $1`, [productId]);
    let sort = 0;
    for (const gid of groupIds) {
      if (!validIds.has(gid)) continue;
      await client.query(
        `INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [productId, gid, sort++],
      );
    }
  });
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function assertGroup(orgId: string, groupId: string): Promise<void> {
  const { rows: [g] } = await query<{ id: string }>(
    `SELECT id FROM modifier_groups WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [groupId, orgId],
  );
  if (!g) throw new NotFoundError('Modifier group not found');
}
