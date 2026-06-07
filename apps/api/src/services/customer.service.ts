/**
 * Customer management service.
 *
 * Handles the full customer lifecycle for an organisation:
 *   CRUD, search, merge, order history, marketing consent,
 *   and account-credit adjustments.
 *
 * Key schema facts
 * ────────────────
 * - customers.loyalty_points / loyalty_tier managed by loyalty.service
 * - customers.account_credit managed here (add/deduct)
 * - customers.total_spend / visit_count / last_visit_at incremented on
 *   order completion (order.service responsibility); read-only here
 * - customers.merged_into_id — soft-merge: source row survives with
 *   merged_into_id set; all order FKs updated to target
 */

import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import { deliverWebhook } from './webhook.service';
import type { Customer, CustomerWithStats } from '@taproot/shared';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateCustomerInput {
  firstName?:       string;
  lastName?:        string;
  email?:           string;
  phone?:           string;
  dateOfBirth?:     string; // ISO date YYYY-MM-DD
  address?:         { line1: string; line2?: string; city: string; state: string; zip: string; country: string };
  tags?:            string[];
  notes?:           string;
  marketingOptIn?:  boolean;
  externalIds?:     Record<string, string>;
  /** FDA Big 9 allergen profile (S8-05). Requires migration 019. */
  allergens?:       string[] | null;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

// ─── Allergen column (migration 019) resilience ──────────────────────────────

let _custAllergenCol: boolean | null = null;

async function customerAllergenColumnExists(): Promise<boolean> {
  if (_custAllergenCol !== null) return _custAllergenCol;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = 'allergens'
     ) AS ready`,
  );
  _custAllergenCol = Boolean(rows[0]?.ready);
  return _custAllergenCol;
}

export interface ListCustomersParams {
  page?:      number;
  perPage?:   number;
  search?:    string;
  loyaltyTier?: string;
  tags?:      string[];
  orderBy?:   'created_at' | 'total_spend' | 'visit_count' | 'last_visit_at';
  orderDir?:  'asc' | 'desc';
}

export interface CustomerListResult {
  customers: CustomerWithStats[];
  total:     number;
  page:      number;
  perPage:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireCustomer(orgId: string, customerId: string): Promise<CustomerWithStats> {
  const { rows: [c] } = await query<CustomerWithStats>(
    `SELECT *, date_of_birth, address, marketing_opt_in, external_ids
     FROM customers
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [customerId, orgId],
  );
  if (!c) throw new NotFoundError('Customer');
  return c;
}

// ─── createCustomer ───────────────────────────────────────────────────────────

export async function createCustomer(
  orgId:      string,
  employeeId: string,
  input:      CreateCustomerInput,
): Promise<CustomerWithStats> {
  if (!input.email && !input.phone && !input.firstName && !input.lastName) {
    throw new ValidationError('At least one of email, phone, firstName, or lastName is required');
  }

  // Uniqueness checks — email and phone are unique per org
  if (input.email) {
    const { rows: [existing] } = await query(
      `SELECT id FROM customers WHERE organization_id = $1 AND email = $2 AND deleted_at IS NULL`,
      [orgId, input.email.toLowerCase()],
    );
    if (existing) throw new ValidationError(`A customer with email ${input.email} already exists`);
  }

  if (input.phone) {
    const { rows: [existing] } = await query(
      `SELECT id FROM customers WHERE organization_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [orgId, input.phone],
    );
    if (existing) throw new ValidationError(`A customer with phone ${input.phone} already exists`);
  }

  const { rows: [customer] } = await query<CustomerWithStats>(
    `INSERT INTO customers
       (organization_id, first_name, last_name, email, phone,
        date_of_birth, address, tags, notes, marketing_opt_in,
        external_ids, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      orgId,
      input.firstName  ?? null,
      input.lastName   ?? null,
      input.email      ? input.email.toLowerCase() : null,
      input.phone      ?? null,
      input.dateOfBirth ?? null,
      input.address    ? JSON.stringify(input.address) : null,
      input.tags       ?? null,
      input.notes      ?? null,
      input.marketingOptIn ?? false,
      JSON.stringify(input.externalIds ?? {}),
      employeeId,
    ],
  );

  // Outbound webhooks (S8-04) — fire-and-forget
  void deliverWebhook(orgId, 'customer.created', {
    customerId: customer.id,
    firstName:  customer.first_name,
    lastName:   customer.last_name,
    email:      customer.email,
    phone:      customer.phone,
  });

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'customer.created',
    resourceType:   'customer',
    resourceId:     customer.id,
    afterState:     { email: input.email, phone: input.phone },
  });

  return customer;
}

