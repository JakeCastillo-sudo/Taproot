/**
 * classBooking.service — reservations, check-in, waitlist for studio classes (v2.2).
 * (Named classBooking, NOT reservation — `reservation.service` is the existing
 * restaurant TABLE-booking domain. This is studio class booking on class_reservations.)
 *
 * CONSUMPTION MODEL = DEDUCT-AT-BOOK (rationale in docs/V2_2_SANDBOX_NOTES.md):
 * a credit is spent when the spot is reserved; check-in just confirms attendance;
 * an early cancel (before cutoff) RESTORES the credit; a late cancel / no-show forfeits
 * it (the auto-FEE for those is v2.4). The deduct composes INTO the booking transaction
 * (memberCredit.deductCredit accepts the txn client) so the credit move and the
 * reservation insert commit atomically — no lost credits.
 *
 * GRACEFUL: guards class_reservations (to_regclass). Studio-gated at the route layer.
 */
import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import { deductCredit, restoreCredit } from './memberCredit.service';
import type { ClassReservation, ClassReservationSource, ClassRosterEntry, ClassWaitlistEntry } from '@taproot/shared';

const SOURCES: ClassReservationSource[] = ['member_app', 'widget', 'staff', 'kiosk', 'api'];

let _ready: boolean | null = null;
async function bookingReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.class_reservations') IS NOT NULL AS ready`,
    );
    _ready = Boolean(rows[0]?.ready);
  } catch {
    _ready = false;
  }
  return _ready;
}

export type BookResult =
  | { status: 'booked'; reservation: ClassReservation }
  | { status: 'full'; available: 0 };

/**
 * Book a member into a session. Atomic: locks the session, validates status + booking
 * window + capacity + no double-book, deducts credits (if required) within the SAME
 * transaction, and inserts the reservation. Returns { status:'full' } when at capacity
 * (caller may offer the waitlist — no auto-add).
 */
