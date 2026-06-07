/**
 * SchedulePage — /schedule (S9-02). Manager/owner only.
 *
 * Weekly grid (employees × Mon-Sun) with shift chips, add/remove shifts,
 * "✨ Suggest schedule with AI" (preview → Apply), and a live labor-cost
 * tracker vs the demand forecast (green <30%, amber 30-35%, red >35%).
 * Drag-to-move/resize is a future enhancement.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, CalendarDays, Sparkles, Loader2, Plus, X, Save, Clock,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  schedules, employees as employeesApi, timeclock, intelligence,
  type ShiftInput, type ShiftRow, type EmployeeListRow,
} from '../lib/api';
import { getLocationId } from '../lib/session';
import { showToast } from '../components/ui/Toast';

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday of the week containing `d` (local). */
function mondayOf(d: Date): string {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - ((day + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function weekDates(weekStart: string): string[] {
  const base = new Date(`${weekStart}T12:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let h = (eh + em / 60) - (sh + sm / 60);
  if (h <= 0) h += 24;
  return h;
}

/** Local editable shift (no id = unsaved). */
interface EditShift extends ShiftInput { key: string; employeeName: string }

let keyCounter = 0;
const nextKey = () => `s${++keyCounter}`;

export function SchedulePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locationId = getLocationId();

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [draft, setDraft] = useState<EditShift[] | null>(null); // null = mirror server
  const [adding, setAdding] = useState<{ employeeId: string; date: string } | null>(null);
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const { data: emps } = useQuery({ queryKey: ['employees'], queryFn: employeesApi.list });
  const { data: serverShifts, isLoading } = useQuery({
    queryKey: ['schedules', weekStart],
    queryFn: () => schedules.list(weekStart),
  });
  // Forecast revenue for labor % (from S5 staffing plan — same horizon)
  const { data: staffing } = useQuery({
    queryKey: ['intelligence', 'staffing'],
    queryFn: () => intelligence.staffing(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const roster = (emps ?? []).filter((e) => e.role !== 'readonly');
  const rateOf = (id: string) => {
    const e = roster.find((r) => r.id === id);
    return e?.hourly_rate ? Math.round(Number(e.hourly_rate) * 100) : 1500;
  };

  // Effective shifts = local draft (if editing) else server rows mapped
  const shifts: EditShift[] = useMemo(() => {
    if (draft) return draft;
    return (serverShifts ?? []).map((s: ShiftRow) => ({
      key: s.id,
      employeeId: s.employee_id,
      employeeName: s.employee_name ?? '',
      locationId: s.location_id,
      shiftDate: s.shift_date,
      shiftStart: s.shift_start,
      shiftEnd: s.shift_end,
      role: s.role,
      aiSuggested: s.ai_suggested,
    }));
  }, [draft, serverShifts]);

  const dirty = draft !== null;

  // Labor tracker
  const laborCents = Math.round(shifts.reduce((s, x) => s + shiftHours(x.shiftStart, x.shiftEnd) * rateOf(x.employeeId), 0));
  const forecastRevenue = (staffing?.days ?? []).reduce((s, d) => s + d.predictedSales, 0);
  const laborPct = forecastRevenue > 0 ? Math.round((laborCents / forecastRevenue) * 1000) / 10 : null;

  // ── Mutations ───────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: () => schedules.saveWeek(weekStart, shifts.map(({ key: _k, employeeName: _n, ...rest }) => rest)),
    onSuccess: (r) => {
      showToast.success(`Schedule saved — ${r.saved} shifts`);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['schedules', weekStart] });
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const suggest = useMutation({
    mutationFn: () => schedules.aiSuggestion(weekStart, locationId),
    onSuccess: (s) => {
      setDraft(s.shifts.map((sh) => ({
        key: nextKey(),
        employeeId: sh.employeeId,
        employeeName: sh.employeeName,
        locationId,
        shiftDate: sh.shiftDate,
        shiftStart: sh.shiftStart,
        shiftEnd: sh.shiftEnd,
        role: sh.role,
        aiSuggested: true,
      })));
      showToast.success(s.aiUsed ? 'AI schedule ready — review and apply' : 'Suggested schedule ready (statistical)');
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Suggestion failed'),
  });

  const addShift = (employeeId: string, date: string, start: string, end: string) => {
    const emp = roster.find((r) => r.id === employeeId);
    setDraft([
      ...shifts,
      {
        key: nextKey(), employeeId,
        employeeName: emp ? `${emp.first_name} ${emp.last_name}` : '',
        locationId, shiftDate: date, shiftStart: start, shiftEnd: end, role: null,
      },
    ]);
  };

  const removeShift = (key: string) => setDraft(shifts.filter((s) => s.key !== key));

  const stepWeek = (dir: 1 | -1) => {
    const d = new Date(`${weekStart}T12:00:00`);
    d.setDate(d.getDate() + dir * 7);
    setWeekStart(mondayOf(d));
    setDraft(null);
  };

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ChevronLeft size={14} /> Register
          </button>
          <CalendarDays size={18} className="text-primary ml-2" />
          <h1 className="text-base font-bold text-gray-900">Schedule</h1>

          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => stepWeek(-1)} className="p-1.5 rounded hover:bg-gray-100"><ChevronLeft size={14} className="text-gray-500" /></button>
            <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">
              Week of {new Date(`${weekStart}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
            <button onClick={() => stepWeek(1)} className="p-1.5 rounded hover:bg-gray-100"><ChevronRight size={14} className="text-gray-500" /></button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Labor tracker */}
            {shifts.length > 0 && (
              <span className={clsx('text-xs font-semibold px-2.5 py-1.5 rounded-lg',
                laborPct == null ? 'bg-gray-100 text-gray-500'
                  : laborPct < 30 ? 'bg-green-50 text-green-700'
                  : laborPct <= 35 ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700')}>
                Projected labor: {fmt(laborCents)}{laborPct != null ? ` (${laborPct}% of forecast)` : ''}
              </span>
            )}
            <button onClick={() => suggest.mutate()} disabled={suggest.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
              {suggest.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Suggest schedule with AI
            </button>
            {dirty && (
              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {shifts.some((s) => s.aiSuggested) ? 'Apply AI Schedule' : 'Save week'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {isLoading ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : roster.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
              <p className="text-sm text-gray-500 mb-1">No staff yet</p>
              <p className="text-xs text-gray-400">Add employees in Settings → Employees to build a schedule.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2 w-44">Employee</th>
                    {dates.map((d, i) => (
                      <th key={d} className="text-center font-medium px-1 py-2">
                        {DAY_LABELS[i]}<br />
                        <span className="text-[10px] text-gray-300">{new Date(`${d}T12:00:00`).getDate()}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((emp: EmployeeListRow) => (
                    <tr key={emp.id} className="border-b border-gray-50 last:border-0 align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-800 truncate">{emp.first_name} {emp.last_name}</p>
                        <p className="text-[10px] text-gray-400 capitalize">{emp.role}{emp.hourly_rate ? ` · $${Number(emp.hourly_rate).toFixed(2)}/hr` : ''}</p>
                      </td>
                      {dates.map((d) => {
                        const cellShifts = shifts.filter((s) => s.employeeId === emp.id && s.shiftDate === d);
                        return (
                          <td key={d} className="px-1 py-1.5 text-center">
                            <div className="space-y-1">
                              {cellShifts.map((s) => (
                                <div key={s.key}
                                  className={clsx('group relative rounded-md px-1.5 py-1 text-[11px] font-medium',
                                    s.aiSuggested ? 'bg-primary/10 text-primary-dark border border-primary/20' : 'bg-gray-100 text-gray-700')}>
                                  {s.shiftStart}–{s.shiftEnd}
                                  <button onClick={() => removeShift(s.key)}
                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-gray-200 items-center justify-center hidden group-hover:flex">
                                    <X size={9} className="text-gray-500" />
                                  </button>
                                </div>
                              ))}
                              <button onClick={() => setAdding({ employeeId: emp.id, date: d })}
                                className="w-full py-0.5 rounded text-gray-300 hover:text-primary hover:bg-primary/5 transition-colors">
                                <Plus size={11} className="mx-auto" />
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {dirty && (
            <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
              <Clock size={11} /> Unsaved changes — “{shifts.some((s) => s.aiSuggested) ? 'Apply AI Schedule' : 'Save week'}” writes the whole week.
            </p>
          )}
        </div>
      </main>

      {/* Add-shift modal */}
      {adding && (
        <AddShiftModal
          employeeName={(() => { const e = roster.find((r) => r.id === adding.employeeId); return e ? `${e.first_name} ${e.last_name}` : ''; })()}
          date={adding.date}
          onClose={() => setAdding(null)}
          onAdd={(start, end) => { addShift(adding.employeeId, adding.date, start, end); setAdding(null); }}
        />
      )}
    </div>
  );
}

function AddShiftModal({ employeeName, date, onClose, onAdd }: {
  employeeName: string; date: string;
  onClose: () => void; onAdd: (start: string, end: string) => void;
}) {
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('18:00');
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xs max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Add shift</h2>
          <p className="text-xs text-gray-400">{employeeName} · {new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Start</label>
            <input type="time" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">End</label>
            <input type="time" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => onAdd(start, end)} disabled={!start || !end}
            className="flex-1 h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