// ─── getCustomer ──────────────────────────────────────────────────────────────

export async function getCustomer(
  orgId:      string,
  customerId: string,
): Promise<CustomerWithStats> {
  return requireCustomer(orgId, customerId);
}

// ─── updateCustomer ───────────────────────────────────────────────────────────

export async function updateCustomer(
  orgId:      string,
  customerId: string,
  employeeId: string,
  input:      UpdateCustomerInput,
): Promise<CustomerWithStats> {
  const existing = await requireCustomer(orgId, customerId);

  // Email uniqueness if changing
  if (input.email && input.email.toLowerCase() !== existing.email) {
    const { rows: [dup] } = await query(
      `SELECT id FROM customers WHERE organization_id = $1 AND email = $2 AND deleted_at IS NULL AND id <> $3`,
      [orgId, input.email.toLowerCase(), customerId],
    );
    if (dup) throw new ValidationError(`A customer with email ${input.email} already exists`);
  }

  // Phone uniqueness if changing
  if (input.phone && input.phone !== existing.phone) {
    const { rows: [dup] } = await query(
      `SELECT id FROM customers WHERE organization_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`,
      [orgId, input.phone, customerId],
    );
    if (dup) throw new ValidationError(`A customer with phone ${input.phone} already exists`);
  }

  const { rows: [updated] } = await query<CustomerWithStats>(
    `UPDATE customers SET
       first_name       = COALESCE($1, first_name),
       last_name        = COALESCE($2, last_name),
       email            = COALESCE($3, email),
       phone            = COALESCE($4, phone),
       date_of_birth    = COALESCE($5, date_of_birth),
       address          = COALESCE($6::jsonb, address),
       tags             = COALESCE($7, tags),
       notes            = COALESCE($8, notes),
       marketing_opt_in = COALESCE($9, marketing_opt_in),
       external_ids     = COALESCE($10::jsonb, external_ids),
       updated_at       = now()
     WHERE id = $11 AND organization_id = $12
     RETURNING *`,
    [
      input.firstName  ?? null,
      input.lastName   ?? null,
      input.email      ? input.email.toLowerCase() : null,
      input.phone      ?? null,
      input.dateOfBirth ?? null,
      input.address    ? JSON.stringify(input.address) : null,
      input.tags       ?? null,
      input.notes      ?? null,
      input.marketingOptIn ?? null,
      input.externalIds ? JSON.stringify(input.externalIds) : null,
      customerId,
      orgId,
    ],
  );

  // Allergen profile (S8-05) — separate statement, resilient while 019 is pending
  if ('allergens' in input) {
    if (!(await customerAllergenColumnExists())) {
      throw new ValidationError('Allergen profiles require migration 019 — ask your administrator to run pending migrations.');
    }
    const clean = (input.allergens ?? []).filter(Boolean);
    await query(
      `UPDATE customers SET allergens = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
      [clean.length ? `{${clean.join(',')}}` : null, customerId, orgId],
    );
    (updated as CustomerWithStats & { allergens?: string[] | null }).allergens = clean.length ? clean : null;
  }

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'customer.updated',
    resourceType:   'customer',
    resourceId:     customerId,
    beforeState:    { email: existing.email, phone: existing.phone },
    afterState:     { email: updated.email, phone: updated.phone },
  });

  return updated;
}

// ─── deleteCustomer ───────────────────────────────────────────────────────────

export async function deleteCustomer(
  orgId:      string,
  customerId: string,
  employeeId: string,
): Promise<void> {
  await requireCustomer(orgId, customerId);

  await query(
    `UPDATE customers SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [customerId, orgId],
  );

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'customer.deleted',
    resourceType:   'customer',
    resourceId:     customerId,
  });
}

// ─── listCustomers ────────────────────────────────────────────────────────────