export async function book(
  orgId: string, employeeId: string, sessionId: string, memberId: string, source: ClassReservationSource = 'staff',
): Promise<BookResult> {
  if (!(await bookingReady())) throw new ValidationError('Scheduling not provisioned yet (migration 034 pending)');
  if (!SOURCES.includes(source)) throw new ValidationError(`Invalid source: ${source}`);

  return withTransaction(async (client) => {
    const { rows: [s] } = await client.query<{
      id: string; status: string; capacity: number; credits_required: number;
      not_open: boolean; closed: boolean;
    }>(
      `SELECT id, status, capacity, credits_required,
              (booking_opens_at  IS NOT NULL AND now() < booking_opens_at)  AS not_open,
              (booking_closes_at IS NOT NULL AND now() > booking_closes_at) AS closed
         FROM class_sessions WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [sessionId, orgId],
    );
    if (!s) throw new NotFoundError('Session');
    if (s.status === 'cancelled' || s.status === 'closed') throw new ValidationError('Session is not open for booking');
    if (s.not_open) throw new ValidationError('Booking has not opened for this session yet');
    if (s.closed) throw new ValidationError('Booking has closed for this session');

    // Already holding an active reservation? (reliable under the session lock)
    const { rows: dup } = await client.query(
      `SELECT 1 FROM class_reservations
        WHERE session_id = $1 AND member_id = $2
          AND state NOT IN ('late_cancel','no_show') AND deleted_at IS NULL LIMIT 1`,
      [sessionId, memberId],
    );
    if (dup.length) throw new ValidationError('Member already has a reservation for this session');

    // Capacity (active states only).
    const { rows: [cnt] } = await client.query<{ booked: number }>(
      `SELECT COUNT(*)::int AS booked FROM class_reservations
        WHERE session_id = $1 AND deleted_at IS NULL AND state IN ('booked','checked_in','completed')`,
      [sessionId],
    );
    if (s.capacity > 0 && Number(cnt.booked) >= s.capacity) {
      return { status: 'full', available: 0 };
    }

    // Deduct credits within THIS transaction (atomic with the insert).
    let creditTxnId: string | null = null;
    if (s.credits_required > 0) {
      const ded = await deductCredit(orgId, employeeId, memberId, s.credits_required, client);
      creditTxnId = ded.creditId;
    }

    const { rows: [r] } = await client.query<ClassReservation>(
      `INSERT INTO class_reservations
         (organization_id, session_id, member_id, source, state, credit_txn_id)
       VALUES ($1,$2,$3,$4,'booked',$5)
       RETURNING *`,
      [orgId, sessionId, memberId, source, creditTxnId],
    );

    void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.booked', resourceType: 'class_reservation', resourceId: r.id, afterState: { sessionId, memberId, creditTxnId } });
    return { status: 'booked', reservation: r };
  });
}

/**
 * Cancel a reservation. Before the cancel cutoff → soft-delete + restore the credit
 * (early cancel). After the cutoff → state = late_cancel, credit forfeited (the
 * auto-fee is v2.4). Restore composes into the same transaction.
 */
export async function cancel(orgId: string, employeeId: string, reservationId: string): Promise<{ state: 'cancelled' | 'late_cancel'; creditRestored: boolean }> {
  if (!(await bookingReady())) throw new NotFoundError('Reservation');
  return withTransaction(async (client) => {
    const { rows: [r] } = await client.query<{
      id: string; state: string; credit_txn_id: string | null; credits_required: number; before_cutoff: boolean;
    }>(
      `SELECT r.id, r.state, r.credit_txn_id, s.credits_required,
              (now() < s.starts_at - (s.cancel_cutoff_min * interval '1 minute')) AS before_cutoff
         FROM class_reservations r
         JOIN class_sessions s ON s.id = r.session_id
        WHERE r.id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
        FOR UPDATE OF r`,
      [reservationId, orgId],
    );
    if (!r) throw new NotFoundError('Reservation');
    if (r.state !== 'booked' && r.state !== 'checked_in') throw new ValidationError(`Cannot cancel a reservation in state ${r.state}`);

    let creditRestored = false;
    if (r.before_cutoff) {
      await client.query(`UPDATE class_reservations SET deleted_at = now(), updated_at = now() WHERE id = $1`, [r.id]);
      if (r.credit_txn_id && r.credits_required > 0) {
        const res = await restoreCredit(orgId, employeeId, r.credit_txn_id, r.credits_required, client);
        creditRestored = Boolean(res);
      }
      void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.cancelled_early', resourceType: 'class_reservation', resourceId: r.id, afterState: { creditRestored } });
      return { state: 'cancelled', creditRestored };
    }
    await client.query(`UPDATE class_reservations SET state = 'late_cancel', updated_at = now() WHERE id = $1`, [r.id]);
    void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.cancelled_late', resourceType: 'class_reservation', resourceId: r.id });
    return { state: 'late_cancel', creditRestored: false };
  });
}

/** Check a member in. Idempotent: a second check-in is a no-op. */
export async function checkIn(orgId: string, employeeId: string, reservationId: string, source: ClassReservationSource = 'staff'): Promise<ClassReservation> {
  if (!(await bookingReady())) throw new NotFoundError('Reservation');
  const { rows: [r] } = await query<ClassReservation>(
    `UPDATE class_reservations
        SET state = 'checked_in',
            checked_in_at = COALESCE(checked_in_at, now()),
            source = $3,
            updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
        AND state IN ('booked','checked_in')
      RETURNING *`,
    [reservationId, orgId, source],
  );
  if (!r) {
    // Either gone, or in a terminal state (late_cancel/no_show/completed) — surface clearly.
    const { rows: [exists] } = await query<{ state: string }>(
      `SELECT state FROM class_reservations WHERE id = $1 AND organization_id = $2`, [reservationId, orgId],
    );
    if (!exists) throw new NotFoundError('Reservation');
    throw new ValidationError(`Cannot check in a reservation in state ${exists.state}`);
  }
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.checked_in', resourceType: 'class_reservation', resourceId: r.id });
  return r;
}

/** Manually mark a no-show (state only; the auto-charge fee is v2.4). */
export async function markNoShow(orgId: string, employeeId: string, reservationId: string): Promise<ClassReservation> {
  if (!(await bookingReady())) throw new NotFoundError('Reservation');
  const { rows: [r] } = await query<ClassReservation>(
    `UPDATE class_reservations SET state = 'no_show', updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL AND state = 'booked'
      RETURNING *`,
    [reservationId, orgId],
  );
  if (!r) throw new ValidationError('Only a booked reservation can be marked no-show');
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.no_show', resourceType: 'class_reservation', resourceId: r.id });
  return r;
}

/** Session roster — reservations + member display fields, bulk-joined (no N+1). */
export async function roster(orgId: string, sessionId: string): Promise<ClassRosterEntry[]> {
  if (!(await bookingReady())) return [];
  const { rows } = await query<ClassRosterEntry>(
    `SELECT r.*, m.display_name AS member_name, m.email AS member_email
       FROM class_reservations r
       JOIN members m ON m.id = r.member_id
      WHERE r.session_id = $1 AND r.organization_id = $2 AND r.deleted_at IS NULL
      ORDER BY r.state, r.booked_at ASC`,
    [sessionId, orgId],
  );
  return rows;
}

// ── Waitlist (auto-promote is v2.4; here: join + manual promote) ──
export async function joinWaitlist(orgId: string, employeeId: string, sessionId: string, memberId: string): Promise<ClassWaitlistEntry> {
  if (!(await bookingReady())) throw new ValidationError('Scheduling not provisioned yet (migration 034 pending)');
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<ClassWaitlistEntry>(
      `SELECT * FROM class_waitlist WHERE session_id = $1 AND member_id = $2 AND deleted_at IS NULL`,
      [sessionId, memberId],
    );
    if (existing[0]) return existing[0];
    const { rows: [pos] } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM class_waitlist WHERE session_id = $1 AND deleted_at IS NULL`,
      [sessionId],
    );
    const { rows: [w] } = await client.query<ClassWaitlistEntry>(
      `INSERT INTO class_waitlist (organization_id, session_id, member_id, position)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [orgId, sessionId, memberId, Number(pos.next)],
    );
    void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.waitlist_joined', resourceType: 'class_waitlist', resourceId: w.id });
    return w;
  });
}

export async function listWaitlist(orgId: string, sessionId: string): Promise<ClassWaitlistEntry[]> {
  if (!(await bookingReady())) return [];
  const { rows } = await query<ClassWaitlistEntry>(
    `SELECT * FROM class_waitlist WHERE session_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY position ASC`,
    [sessionId, orgId],
  );
  return rows;
}

/** Manually promote a waitlist entry into a booking (reuses book()). Auto-promote = v2.4. */
export async function promoteFromWaitlist(orgId: string, employeeId: string, waitlistId: string): Promise<BookResult> {
  if (!(await bookingReady())) throw new NotFoundError('Waitlist entry');
  const { rows: [w] } = await query<{ session_id: string; member_id: string }>(
    `SELECT session_id, member_id FROM class_waitlist
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [waitlistId, orgId],
  );
  if (!w) throw new NotFoundError('Waitlist entry');
  const result = await book(orgId, employeeId, w.session_id, w.member_id, 'staff');
  if (result.status === 'booked') {
    await query(`UPDATE class_waitlist SET deleted_at = now() WHERE id = $1`, [waitlistId]);
  }
  return result;
}
