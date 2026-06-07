import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError } from '../errors';
import { invalidateOrgCache } from '../lib/cache';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCategoryData {
  name:      string;
  color?:    string | null;
  icon?:     string | null;
  sortOrder?: number;
  parentId?: string | null;
}

export interface UpdateCategoryData {
  name?:      string;
  color?:     string | null;
  icon?:      string | null;
  sortOrder?: number;
  parentId?:  string | null;
  isActive?:  boolean;
}

export interface CategoryRow {
  id:            string;
  organization_id: string;
  parent_id:     string | null;
  name:          string;
  color:         string | null;
  icon:          string | null;
  sort_order:    number;
  is_active:     boolean;
}

// ─── createCategory ─────────────────────────────────────────────────────────

export async function createCategory(
  orgId: string,
  data: CreateCategoryData,
  employeeId: string,
): Promise<CategoryRow> {
  if (!data.name?.trim()) throw new ValidationError('Category name is required');

  // Default sort_order to the end of the list if not provided
  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const { rows } = await query<{ max: number | null }>(
      `SELECT MAX(sort_order) AS max FROM categories WHERE organization_id = $1 AND deleted_at IS NULL`,
      [orgId],
    );
    sortOrder = (rows[0]?.max ?? -1) + 1;
  }

  const { rows: [row] } = await query<CategoryRow>(
    `INSERT INTO categories (organization_id, parent_id, name, color, icon, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, organization_id, parent_id, name, color, icon, sort_order, is_active`,
    [
      orgId, data.parentId ?? null, data.name.trim(),
      data.color ?? null, data.icon ?? null, sortOrder, employeeId,
    ],
  );

  void invalidateOrgCache(orgId, ['categories', 'products']);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'category.create', resourceType: 'category', resourceId: row.id });
  return row;
}

// ─── updateCategory ─────────────────────────────────────────────────────────

export async function updateCategory(
  orgId: string,
  categoryId: string,
  data: UpdateCategoryData,
  employeeId: string,
): Promise<CategoryRow> {
  const { rows: [existing] } = await query<{ id: string }>(
    `SELECT id FROM categories WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [categoryId, orgId],
  );
  if (!existing) throw new NotFoundError('Category not found');

  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${p++}`); params.push(val); };

  if (data.name !== undefined) add('name', data.name.trim());
  if ('color' in data) add('color', data.color);
  if ('icon' in data) add('icon', data.icon);
  if (data.sortOrder !== undefined) add('sort_order', data.sortOrder);
  if ('parentId' in data) add('parent_id', data.parentId);
  if (data.isActive !== undefined) add('is_active', data.isActive);

  if (sets.length === 0) {
    const { rows: [row] } = await query<CategoryRow>(
      `SELECT id, organization_id, parent_id, name, color, icon, sort_order, is_active
         FROM categories WHERE id = $1`, [categoryId],
    );
    return row;
  }

  sets.push('updated_at = now()');
  params.push(categoryId, orgId);

  const { rows: [row] } = await query<CategoryRow>(
    `UPDATE categories SET ${sets.join(', ')}
      WHERE id = $${p++} AND organization_id = $${p}
      RETURNING id, organization_id, parent_id, name, color, icon, sort_order, is_active`,
    params,
  );

  void invalidateOrgCache(orgId, ['categories', 'products']);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'category.update', resourceType: 'category', resourceId: categoryId });
  return row;
}

// ─── deleteCategory ─────────────────────────────────────────────────────────

export async function deleteCategory(
  orgId: string,
  categoryId: string,
  employeeId: string,
): Promise<void> {
  const { rows: [existing] } = await query<{ id: string }>(
    `SELECT id FROM categories WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [categoryId, orgId],
  );
  if (!existing) throw new NotFoundError('Category not found');

  // Detach products (set category_id NULL) so they remain sellable, then soft-delete
  await query(
    `UPDATE products SET category_id = NULL, updated_at = now()
      WHERE category_id = $1 AND organization_id = $2`,
    [categoryId, orgId],
  );
  await query(
    `UPDATE categories SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND organization_id = $2`,
    [categoryId, orgId],
  );

  void invalidateOrgCache(orgId, ['categories', 'products']);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'category.delete', resourceType: 'category', resourceId: categoryId });
}

// ─── reorderCategories ──────────────────────────────────────────────────────

export async function reorderCategories(
  orgId: string,
  positions: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  for (const pos of positions) {
    await query(
      `UPDATE categories SET sort_order = $3, updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [pos.id, orgId, pos.sortOrder],
    );
  }
  void invalidateOrgCache(orgId, ['categories']);
}