export async function listCustomers(
  orgId:  string,
  params: ListCustomersParams = {},
): Promise<CustomerListResult> {
  const page    = Math.max(1, params.page    ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 25));
  const offset  = (page - 1) * perPage;

  const orderBy  = params.orderBy  ?? 'created_at';
  const orderDir = params.orderDir ?? 'desc';

  const conditions: string[] = ['c.organization_id = $1', 'c.deleted_at IS NULL'];
  const bindings: unknown[]  = [orgId];

  if (params.search) {
    bindings.push(`%${params.search}%`);
    const n = bindings.length;
    conditions.push(`(
      c.first_name ILIKE $${n} OR c.last_name ILIKE $${n} OR
      (c.first_name || ' ' || c.last_name) ILIKE $${n} OR
      c.email ILIKE $${n} OR c.phone ILIKE $${n}
    )`);
  }

  if (params.loyaltyTier) {
    bindings.push(params.loyaltyTier);
    conditions.push(`c.loyalty_tier = $${bindings.length}`);
  }

  if (params.tags && params.tags.length > 0) {
    bindings.push(params.tags);
    conditions.push(`c.tags && $${bindings.length}`);
  }

  const where = conditions.join(' AND ');

  const allowedOrder = new Set(['created_at', 'total_spend', 'visit_count', 'last_visit_at']);
  const safeOrder = allowedOrder.has(orderBy) ? orderBy : 'created_at';
  const safeDir   = orderDir === 'asc' ? 'ASC' : 'DESC';

  const { rows: countRows } = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM customers c WHERE ${where}`,
    bindings,
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  bindings.push(perPage, offset);
  const { rows: customers } = await query<CustomerWithStats>(
    `SELECT c.*, c.date_of_birth, c.address, c.marketing_opt_in, c.external_ids
     FROM customers c
     WHERE ${where}
     ORDER BY c.${safeOrder} ${safeDir}
     LIMIT $${bindings.length - 1} OFFSET $${bindings.length}`,
    bindings,
  );

  return { customers, total, page, perPage };
}

// ─── searchCustomers ──────────────────────────────────────────────────────────

/** Fast customer lookup for POS order entry (name, email, or phone). */
export async function searchCustomers(
  orgId: string,
  q:     string,
  limit = 10,
): Promise<CustomerWithStats[]> {
  if (!q || q.trim().length < 2) return [];

  const search = `%${q.trim()}%`;
  const { rows } = await query<CustomerWithStats>(
    `SELECT *, date_of_birth, address, marketing_opt_in, external_ids
     FROM customers
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND (
         first_name ILIKE $2 OR last_name ILIKE $2 OR
         (first_name || ' ' || last_name) ILIKE $2 OR
         email ILIKE $2 OR phone ILIKE $2
       )
     ORDER BY
       CASE WHEN email = $3 THEN 0 WHEN phone = $3 THEN 1 ELSE 2 END,
       total_spend DESC
     LIMIT $4`,
    [orgId, search, q.trim(), limit],
  );

  return rows;
}

// ─── mergeCustomers ───────────────────────────────────────────────────────────

/**
 * Merge sourceId into targetId.
 * - Reassigns all orders from source → target
 * - Adds source's loyalty points and account_credit to target
 * - Soft-deletes source with merged_into_id set
 * - Returns the updated target customer
 */
export async function mergeCustomers(
  orgId:      string,
  sourceId:   string,
  targetId:   string,
  employeeId: string,
): Promise<CustomerWithStats> {
  if (sourceId === targetId) {
    throw new ValidationError('Source and target customer must be different');
  }

  const [source, target] = await Promise.all([
    requireCustomer(orgId, sourceId),
    requireCustomer(orgId, targetId),
  ]);

  if (source.merged_into_id) {
    throw new ValidationError('Source customer has already been merged');
  }

  await withTransaction(async (client) => {
    // Transfer all orders to target
    await client.query(
      `UPDATE orders SET customer_id = $1, updated_at = now()
       WHERE customer_id = $2 AND organization_id = $3`,
      [targetId, sourceId, orgId],
    );

    // Transfer loyalty transactions to target
    await client.query(
      `UPDATE loyalty_transactions SET customer_id = $1
       WHERE customer_id = $2 AND organization_id = $3`,
      [targetId, sourceId, orgId],
    );

    // Absorb points and credit into target
    await client.query(
      `UPDATE customers
       SET loyalty_points = loyalty_points + $1,
           account_credit = account_credit + $2,
           total_spend    = total_spend + $3,
           visit_count    = visit_count + $4,
           updated_at     = now()
       WHERE id = $5`,
      [source.loyalty_points, source.account_credit, source.total_spend, source.visit_count, targetId],
    );

    // Soft-delete source and record the merge
    await client.query(
      `UPDATE customers
       SET merged_into_id = $1,
           deleted_at     = now(),
           updated_at     = now()
       WHERE id = $2`,
      [targetId, sourceId],
    );
  });

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'customer.merged',
    resourceType:   'customer',
    resourceId:     targetId,
    beforeState:    { sourceId, targetId },
    afterState:     {
      transferredPoints: source.loyalty_points,
      transferredCredit: source.account_credit,
    },
  });

  return requireCustomer(orgId, targetId);
}

// ─── getCustomerOrderHistory ──────────────────────────────────────────────────

export async function getCustomerOrderHistory(
  orgId:      string,
  customerId: string,
  page    = 1,
  perPage = 20,
): Promise<{ orders: Record<string, unknown>[]; total: number }> {
  await requireCustomer(orgId, customerId);

  const offset = (Math.max(1, page) - 1) * perPage;

  const { rows: countRows } = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM orders
     WHERE customer_id = $1 AND organization_id = $2`,
    [customerId, orgId],
  );
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  const { rows: orders } = await query(
    `SELECT o.id, o.order_number, o.status, o.order_type, o.total,
            o.amount_paid, o.created_at, o.fulfilled_at,
            l.name AS location_name,
            e.first_name || ' ' || e.last_name AS employee_name
     FROM orders o
     JOIN locations l ON l.id = o.location_id
     JOIN employees e ON e.id = o.employee_id
     WHERE o.customer_id = $1 AND o.organization_id = $2
     ORDER BY o.created_at DESC
     LIMIT $3 OFFSET $4`,
    [customerId, orgId, perPage, offset],
  );

  return { orders, total };
}

