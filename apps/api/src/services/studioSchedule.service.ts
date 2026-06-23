/**
 * studioSchedule.service — studio rooms, class templates, session materialization,
 * listing, and cancellation (v2.2). The calendar core the Counter Bridge (v2.3)
 * sits on. (Named studioSchedule, NOT scheduling — `scheduling.service` is the
 * existing EMPLOYEE-shift domain; this is the studio class calendar.)
 *
 * TIME MODEL (full rationale in docs/V2_2_SANDBOX_NOTES.md):
 *  • template = recurring definition; session = concrete dated (UTC) instance.
 *  • EAGER materialization: generateSessions() expands a template's weekly recurrence
 *    into real class_sessions rows — reservations FK to real rows. Idempotent via
 *    uq_class_sessions_template_start (ON CONFLICT DO NOTHING).
 *  • Timezone-correct: each start is computed in Postgres as
 *    (occurrence_date + local_time) AT TIME ZONE location_tz → a DST-correct timestamptz.
 *
 * GRACEFUL: guards class_sessions (to_regclass), safe pre-migration. Studio-gating
 * (capabilities.studio) is enforced at the route layer.
 */
import { query, withTransaction } from '../db/client';
import { ValidationError, NotFoundError } from '../errors';
import { createAuditLog } from '../auth/audit';
import { restoreCredit } from './memberCredit.service';
import type {
  StudioRoom, ClassTemplate, ClassSession, ClassSessionWithAvailability, Recurrence,
} from '@taproot/shared';

let _ready: boolean | null = null;
async function schedulingReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  try {
    const { rows } = await query<{ ready: boolean }>(
      `SELECT to_regclass('public.class_sessions') IS NOT NULL AS ready`,
    );
    _ready = Boolean(rows[0]?.ready);
  } catch {
    _ready = false;
  }
  return _ready;
}
const NOT_PROVISIONED = 'Scheduling not provisioned yet (migration 034 pending)';

// ── Rooms ──
export interface RoomInput { name: string; locationId?: string | null; capacity?: number }

