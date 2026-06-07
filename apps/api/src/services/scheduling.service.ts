/**
 * scheduling.service — time clock + weekly schedules + AI schedule suggestion
 * (S9-02).
 *
 * Time clock: clock-in/out per employee; hours + labor cost computed at
 * clock-out from employees.hourly_rate (dollars in that column; labor_cost
 * stored in dollars to match — converted to cents at the API boundary).
 *
 * AI suggestion: 7-day staffing plan (S5-02 deterministic forecast) + roster
 * → Claude proposes shifts targeting 30% labor; deterministic fallback
 * round-robins the roster across recommended staff counts.
 *
 * RESILIENCE: migration 021 may be pending — every entry point checks
 * timeClockReady() and degrades (empty lists / clear ValidationError).
 */

import { query } from '../db/client';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { askClaudeJSON, aiAvailable, cacheGet, cacheSet } from './ai.service';
import { getStaffingPlan } from './intelligence.service';

const MIGRATION_MSG = 'Time clock & scheduling require migration 021 — ask your administrator to run pending migrations.';

// ─── Migration-pending resilience ─────────────────────────────────────────────

let _ready: boolean | null = null;

export async function timeClockReady(): Promise<boolean> {
  if (_ready !== null) return _ready;
  const { rows } = await query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables WHERE table_name = 'time_clock_entries'
     ) AS ready`,
  );
  _ready = Boolean(rows[0]?.ready);
  return _ready;
}

// ─── Time clock ───────────────────────────────────────────────────────────────

export interface TimeClockEntry {
  id: string;
  employee_id: string;
  employee_name?: string;
  location_id: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  break_minutes: number;
  hours_worked: number | null;
  labor_cost_cents: number | null;
}

export async function clockIn(orgId: string, employeeId: string, locationId: string): Promise<TimeClockEntry> {
  if (!(await timeClockReady())) throw new ValidationError(MIGRATION_MSG);
  if (!locationId) throw new ValidationError('locationId is required');

  const { rows: [open] } = await query<{ id: string }>(
    `SELECT id FROM time_clock_entries
      WHERE organization_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL`,
    [orgId, employeeId],
  );
  if (open) throw new ConflictError('Already clocked in — clock out first');

  const { rows: [entry] } = await query<TimeClockEntry>(
    `INSERT INTO time_clock_entries (organization_id, employee_id, location_id)
     VALUES ($1, $2, $3)
     RETURNING id, employee_id, location_id, clocked_in_at, clocked_out_at, break_minutes,
               hours_worked, NULL::numeric AS labor_cost_cents`,
    [orgId, employeeId, locationId],
  );
  return entry;
}

export async function clockOut(orgId: string, employeeId: string, breakMinutes = 0): Promise<TimeClockEntry> {
  if (!(await timeClockReady())) throw new ValidationError(MIGRATION_MSG);

  const { rows: [open] } = await query<{ id: string; clocked_in_at: string }>(
    `SELECT id, clocked_in_at FROM time_clock_entries
      WHERE organization_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL
      ORDER BY clocked_in_at DESC LIMIT 1`,
    [orgId, employeeId],
  );
  if (!open) throw new NotFoundError('No open shift to clock out of');

  const breaks = Math.max(0, Math.trunc(breakMinutes) || 0);

  // hourly_rate is dollars (migration 014); labor_cost stored in dollars
  const { rows: [entry] } = await query<TimeClockEntry & { labor_cost: string | null }>(
    `UPDATE time_clock_entries t
        SET clocked_out_at = now(),
            break_minutes  = $3,
            hours_worked   = ROUND(GREATEST(0,
              EXTRACT(EPOCH FROM (now() - t.clocked_in_at)) / 3600.0 - $3 / 60.0)::numeric, 2),
            hourly_rate    = e.hourly_rate,
            labor_cost     = ROUND((GREATEST(0,
              EXTRACT(EPOCH FROM (now() - t.clocked_in_at)) / 3600.0 - $3 / 60.0)
              * COALESCE(e.hourly_rate, 0))::numeric, 2)
       FROM employees e
      WHERE t.id = $1 AND t.organization_id = $2 AND e.id = t.employee_id
      RETURNING t.id, t.employee_id, t.location_id, t.clocked_in_at, t.clocked_out_at,
                t.break_minutes, t.hours_worked, t.labor_cost`,
    [open.id, orgId, breaks],
  );

  return {
    ...entry,
    hours_worked: entry.hours_worked == null ? null : Number(entry.hours_worked),
    labor_cost_cents: entry.labor_cost == null ? null : Math.round(Number(entry.labor_cost) * 100),
  };
}

export async function getCurrentEntry(orgId: string, employeeId: string): Promise<TimeClockEntry | null> {
  if (!(await timeClockReady())) return null;
  const { rows: [entry] } = await query<TimeClockEntry>(
    `SELECT id, employee_id, location_id, clocked_in_at, clocked_out_at, break_minutes,
            hours_worked, NULL::numeric AS labor_cost_cents
       FROM time_clock_entries
      WHERE organization_id = $1 AND employee_id = $2 AND clocked_out_at IS NULL
      ORDER BY clocked_in_at DESC LIMIT 1`,
    [orgId, employeeId],
  );
  return entry ?? null;
}

export interface TimeClockReport {
  entries: TimeClockEntry[];
  totalHours: number;
  totalLaborCostCents: number;
}

export async function getTimeClockReport(
  orgId: string, from: string, to: string, locationId?: string,
): Promise<TimeClockReport> {
  if (!(await timeClockReady())) return { entries: [], totalHours: 0, totalLaborCostCents: 0 };

  const params: unknown[] = [orgId, from, to];
  let lc = '';
  if (locationId) { params.push(locationId); lc = `AND t.location_id = $${params.length}`; }

  const { rows } = await query<TimeClockEntry & { labor_cost: string | null; employee_name: string }>(
    `SELECT t.id, t.employee_id, e.first_name || ' ' || e.last_name AS employee_name,
            t.location_id, t.clocked_in_at, t.clocked_out_at, t.break_minutes,
            t.hours_worked, t.labor_cost
       FROM time_clock_entries t
       JOIN employees e ON e.id = t.employee_id
      WHERE t.organization_id = $1
        AND t.clocked_in_at >= $2::timestamptz AND t.clocked_in_at < $3::timestamptz ${lc}
      ORDER BY t.clocked_in_at DESC`,
    params,
  );

  const entries = rows.map((r) => ({
    ...r,
    hours_worked: r.hours_worked == null ? null : Number(r.hours_worked),
    labor_cost_cents: r.labor_cost == null ? null : Math.round(Number(r.labor_cost) * 100),
  }));

  return {
    entries,
    totalHours: Math.round(entries.reduce((s, e) => s + (e.hours_worked ?? 0), 0) * 100) / 100,
    totalLaborCostCents: entries.reduce((s, e) => s + (e.labor_cost_cents ?? 0), 0),
  };
}

// ─── Schedules ────────────────────────────────────────────────────────────────

export interface ShiftRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  location_id: string;
  shift_date: string;     // YYYY-MM-DD
  shift_start: string;    // HH:MM
  shift_end: string;      // HH:MM
  role: string | null;
  ai_suggested: boolean;
}

export interface ShiftInput {
  employeeId: string;
  locationId: string;
  shiftDate: string;    // YYYY-MM-DD
  shiftStart: string;   // HH:MM
  shiftEnd: string;     // HH:MM
  role?: string | null;
  aiSuggested?: boolean;
}

function assertWeekStart(week: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new ValidationError('week must be YYYY-MM-DD');
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function listSchedules(orgId: string, weekStart: string, locationId?: string): Promise<ShiftRow[]> {
  assertWeekStart(weekStart);
  if (!(await timeClockReady())) return [];

  const params: unknown[] = [orgId, weekStart];
  let lc = '';
  if (locationId) { params.push(locationId); lc = `AND s.location_id = $${params.length}`; }

  const { rows } = await query<ShiftRow>(
    `SELECT s.id, s.employee_id, e.first_name || ' ' || e.last_name AS employee_name,
            s.location_id, to_char(s.shift_date, 'YYYY-MM-DD') AS shift_date,
            to_char(s.shift_start, 'HH24:MI') AS shift_start,
            to_char(s.shift_end, 'HH24:MI') AS shift_end,
            s.role, s.ai_suggested
       FROM schedules s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.organization_id = $1
        AND s.shift_date >= $2::date AND s.shift_date < $2::date + 7 ${lc}
      ORDER BY s.shift_date ASC, s.shift_start ASC`,
    params,
  );
  return rows;
}

/** Replace the week's schedule (delete + insert — the editor saves whole weeks). */
export async function saveWeekSchedule(
  orgId: string, weekStart: string, shifts: ShiftInput[],
): Promise<{ saved: number }> {
  assertWeekStart(weekStart);
  if (!(await timeClockReady())) throw new ValidationError(MIGRATION_MSG);
  if (shifts.length > 200) throw new ValidationError('Too many shifts for one week');

  for (const s of shifts) {
    if (!s.employeeId || !s.locationId) throw new ValidationError('Each shift needs employeeId and locationId');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.shiftDate)) throw new ValidationError('shiftDate must be YYYY-MM-DD');
    if (!TIME_RE.test(s.shiftStart) || !TIME_RE.test(s.shiftEnd)) {
      throw new ValidationError('shiftStart/shiftEnd must be HH:MM (24h)');
    }
  }

  await query(
    `DELETE FROM schedules
      WHERE organization_id = $1 AND shift_date >= $2::date AND shift_date < $2::date + 7`,
    [orgId, weekStart],
  );

  for (const s of shifts) {
    await query(
      `INSERT INTO schedules
         (organization_id, employee_id, location_id, shift_date, shift_start, shift_end, role, ai_suggested)
       VALUES ($1, $2, $3, $4::date, $5::timetz, $6::timetz, $7, $8)`,
      [orgId, s.employeeId, s.locationId, s.shiftDate, s.shiftStart, s.shiftEnd, s.role ?? null, s.aiSuggested ?? false],
    );
  }

  return { saved: shifts.length };
}

// ─── AI schedule suggestion ───────────────────────────────────────────────────

export interface SuggestedShift {
  employeeId: string;
  employeeName: string;
  shiftDate: string;
  shiftStart: string;
  shiftEnd: string;
  role: string | null;
}

export interface ScheduleSuggestion {
  weekStart: string;
  shifts: SuggestedShift[];
  projectedLaborCostCents: number;
  projectedRevenueCents: number;
  laborPct: number;
  narrative: string;
  aiUsed: boolean;
  generatedAt: string;
}

interface RosterEmployee { id: string; name: string; role: string; hourlyRateCents: number }

async function getRoster(orgId: string): Promise<RosterEmployee[]> {
  const { rows } = await query<{ id: string; name: string; role: string; hourly_rate: string | null }>(
    `SELECT id, first_name || ' ' || last_name AS name, role, hourly_rate
       FROM employees
      WHERE organization_id = $1 AND deleted_at IS NULL AND role <> 'readonly'
      ORDER BY (role = 'owner') DESC, name ASC`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, role: r.role,
    hourlyRateCents: r.hourly_rate ? Math.round(Number(r.hourly_rate) * 100) : 1500,
  }));
}

function weekDates(weekStart: string): string[] {
  const base = new Date(`${weekStart}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setUTCDate(base.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let h = (eh + em / 60) - (sh + sm / 60);
  if (h <= 0) h += 24;
  return h;
}