// ─── addAccountCredit ─────────────────────────────────────────────────────────

export async function addAccountCredit(
  orgId:      string,
  customerId: string,
  amount:     number,
  reason:     string,
  employeeId: string,
): Promise<CustomerWithStats> {
  if (amount <= 0) throw new ValidationError('Credit amount must be greater than 0');

  const before = await requireCustomer(orgId, customerId);

  const { rows: [updated] } = await query<CustomerWithStats>(
    `UPDATE customers
     SET account_credit = account_credit + $1, updated_at = now()
     WHERE id = $2 AND organization_id = $3
     RETURNING *`,
    [amount, customerId, orgId],
  );

  void createAuditLog({
    organizationId: orgId,
    actorId:        employeeId,
    action:         'customer.credit_added',
    resourceType:   'customer',
    resourceId:     customerId,
    beforeState:    { account_credit: before.account_credit },
    afterState:     { account_credit: updated.account_credit, amount_added: amount, reason },
  });

  return updated;
}

// ─── deductAccountCredit ──────────────────────────────────────────────────────

export async function deductAccountCredit(
  orgId:      string,
  customerId: string,
  amount:     number,
  orderId:    string,
): Promise<CustomerWithStats> {
  if (amount <= 0) throw new ValidationError('Deduction amount must be greater than 0');

  const customer = await requireCustomer(orgId, customerId);
  if (customer.account_credit < amount) {
    throw new ValidationError(
      `Insufficient account credit. Available: ${customer.account_credit}, requested: ${amount}`,
    );
  }

  const { rows: [updated] } = await query<CustomerWithStats>(
    `UPDATE customers
     SET account_credit = account_credit - $1, updated_at = now()
     WHERE id = $2 AND organization_id = $3
     RETURNING *`,
    [amount, customerId, orgId],
  );

  void createAuditLog({
    organizationId: orgId,
    actorId:        'system',
    action:         'customer.credit_deducted',
    resourceType:   'customer',
    resourceId:     customerId,
    afterState:     { amount_deducted: amount, orderId },
  });

  return updated;
}