export async function createRoom(orgId: string, employeeId: string, input: RoomInput): Promise<StudioRoom> {
  if (!(await schedulingReady())) throw new ValidationError(NOT_PROVISIONED);
  if (!input.name?.trim()) throw new ValidationError('Room name is required');
  const { rows: [room] } = await query<StudioRoom>(
    `INSERT INTO studio_rooms (organization_id, location_id, name, capacity)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [orgId, input.locationId ?? null, input.name.trim(), input.capacity ?? 0],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.room_created', resourceType: 'studio_room', resourceId: room.id });
  return room;
}

export async function listRooms(orgId: string): Promise<StudioRoom[]> {
  if (!(await schedulingReady())) return [];
  const { rows } = await query<StudioRoom>(
    `SELECT * FROM studio_rooms WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`, [orgId],
  );
  return rows;
}

export async function deleteRoom(orgId: string, roomId: string): Promise<void> {
  if (!(await schedulingReady())) return;
  await query(`UPDATE studio_rooms SET deleted_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2`, [roomId, orgId]);
}

// ── Class templates ──
export interface TemplateInput {
  name: string;
  locationId?: string | null;
  discipline?: string | null;
  instructorDefaultId?: string | null;
  durationMin?: number;
  capacity?: number;
  roomId?: string | null;
  priceDropIn?: number;
  creditsRequired?: number;
  recurrence?: Recurrence;
  bookingWindowHours?: number;
  cancelCutoffMin?: number;
  noshowWindowMin?: number;
}

function validateRecurrence(r: unknown): Recurrence | null {
  if (!r || typeof r !== 'object') return null;
  const rec = r as Record<string, unknown>;
  if (rec.freq !== 'weekly') return null;
  if (!Array.isArray(rec.days) || rec.days.some((d) => typeof d !== 'number' || d < 0 || d > 6)) return null;
  if (typeof rec.time !== 'string' || !/^\d{2}:\d{2}$/.test(rec.time)) return null;
  return { freq: 'weekly', days: rec.days as number[], time: rec.time, until: (typeof rec.until === 'string' ? rec.until : null) };
}

export async function createTemplate(orgId: string, employeeId: string, input: TemplateInput): Promise<ClassTemplate> {
  if (!(await schedulingReady())) throw new ValidationError(NOT_PROVISIONED);
  if (!input.name?.trim()) throw new ValidationError('Template name is required');
  const recurrence = input.recurrence ? validateRecurrence(input.recurrence) : null;
  if (input.recurrence && !recurrence) throw new ValidationError('Invalid recurrence (weekly only: {freq,days[0-6],time:"HH:MM"})');
  const { rows: [t] } = await query<ClassTemplate>(
    `INSERT INTO class_templates
       (organization_id, location_id, name, discipline, instructor_default_id,
        duration_min, capacity, room_id, price_drop_in, credits_required, recurrence,
        booking_window_hours, cancel_cutoff_min, noshow_window_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      orgId, input.locationId ?? null, input.name.trim(), input.discipline ?? null,
      input.instructorDefaultId ?? null, input.durationMin ?? 60, input.capacity ?? 0,
      input.roomId ?? null, input.priceDropIn ?? 0, input.creditsRequired ?? 1,
      JSON.stringify(recurrence ?? {}), input.bookingWindowHours ?? 168,
      input.cancelCutoffMin ?? 720, input.noshowWindowMin ?? 15,
    ],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.template_created', resourceType: 'class_template', resourceId: t.id });
  return t;
}

export async function listTemplates(orgId: string): Promise<ClassTemplate[]> {
  if (!(await schedulingReady())) return [];
  const { rows } = await query<ClassTemplate>(
    `SELECT * FROM class_templates WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`, [orgId],
  );
  return rows;
}

export async function deleteTemplate(orgId: string, templateId: string): Promise<void> {
  if (!(await schedulingReady())) return;
  await query(`UPDATE class_templates SET deleted_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2`, [templateId, orgId]);
}

// ── Session generation (eager materialization) ──

/** Enumerate calendar dates in [from,to] whose weekday is in `days` (0=Sun..6=Sat). */
function enumerateDates(from: string, to: string, days: number[], until?: string | null): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  let end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ValidationError('Invalid date range');
  const maxEnd = new Date(start.getTime());
  maxEnd.setUTCDate(maxEnd.getUTCDate() + 366); // bound generation to one year
  if (end > maxEnd) end = maxEnd;
  const untilDate = until ? new Date(`${until}T23:59:59Z`) : null;
  const out: string[] = [];
  const cur = new Date(start.getTime());
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    if (untilDate && cur > untilDate) break;
    if (days.includes(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Materialize sessions from a template's weekly recurrence across [fromDate,toDate]
 * (YYYY-MM-DD). Idempotent (ON CONFLICT DO NOTHING on template_id+starts_at). Returns
 * the count newly created. Each start is computed tz-correctly in Postgres.
 */
export async function generateSessions(orgId: string, employeeId: string, templateId: string, fromDate: string, toDate: string): Promise<{ created: number }> {
  if (!(await schedulingReady())) throw new ValidationError(NOT_PROVISIONED);
  const { rows: [t] } = await query<ClassTemplate & { timezone: string | null }>(
    `SELECT ct.*, l.timezone
       FROM class_templates ct
       LEFT JOIN locations l ON l.id = ct.location_id
      WHERE ct.id = $1 AND ct.organization_id = $2 AND ct.deleted_at IS NULL`,
    [templateId, orgId],
  );
  if (!t) throw new NotFoundError('Class template');
  const recurrence = validateRecurrence(t.recurrence);
  if (!recurrence) throw new ValidationError('Template has no valid weekly recurrence to generate from');
  const tz = t.timezone ?? 'UTC';
  const dates = enumerateDates(fromDate, toDate, recurrence.days, recurrence.until);
  if (!dates.length) return { created: 0 };

  let created = 0;
  await withTransaction(async (client) => {
    for (const d of dates) {
      const { rowCount } = await client.query(
        `INSERT INTO class_sessions
           (organization_id, location_id, template_id, name, discipline, starts_at, ends_at,
            instructor_id, room_id, capacity, credits_required, price_drop_in, status,
            booking_opens_at, booking_closes_at, cancel_cutoff_min, noshow_window_min)
         SELECT $1,$2,$3,$4,$5,
                ($6::date + $7::time) AT TIME ZONE $8,
                ($6::date + $7::time) AT TIME ZONE $8 + ($9 * interval '1 minute'),
                $10,$11,$12,$13,$14,'scheduled',
                (($6::date + $7::time) AT TIME ZONE $8) - ($15 * interval '1 hour'),
                ($6::date + $7::time) AT TIME ZONE $8,
                $16,$17
         ON CONFLICT (template_id, starts_at) WHERE template_id IS NOT NULL DO NOTHING`,
        [
          orgId, t.location_id, templateId, t.name, t.discipline,
          d, recurrence.time, tz, t.duration_min,
          t.instructor_default_id, t.room_id, t.capacity, t.credits_required, t.price_drop_in,
          t.booking_window_hours, t.cancel_cutoff_min, t.noshow_window_min,
        ],
      );
      created += rowCount ?? 0;
    }
  });
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.sessions_generated', resourceType: 'class_template', resourceId: templateId, afterState: { created, fromDate, toDate } });
  return { created };
}

export interface OneOffSessionInput {
  name: string;
  startsAt: string;
  endsAt?: string;
  durationMin?: number;
  locationId?: string | null;
  discipline?: string | null;
  instructorId?: string | null;
  roomId?: string | null;
  capacity?: number;
  creditsRequired?: number;
  priceDropIn?: number;
  bookingWindowHours?: number;
  cancelCutoffMin?: number;
  noshowWindowMin?: number;
}

export async function createOneOffSession(orgId: string, employeeId: string, input: OneOffSessionInput): Promise<ClassSession> {
  if (!(await schedulingReady())) throw new ValidationError(NOT_PROVISIONED);
  if (!input.name?.trim()) throw new ValidationError('Session name is required');
  if (!input.startsAt) throw new ValidationError('startsAt is required');
  const dur = input.durationMin ?? 60;
  const { rows: [s] } = await query<ClassSession>(
    `INSERT INTO class_sessions
       (organization_id, location_id, template_id, name, discipline, starts_at, ends_at,
        instructor_id, room_id, capacity, credits_required, price_drop_in, status,
        booking_opens_at, booking_closes_at, cancel_cutoff_min, noshow_window_min)
     VALUES ($1,$2,NULL,$3,$4,$5::timestamptz,
             COALESCE($6::timestamptz, $5::timestamptz + ($7 * interval '1 minute')),
             $8,$9,$10,$11,$12,'scheduled',
             $5::timestamptz - ($13 * interval '1 hour'), $5::timestamptz, $14, $15)
     RETURNING *`,
    [
      orgId, input.locationId ?? null, input.name.trim(), input.discipline ?? null,
      input.startsAt, input.endsAt ?? null, dur, input.instructorId ?? null, input.roomId ?? null,
      input.capacity ?? 0, input.creditsRequired ?? 1, input.priceDropIn ?? 0,
      input.bookingWindowHours ?? 168, input.cancelCutoffMin ?? 720, input.noshowWindowMin ?? 15,
    ],
  );
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.session_created', resourceType: 'class_session', resourceId: s.id });
  return s;
}

/**
 * List upcoming sessions with live availability. Single query, no N+1: reservation
 * and waitlist counts are pre-aggregated in subqueries and joined once.
 */
export async function listSessions(orgId: string, params: { locationId?: string; from?: string; to?: string } = {}): Promise<ClassSessionWithAvailability[]> {
  if (!(await schedulingReady())) return [];
  const { rows } = await query<ClassSessionWithAvailability>(
    `SELECT s.*,
            COALESCE(r.booked_count, 0)::int   AS booked_count,
            GREATEST(s.capacity - COALESCE(r.booked_count, 0), 0)::int AS available,
            COALESCE(w.waitlist_count, 0)::int AS waitlist_count
       FROM class_sessions s
       LEFT JOIN (
         SELECT session_id, COUNT(*) AS booked_count FROM class_reservations
          WHERE organization_id = $1 AND deleted_at IS NULL
            AND state IN ('booked','checked_in','completed')
          GROUP BY session_id
       ) r ON r.session_id = s.id
       LEFT JOIN (
         SELECT session_id, COUNT(*) AS waitlist_count FROM class_waitlist
          WHERE organization_id = $1 AND deleted_at IS NULL
          GROUP BY session_id
       ) w ON w.session_id = s.id
      WHERE s.organization_id = $1
        AND ($2::uuid IS NULL OR s.location_id = $2)
        AND s.starts_at >= COALESCE($3::timestamptz, now())
        AND s.starts_at <  COALESCE($4::timestamptz, now() + interval '14 days')
        AND s.status <> 'cancelled'
      ORDER BY s.starts_at ASC
      LIMIT 500`,
    [orgId, params.locationId ?? null, params.from ?? null, params.to ?? null],
  );
  return rows;
}

export async function getSession(orgId: string, sessionId: string): Promise<ClassSession> {
  if (!(await schedulingReady())) throw new NotFoundError('Session');
  const { rows: [s] } = await query<ClassSession>(
    `SELECT * FROM class_sessions WHERE id = $1 AND organization_id = $2`, [sessionId, orgId],
  );
  if (!s) throw new NotFoundError('Session');
  return s;
}

/**
 * Cancel a session: set status=cancelled, release its active reservations, and restore
 * any credit spent (studio-fault cancellation). Reuses memberCredit.restoreCredit (no
 * new credit math). Claim-then-restore: each reservation is soft-deleted inside the txn
 * (so re-running can't double-restore); the credit is then restored.
 */
export async function cancelSession(orgId: string, employeeId: string, sessionId: string): Promise<{ released: number; creditsRestored: number }> {
  if (!(await schedulingReady())) throw new NotFoundError('Session');
  const claimed = await withTransaction(async (client) => {
    const { rows: [s] } = await client.query<{ id: string }>(
      `UPDATE class_sessions SET status = 'cancelled', updated_at = now()
        WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [sessionId, orgId],
    );
    if (!s) throw new NotFoundError('Session');
    const { rows } = await client.query<{ id: string; credit_txn_id: string | null; credits_required: number }>(
      `UPDATE class_reservations r
          SET deleted_at = now(), updated_at = now()
         FROM class_sessions cs
        WHERE r.session_id = $1 AND r.organization_id = $2
          AND cs.id = r.session_id
          AND r.state IN ('booked','checked_in') AND r.deleted_at IS NULL
        RETURNING r.id, r.credit_txn_id, cs.credits_required`,
      [sessionId, orgId],
    );
    return rows;
  });

  let creditsRestored = 0;
  for (const r of claimed) {
    if (r.credit_txn_id && r.credits_required > 0) {
      const res = await restoreCredit(orgId, employeeId, r.credit_txn_id, r.credits_required);
      if (res) creditsRestored++;
    }
  }
  void createAuditLog({ organizationId: orgId, actorId: employeeId, action: 'studio.session_cancelled', resourceType: 'class_session', resourceId: sessionId, afterState: { released: claimed.length, creditsRestored } });
  return { released: claimed.length, creditsRestored };
}
