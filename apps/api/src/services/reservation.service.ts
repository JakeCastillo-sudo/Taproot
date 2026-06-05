/**
 * reservation.service — waitlist + reservations.
 *
 * Resilient to migration 016 not yet being applied: reads return [] and writes
 * throw a friendly error until the table exists.
 */

import { query } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';

let _ready: boolean | null = null;
async function tableReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reservations') AS exists`);
  _ready = Boolean(rows[0]?.exists);
  return _ready;
}
function ensure(ok: boolean): void {
  if (!ok) throw new ValidationError('Reservations are unavailable until migration 016 is applied');
}

export type ReservationType = 'reservation' | 'waitlist';

export interface ReservationRow {
  id: string; customer_name: string; party_size: number;
  phone: string | null; email: string | null; type: ReservationType;
  reserved_for: string | null; table_id: string | null; table_name: string | null;
  status: string; notes: string | null; notified_at: string | null; created_at: string;
}

export interface CreateReservationData {
  customerName: string; partySize?: number; phone?: string; email?: string;
  type?: ReservationType; reservedFor?: string | null; notes?: string;
}

export interface UpdateReservationData {
  customerName?: string; partySize?: number; phone?: string; email?: string;
  reservedFor?: string | null; status?: string; notes?: string; tableId?: string | null;
}

const SELECT = `
  SELECT r.id, r.customer_name, r.party_size, r.phone, r.email, r.type,
         r.reserved_for, r.table_id, t.name AS table_name, r.status, r.notes,
         r.notified_at, r.created_at
    FROM reservations r
    LEFT JOIN tables t ON t.id = r.table_id`;

export async function listReservations(
  orgId: string, locationId: string, opts: { date?: string; type?: ReservationType } = {},
): Promise<ReservationRow[]> {
  if (!(await tableReady())) return [];
  const conds = ['r.organization_id = $1', 'r.location_id = $2'];
  const params: unknown[] = [orgId, locationId];
  if (opts.type) { params.push(opts.type); conds.push(`r.type = $${params.length}`); }
  if (opts.date) {
    params.push(opts.date);
    conds.push(`(r.reserved_for::date = $${params.length}::date OR (r.type = 'waitlist' AND r.created_at::date = $${params.length}::date))`);
  }
  const { rows } = await query<ReservationRow>(
    `${SELECT} WHERE ${conds.join(' AND ')} ORDER BY COALESCE(r.reserved_for, r.created_at) ASC`,
    params,
  );
  return rows;
}

export async function createReservation(
  orgId: string, locationId: string, data: CreateReservationData, employeeId: string,
): Promise<ReservationRow> {
  ensure(await tableReady());
  if (!data.customerName?.trim()) throw new ValidationError('Customer name is required');
  const type: ReservationType = data.type === 'reservation' ? 'reservation' : 'waitlist';
  const status = type === 'reservation' ? 'confirmed' : 'waiting';

  const { rows: [row] } = await query<{ id: string }>(
    `INSERT INTO reservations (organization_id, location_id, customer_name, party_size, phone, email, type, reserved_for, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [orgId, locationId, data.customerName.trim(), data.partySize ?? 2, data.phone ?? null, data.email ?? null,
      type, data.reservedFor ?? null, status, data.notes ?? null],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'reservation.create', resourceType: 'reservation', resourceId: row.id });
  return (await getById(orgId, row.id))!;
}

async function getById(orgId: string, id: string): Promise<ReservationRow | null> {
  const { rows: [row] } = await query<ReservationRow>(`${SELECT} WHERE r.id = $1 AND r.organization_id = $2`, [id, orgId]);
  return row ?? null;
}

export async function updateReservation(
  orgId: string, id: string, data: UpdateReservationData, employeeId: string,
): Promise<ReservationRow> {
  ensure(await tableReady());
  const existing = await getById(orgId, id);
  if (!existing) throw new NotFoundError('Reservation not found');

  const sets: string[] = []; const params: unknown[] = []; let p = 1;
  const add = (c: string, v: unknown) => { sets.push(`${c} = $${p++}`); params.push(v); };
  if (data.customerName !== undefined) add('customer_name', data.customerName.trim());
  if (data.partySize !== undefined) add('party_size', data.partySize);
  if ('phone' in data) add('phone', data.phone);
  if ('email' in data) add('email', data.email);
  if ('reservedFor' in data) add('reserved_for', data.reservedFor);
  if (data.status !== undefined) add('status', data.status);
  if ('notes' in data) add('notes', data.notes);
  if ('tableId' in data) add('table_id', data.tableId);
  if (sets.length === 0) return existing;
  sets.push('updated_at = now()');
  params.push(id, orgId);
  await query(`UPDATE reservations SET ${sets.join(', ')} WHERE id = $${p++} AND organization_id = $${p}`, params);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'reservation.update', resourceType: 'reservation', resourceId: id });
  return (await getById(orgId, id))!;
}

export async function deleteReservation(orgId: string, id: string, employeeId: string): Promise<void> {
  ensure(await tableReady());
  const { rowCount } = await query(`DELETE FROM reservations WHERE id = $1 AND organization_id = $2`, [id, orgId]);
  if (!rowCount) throw new NotFoundError('Reservation not found');
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'reservation.delete', resourceType: 'reservation', resourceId: id });
}

/** Notify a guest their table is ready. Twilio is stubbed — logs when unconfigured. */
export async function notifyReservation(orgId: string, id: string, employeeId: string): Promise<{ sent: boolean; channel: string }> {
  ensure(await tableReady());
  const res = await getById(orgId, id);
  if (!res) throw new NotFoundError('Reservation not found');

  const channel = process.env.TWILIO_ACCOUNT_SID ? 'sms' : 'log';
  if (channel === 'log') {
    // eslint-disable-next-line no-console
    console.info(`[reservation.notify] (stub) Would SMS ${res.phone ?? 'no-phone'}: "Your table is ready!"`);
  }
  await query(`UPDATE reservations SET notified_at = now(), status = CASE WHEN status = 'waiting' THEN 'notified' ELSE status END, updated_at = now() WHERE id = $1`, [id]);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'reservation.notify', resourceType: 'reservation', resourceId: id });
  return { sent: channel === 'sms', channel };
}

export async function seatReservation(orgId: string, id: string, tableId: string | null, employeeId: string): Promise<ReservationRow> {
  ensure(await tableReady());
  const res = await getById(orgId, id);
  if (!res) throw new NotFoundError('Reservation not found');
  await query(`UPDATE reservations SET status = 'seated', table_id = $2, updated_at = now() WHERE id = $1`, [id, tableId ?? null]);
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'reservation.seat', resourceType: 'reservation', resourceId: id });
  return (await getById(orgId, id))!;
}