function fallbackSchedule(
  weekStart: string,
  roster: RosterEmployee[],
  staffPerDow: Map<string, { staff: number; sales: number }>,
): { shifts: SuggestedShift[]; revenue: number } {
  const shifts: SuggestedShift[] = [];
  let revenue = 0;
  let cursor = 0;
  for (const date of weekDates(weekStart)) {
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];
    const plan = staffPerDow.get(dow) ?? { staff: 2, sales: 0 };
    revenue += plan.sales;
    for (let i = 0; i < Math.min(plan.staff, Math.max(1, roster.length)); i++) {
      const emp = roster[cursor % roster.length];
      cursor++;
      // Alternate opening and closing shifts
      const opening = i % 2 === 0;
      shifts.push({
        employeeId: emp.id, employeeName: emp.name, shiftDate: date,
        shiftStart: opening ? '10:00' : '15:00',
        shiftEnd:   opening ? '18:00' : '22:00',
        role: emp.role === 'kitchen' ? 'kitchen' : 'server',
      });
    }
  }
  return { shifts, revenue };
}

interface ClaudeShift { employeeId?: string; shiftDate?: string; shiftStart?: string; shiftEnd?: string; role?: string }

export async function getAIScheduleSuggestion(
  orgId: string, locationId: string, weekStart: string, timezone = 'UTC',
): Promise<ScheduleSuggestion> {
  assertWeekStart(weekStart);

  const cacheKey = `ai:schedule:${orgId}:${locationId}:${weekStart}`;
  const cached = await cacheGet<ScheduleSuggestion>(cacheKey);
  if (cached) return cached;

  const [plan, roster] = await Promise.all([
    getStaffingPlan(orgId, locationId, timezone),
    getRoster(orgId),
  ]);
  if (!roster.length) throw new ValidationError('Add employees before generating a schedule');

  const staffPerDow = new Map(plan.days.map((d) => [d.dow, { staff: d.recommendedStaff, sales: d.predictedSales }]));
  const fallback = fallbackSchedule(weekStart, roster, staffPerDow);

  let shifts = fallback.shifts;
  let aiUsed = false;
  let narrative = `Schedule built from your demand forecast: ${shifts.length} shifts across the week, targeting ${plan.targetPct}% labor.`;

  if (aiAvailable()) {
    const ai = await askClaudeJSON<{ shifts?: ClaudeShift[]; narrative?: string }>(
      'You are a restaurant scheduling assistant. Given a weekly demand forecast and an employee roster, suggest an optimal schedule. Minimize labor cost while maintaining service quality. Target labor cost: 30% of revenue. Return ONLY valid JSON.',
      `Week starting ${weekStart} (dates: ${weekDates(weekStart).join(', ')}).
Demand forecast per day-of-week (sales in CENTS): ${JSON.stringify(plan.days)}
Roster: ${JSON.stringify(roster.map((r) => ({ employeeId: r.id, name: r.name, role: r.role, hourlyRateCents: r.hourlyRateCents })))}

Return JSON:
{
  "shifts": [{ "employeeId": string, "shiftDate": "YYYY-MM-DD", "shiftStart": "HH:MM", "shiftEnd": "HH:MM", "role": string }],
  "narrative": "2 short sentences on the scheduling strategy"
}
Rules: only employeeIds from the roster; shiftDate within the listed week; 24h HH:MM times; typical shifts 6-9 hours.`,
      2048,
    );

    const byId = new Map(roster.map((r) => [r.id, r]));
    const weekSet = new Set(weekDates(weekStart));
    const valid = (ai?.shifts ?? []).filter((s): s is Required<ClaudeShift> =>
      typeof s?.employeeId === 'string' && byId.has(s.employeeId) &&
      typeof s?.shiftDate === 'string' && weekSet.has(s.shiftDate) &&
      typeof s?.shiftStart === 'string' && TIME_RE.test(s.shiftStart) &&
      typeof s?.shiftEnd === 'string' && TIME_RE.test(s.shiftEnd));

    if (valid.length >= 3) {
      shifts = valid.map((s) => ({
        employeeId: s.employeeId,
        employeeName: byId.get(s.employeeId)!.name,
        shiftDate: s.shiftDate,
        shiftStart: s.shiftStart,
        shiftEnd: s.shiftEnd,
        role: typeof s.role === 'string' ? s.role : null,
      }));
      if (ai?.narrative) narrative = ai.narrative;
      aiUsed = true;
    }
  }

  // Projected labor cost from shift hours × each employee's rate
  const rateById = new Map(roster.map((r) => [r.id, r.hourlyRateCents]));
  const projectedLaborCostCents = Math.round(shifts.reduce((sum, s) =>
    sum + shiftHours(s.shiftStart, s.shiftEnd) * (rateById.get(s.employeeId) ?? 1500), 0));
  const projectedRevenueCents = fallback.revenue;
  const laborPct = projectedRevenueCents > 0
    ? Math.round((projectedLaborCostCents / projectedRevenueCents) * 1000) / 10
    : 0;

  const result: ScheduleSuggestion = {
    weekStart, shifts, projectedLaborCostCents, projectedRevenueCents, laborPct,
    narrative, aiUsed, generatedAt: new Date().toISOString(),
  };
  await cacheSet(cacheKey, result, 4 * 60 * 60);
  return result;
}
