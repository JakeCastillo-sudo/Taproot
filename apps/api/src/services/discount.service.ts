import { query } from '../db/client';
import { createAuditLog } from '../auth/audit';
import { ValidationError, NotFoundError, ConflictError } from '../errors';

export type DiscountType = 'percentage' | 'fixed_amount' | 'bogo' | 'free_item';
const TYPES: DiscountType[] = ['percentage', 'fixed_amount', 'bogo', 'free_item'];

export interface DiscountRow {
  id: string; name: string; code: string | null; discount_type: DiscountType;
  value: number; minimum_order_amount: number | null; maximum_discount_amount: number | null;
  usage_limit: number | null; usage_count: number; stackable: boolean;
  active_from: string; active_until: string | null; is_active: boolean;
}

export interface CreateDiscountData {
  name: string; code?: string | null; discountType: DiscountType; value: number;
  minimumOrderAmount?: number | null; maximumDiscountAmount?: number | null;
  usageLimit?: number | null; stackable?: boolean;
  activeFrom?: string | null; activeUntil?: string | null;
}

const COLS = `id, name, code, discount_type, value, minimum_order_amount, maximum_discount_amount,
              usage_limit, usage_count, stackable, active_from, active_until, is_active`;

export async function listDiscounts(orgId: string): Promise<DiscountRow[]> {
  const { rows } = await query<DiscountRow>(
    `SELECT ${COLS} FROM discounts WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [orgId],
  );
  return rows;
}

export async function createDiscount(orgId: string, data: CreateDiscountData, employeeId: string): Promise<DiscountRow> {
  if (!data.name?.trim()) throw new ValidationError('Discount name is required');
  if (!TYPES.includes(data.discountType)) throw new ValidationError('Invalid discount type');
  if (data.value < 0) throw new ValidationError('Value must be ≥ 0');
  if (data.code) {
    const { rows } = await query(`SELECT id FROM discounts WHERE organization_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL`, [orgId, data.code.trim()]);
    if (rows.length) throw new ConflictError('A discount with that code already exists');
  }
  const { rows: [row] } = await query<DiscountRow>(
    `INSERT INTO discounts
       (organization_id, name, code, discount_type, value, applies_to,
        minimum_order_amount, maximum_discount_amount, usage_limit, stackable,
        active_from, active_until, created_by)
     VALUES ($1,$2,$3,$4,$5,'order',$6,$7,$8,$9,COALESCE($10, now()),$11,$12)
     RETURNING ${COLS}`,
    [
      orgId, data.name.trim(), data.code?.trim() || null, data.discountType, data.value,
      data.minimumOrderAmount ?? null, data.maximumDiscountAmount ?? null,
      data.usageLimit ?? null, data.stackable ?? true,
      data.activeFrom ?? null, data.activeUntil ?? null, employeeId,
    ],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'discount.create', resourceType: 'discount', resourceId: row.id });
  return row;
}

export async function updateDiscount(orgId: string, id: string, data: Partial<CreateDiscountData> & { isActive?: boolean }, employeeId: string): Promise<DiscountRow> {
  const { rows: [exists] } = await query<{ id: string }>(`SELECT id FROM discounts WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [id, orgId]);
  if (!exists) throw new NotFoundError('Discount not found');

  const sets: string[] = []; const params: unknown[] = []; let p = 1;
  const add = (c: string, v: unknown) => { sets.push(`${c} = $${p++}`); params.push(v); };
  if (data.name !== undefined) add('name', data.name.trim());
  if ('code' in data) add('code', data.code?.trim() || null);
  if (data.discountType !== undefined && TYPES.includes(data.discountType)) add('discount_type', data.discountType);
  if (data.value !== undefined) add('value', data.value);
  if ('minimumOrderAmount' in data) add('minimum_order_amount', data.minimumOrderAmount);
  if ('maximumDiscountAmount' in data) add('maximum_discount_amount', data.maximumDiscountAmount);
  if ('usageLimit' in data) add('usage_limit', data.usageLimit);
  if (data.stackable !== undefined) add('stackable', data.stackable);
  if ('activeFrom' in data) add('active_from', data.activeFrom);
  if ('activeUntil' in data) add('active_until', data.activeUntil);
  if (data.isActive !== undefined) add('is_active', data.isActive);
  if (sets.length === 0) {
    const { rows: [row] } = await query<DiscountRow>(`SELECT ${COLS} FROM discounts WHERE id = $1`, [id]);
    return row;
  }
  sets.push('updated_at = now()'); params.push(id, orgId);
  const { rows: [row] } = await query<DiscountRow>(`UPDATE discounts SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p} RETURNING ${COLS}`, params);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'discount.update', resourceType: 'discount', resourceId: id });
  return row;
}

export async function deleteDiscount(orgId: string, id: string, employeeId: string): Promise<void> {
  const { rowCount } = await query(`UPDATE discounts SET deleted_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [id, orgId]);
  if (!rowCount) throw new NotFoundError('Discount not found');
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'discount.delete', resourceType: 'discount', resourceId: id });
}

/** Validate a code against a subtotal (cents) and preview the savings. */
export async function validateDiscount(orgId: string, code: string, subtotal: number): Promise<{
  id: string; code: string; name: string; discountType: DiscountType; value: number; amount: number;
}> {
  const { rows: [d] } = await query<DiscountRow>(
    `SELECT ${COLS} FROM discounts
      WHERE organization_id = $1 AND lower(code) = lower($2) AND deleted_at IS NULL AND is_active = true
        AND active_from <= now() AND (active_until IS NULL OR active_until > now())`,
    [orgId, code.trim()],
  );
  if (!d) throw new ValidationError('Invalid or expired code');
  if (d.usage_limit !== null && d.usage_count >= d.usage_limit) throw new ValidationError('This code has reached its usage limit');
  if (d.minimum_order_amount !== null && subtotal < Number(d.minimum_order_amount)) {
    throw new ValidationError(`Minimum order of $${(Number(d.minimum_order_amount) / 100).toFixed(2)} required`);
  }

  let amount = 0;
  if (d.discount_type === 'percentage') amount = Math.round(subtotal * (Number(d.value) / 100));
  else if (d.discount_type === 'fixed_amount') amount = Math.min(Number(d.value), subtotal);
  // bogo/free_item depend on line items — applied precisely at order creation (preview 0).
  if (d.maximum_discount_amount !== null) amount = Math.min(amount, Number(d.maximum_discount_amount));
  amount = Math.min(amount, subtotal);

  return { id: d.id, code: d.code ?? code, name: d.name, discountType: d.discount_type, value: Number(d.value), amount };
}

export async function getDiscountReport(orgId: string): Promise<Array<{ id: string; name: string; code: string | null; usage_count: number; total_saved: number }>> {
  const { rows } = await query<{ id: string; name: string; code: string | null; usage_count: number; total_saved: string }>(
    `SELECT d.id, d.name, d.code, d.usage_count,
            COALESCE((SELECT SUM(ad.amount_saved) FROM applied_discounts ad WHERE ad.discount_id = d.id), 0) AS total_saved
       FROM discounts d
      WHERE d.organization_id = $1 AND d.deleted_at IS NULL
      ORDER BY d.usage_count DESC`,
    [orgId],
  );
  return rows.map((r) => ({ ...r, usage_count: Number(r.usage_count), total_saved: Math.round(Number(r.total_saved)) }));
}
