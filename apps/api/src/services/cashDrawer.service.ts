/**
 * cashDrawer.service — open/close shifts, cash drops, reconciliation.
 *
 * Money is in integer CENTS. Resilient to migration 015 not yet being applied:
 * read operations return empty/null and writes throw a friendly error until the
 * tables exist (so the POS never hard-crashes pre-migration).
 */

import { query } from '../db/client';
import { ValidationError, NotFoundError, ConflictError } from '../errors';
import { createAuditLog } from '../auth/audit';

let _tablesReady: boolean | null = null;
async function tablesReady(): Promise<boolean> {
  if (_tablesReady !== null) return _tablesReady;
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cash_drawer_sessions') AS exists`,
  );
  _tablesReady = Boolean(rows[0]?.exists);
  return _tablesReady;
}
function ensureReady(ok: boolean): void {
  if (!ok) throw new ValidationError('Cash drawer is unavailable until migration 015 is applied');
}

export interface CashDrop {
  id: string; amount: number; reason: string | null; created_at: string;
}

export interface CashDrawerSession {
  id: string; location_id: string; employee_id: string; employee_name: string;
  opened_at: string; closed_at: string | null;
  opening_amount: number; expected_amount: number | null;
  actual_amount: number | null; discrepancy: number | null; notes: string | null;
  cash_sales: number; cash_refunds: number; drops_total: number;
  drops: CashDrop[];
}

/** Computed expected cash in the drawer for an open session. */
async function computeExpected(
  locationId: string, openedAt: string, openingAmount: number, sessionId: string,
): Promise<{ cashSales: number; cashRefunds: number; dropsTotal: number; expected: number }> {
  const { rows: [sales] } = await query<{ cash_sales: string; cash_refunds: string }>(
    `SELECT
       COALESCE(SUM(p.amount), 0)          AS cash_sales,
       COALESCE(SUM(p.refunded_amount), 0) AS cash_refunds
     FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE o.location_id = $1 AND p.payment_method = 'cash'
       AND p.status IN ('completed','partially_refunded','refunded')
       AND p.created_at >= $2`,
    [locationId, openedAt],
  );
  const { rows: [drops] } = await query<{ drops_total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS drops_total FROM cash_drops WHERE session_id = $1`,
    [sessionId],
  );
  const cashSales = Math.round(Number(sales?.cash_sales ?? 0));
  const cashRefunds = Math.round(Number(sales?.cash_refunds ?? 0));
  const dropsTotal = Math.round(Number(drops?.drops_total ?? 0));
  const expected = openingAmount + cashSales - cashRefunds - dropsTotal;
  return { cashSales, cashRefunds, dropsTotal, expected };
}

export async function getCurrentSession(orgId: string, locationId: string): Promise<CashDrawerSession | null> {
  if (!(await tablesReady())) return null;
  const { rows: [s] } = await query<CashDrawerSession & { opening_amount: string }>(
    `SELECT s.id, s.location_id, s.employee_id, s.opened_at, s.closed_at,
            s.opening_amount, s.expected_amount, s.actual_amount, s.discrepancy, s.notes,
            e.first_name || ' ' || e.last_name AS employee_name
       FROM cash_drawer_sessions s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.organization_id = $1 AND s.location_id = $2 AND s.closed_at IS NULL
      LIMIT 1`,
    [orgId, locationId],
  );
  if (!s) return null;

  const { cashSales, cashRefunds, dropsTotal, expected } =
    await computeExpected(locationId, s.opened_at, Number(s.opening_amount), s.id);
  const { rows: drops } = await query<CashDrop>(
    `SELECT id, amount, reason, created_at FROM cash_drops WHERE session_id = $1 ORDER BY created_at DESC`,
    [s.id],
  );

  return {
    ...s,
    opening_amount: Number(s.opening_amount),
    expected_amount: expected,
    cash_sales: cashSales, cash_refunds: cashRefunds, drops_total: dropsTotal,
    drops: drops.map((d) => ({ ...d, amount: Number(d.amount) })),
  };
}

export async function openSession(
  orgId: string, locationId: string, employeeId: string, openingAmount: number,
): Promise<{ id: string }> {
  ensureReady(await tablesReady());
  if (openingAmount < 0) throw new ValidationError('Opening amount cannot be negative');

  const existing = await getCurrentSession(orgId, locationId);
  if (existing) throw new ConflictError('A drawer session is already open for this location');

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO cash_drawer_sessions (organization_id, location_id, employee_id, opening_amount)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, locationId, employeeId, Math.round(openingAmount)],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'cash_drawer.open', resourceType: 'cash_drawer_session', resourceId: row.id });
  return row;
}

export async function recordDrop(
  orgId: string, locationId: string, employeeId: string, amount: number, reason?: string,
): Promise<{ id: string }> {
  ensureReady(await tablesReady());
  if (amount <= 0) throw new ValidationError('Drop amount must be greater than 0');
  const session = await getCurrentSession(orgId, locationId);
  if (!session) throw new ValidationError('No open drawer session');

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO cash_drops (session_id, employee_id, amount, reason)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [session.id, employeeId, Math.round(amount), reason ?? null],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'cash_drawer.drop', resourceType: 'cash_drawer_session', resourceId: session.id, metadata: { amount, reason } });
  return row;
}

export async function closeSession(
  orgId: string, locationId: string, employeeId: string, actualAmount: number, notes?: string,
): Promise<CashDrawerSession> {
  ensureReady(await tablesReady());
  const session = await getCurrentSession(orgId, locationId);
  if (!session) throw new NotFoundError('No open drawer session');

  const expected = session.expected_amount ?? 0;
  const discrepancy = Math.round(actualAmount) - expected;

  await query(
    `UPDATE cash_drawer_sessions
        SET closed_at = now(), expected_amount = $2, actual_amount = $3,
            discrepancy = $4, notes = $5, updated_at = now()
      WHERE id = $1`,
    [session.id, expected, Math.round(actualAmount), discrepancy, notes ?? null],
  );
  void createAuditLog({
    organizationId: orgId, actorId: employeeId, action: 'cash_drawer.close',
    resourceType: 'cash_drawer_session', resourceId: session.id,
    afterState: { expected, actual: Math.round(actualAmount), discrepancy },
  });

  return { ...session, closed_at: new Date().toISOString(), actual_amount: Math.round(actualAmount), discrepancy, notes: notes ?? null };
}

export async function getHistory(orgId: string, locationId: string, limit = 30): Promise<CashDrawerSession[]> {
  if (!(await tablesReady())) return [];
  const { rows } = await query<CashDrawerSession & { opening_amount: string }>(
    `SELECT s.id, s.location_id, s.employee_id, s.opened_at, s.closed_at,
            s.opening_amount, s.expected_amount, s.actual_amount, s.discrepancy, s.notes,
            e.first_name || ' ' || e.last_name AS employee_name
       FROM cash_drawer_sessions s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.organization_id = $1 AND s.location_id = $2 AND s.closed_at IS NOT NULL
      ORDER BY s.opened_at DESC LIMIT ${Math.min(limit, 100)}`,
    [orgId, locationId],
  );
  return rows.map((r) => ({
    ...r,
    opening_amount: Number(r.opening_amount),
    expected_amount: r.expected_amount != null ? Number(r.expected_amount) : null,
    actual_amount: r.actual_amount != null ? Number(r.actual_amount) : null,
    discrepancy: r.discrepancy != null ? Number(r.discrepancy) : null,
    cash_sales: 0, cash_refunds: 0, drops_total: 0, drops: [],
  }));
}
