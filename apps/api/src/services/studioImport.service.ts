/**
 * studioImport.service — Mindbody / Mariana Tek migration importer (v2.2).
 *
 * The wedge: get a studio's members + schedule off the incumbent and into Taproot.
 * Mirrors the existing import shape (parse → DRY-RUN diff → commit) but is a focused,
 * SYNCHRONOUS service (no import_jobs queue) — it reuses csv-parse/sync and the v2.1/
 * v2.2 services (member.service, studioSchedule.service) to create records, with the
 * per-row try/catch + tally pattern from importJob.service. NO blind writes: a dry-run
 * diff (adds / already-present / invalid) is returned before any commit (spec §5.6).
 *
 * SCOPE: members + class schedule. Card vault is OUT OF SCOPE (PCI/contractual — flagged,
 * never attempted). Pack-balance import is a documented follow-up (needs member matching).
 * Studio-gated at the route layer; member/schedule writes graceful-guard their tables.
 */
import { parse as csvParse } from 'csv-parse/sync';
import { query } from '../db/client';
import { ValidationError } from '../errors';
import * as MemberSvc from './member.service';
import * as SchedSvc from './studioSchedule.service';

export type ImportProvider = 'mindbody' | 'mariana_tek';
export type ImportKind = 'members' | 'schedule';

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

interface ParsedRow { [k: string]: string }

function parse(csvText: string): ParsedRow[] {
  if (!csvText?.trim()) throw new ValidationError('CSV is empty');
  try {
    return csvParse(csvText, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }) as ParsedRow[];
  } catch (err) {
    throw new ValidationError(`Could not parse CSV: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Find a row value by header keyword(s), case-insensitive substring match. */
function pick(row: ParsedRow, ...keywords: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const kw of keywords) {
    const hit = keys.find((k) => k.toLowerCase().includes(kw));
    if (hit && row[hit]?.trim()) return row[hit].trim();
  }
  return undefined;
}

// ── Members ──
interface MemberRow { displayName?: string; email?: string; phone?: string }
function extractMember(row: ParsedRow): MemberRow {
  const first = pick(row, 'first');
  const last = pick(row, 'last');
  const full = pick(row, 'name', 'client');
  const displayName = [first, last].filter(Boolean).join(' ') || full;
  return { displayName, email: pick(row, 'email')?.toLowerCase(), phone: pick(row, 'phone', 'mobile', 'cell') };
}

// ── Schedule ──
interface ScheduleRow { name?: string; day?: number; time?: string; durationMin?: number; capacity?: number }
function extractSchedule(row: ParsedRow): ScheduleRow {
  const name = pick(row, 'class', 'name', 'service');
  const dayRaw = pick(row, 'day', 'weekday');
  const day = dayRaw ? DAY_NAMES[dayRaw.toLowerCase().slice(0, 9)] ?? DAY_NAMES[dayRaw.toLowerCase().slice(0, 3)] : undefined;
  let time = pick(row, 'time', 'start');
  if (time) { const m = time.match(/(\d{1,2}):(\d{2})/); time = m ? `${m[1].padStart(2, '0')}:${m[2]}` : undefined; }
  const dur = pick(row, 'duration', 'length'); const cap = pick(row, 'capacity', 'spots', 'max');
  return { name, day, time, durationMin: dur ? parseInt(dur, 10) : undefined, capacity: cap ? parseInt(cap, 10) : undefined };
}

export interface DryRunResult {
  kind: ImportKind;
  provider: ImportProvider;
  total: number;
  toCreate: number;
  alreadyPresent: number;
  invalid: number;
  sample: Array<Record<string, unknown>>;
  notes: string[];
}

export async function dryRun(orgId: string, provider: ImportProvider, kind: ImportKind, csvText: string): Promise<DryRunResult> {
  const rows = parse(csvText);
  const notes: string[] = ['Card/payment vaults are NOT imported (PCI/contractual — out of scope).'];

  if (kind === 'members') {
    const parsed = rows.map(extractMember);
    const emails = parsed.map((m) => m.email).filter((e): e is string => !!e);
    const existing = new Set<string>();
    if (emails.length) {
      const { rows: ex } = await query<{ email: string }>(
        `SELECT lower(email) AS email FROM members WHERE organization_id = $1 AND email = ANY($2::text[]) AND deleted_at IS NULL`,
        [orgId, emails],
      ).catch(() => ({ rows: [] as { email: string }[] }));
      ex.forEach((e) => existing.add(e.email));
    }
    let toCreate = 0, present = 0, invalid = 0;
    const sample: Array<Record<string, unknown>> = [];
    for (const m of parsed) {
      if (!m.displayName && !m.email && !m.phone) { invalid++; continue; }
      const dupe = m.email ? existing.has(m.email) : false;
      if (dupe) present++; else toCreate++;
      if (sample.length < 10) sample.push({ name: m.displayName ?? '—', email: m.email ?? '—', phone: m.phone ?? '—', action: dupe ? 'skip (present)' : 'create' });
    }
    return { kind, provider, total: parsed.length, toCreate, alreadyPresent: present, invalid, sample, notes };
  }

  // schedule
  const parsed = rows.map(extractSchedule);
  const { rows: existingT } = await query<{ name: string }>(
    `SELECT lower(name) AS name FROM class_templates WHERE organization_id = $1 AND deleted_at IS NULL`, [orgId],
  ).catch(() => ({ rows: [] as { name: string }[] }));
  const existingNames = new Set(existingT.map((t) => t.name));
  let toCreate = 0, present = 0, invalid = 0;
  const sample: Array<Record<string, unknown>> = [];
  for (const s of parsed) {
    if (!s.name) { invalid++; continue; }
    const dupe = existingNames.has(s.name.toLowerCase());
    if (dupe) present++; else toCreate++;
    if (sample.length < 10) sample.push({ name: s.name, day: s.day, time: s.time ?? '—', capacity: s.capacity ?? '—', action: dupe ? 'skip (present)' : 'create' });
  }
  notes.push('Schedule rows become recurring class templates; run "Generate" afterward to create dated sessions.');
  return { kind, provider, total: parsed.length, toCreate, alreadyPresent: present, invalid, sample, notes };
}

export interface CommitResult { created: number; skipped: number; failed: number; errors: string[] }

export async function commit(orgId: string, employeeId: string, provider: ImportProvider, kind: ImportKind, csvText: string): Promise<CommitResult> {
  const rows = parse(csvText);
  const result: CommitResult = { created: 0, skipped: 0, failed: 0, errors: [] };

  if (kind === 'members') {
    for (const row of rows) {
      const m = extractMember(row);
      try {
        if (!m.displayName && !m.email && !m.phone) { result.skipped++; continue; }
        if (m.email) {
          const { rows: dupe } = await query(`SELECT 1 FROM members WHERE organization_id = $1 AND lower(email) = $2 AND deleted_at IS NULL LIMIT 1`, [orgId, m.email]);
          if (dupe.length) { result.skipped++; continue; }
        }
        await MemberSvc.createMember(orgId, employeeId, { displayName: m.displayName, email: m.email, phone: m.phone, status: 'active' });
        result.created++;
      } catch (err) {
        result.failed++;
        result.errors.push(`${m.displayName ?? m.email ?? 'row'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return result;
  }

  // schedule → class templates
  for (const row of rows) {
    const s = extractSchedule(row);
    try {
      if (!s.name) { result.skipped++; continue; }
      await SchedSvc.createTemplate(orgId, employeeId, {
        name: s.name,
        durationMin: s.durationMin ?? 60,
        capacity: s.capacity ?? 0,
        recurrence: (s.day !== undefined && s.time) ? { freq: 'weekly', days: [s.day], time: s.time } : undefined,
      });
      result.created++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${s.name ?? 'row'}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
