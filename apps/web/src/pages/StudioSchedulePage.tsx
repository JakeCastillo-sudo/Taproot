/**
 * StudioSchedulePage — studio class calendar management (v2.2). Templates (create +
 * generate sessions), upcoming sessions with live availability, and a session drawer
 * (roster, staff check-in, book-on-behalf, cancel). Studio-gated via useRequireStudio.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Plus, X, Trash2, CheckCircle2, Search, Repeat, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { studioSchedule as schedApi, classBooking as bookApi, members as membersApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { useRequireStudio } from '../hooks/useCapabilities';
import type { ClassTemplate, ClassSessionWithAvailability, Member } from '@taproot/shared';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtCents = (c: number): string => `$${(c / 100).toFixed(2)}`;

export function StudioSchedulePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { ready, allowed } = useRequireStudio();
  const [tab, setTab] = useState<'sessions' | 'templates'>('sessions');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState(false);

  const sessionsQ = useQuery({ queryKey: ['studio-sessions'], queryFn: () => schedApi.sessions(), enabled: ready && allowed, retry: false });
  const templatesQ = useQuery({ queryKey: ['studio-templates'], queryFn: () => schedApi.templates(), enabled: ready && allowed, retry: false });

  if (!ready) return <div className="h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  if (!allowed) return null;

  const sessions = sessionsQ.data ?? [];
  const templates = templatesQ.data ?? [];
  const refreshSessions = (): void => void qc.invalidateQueries({ queryKey: ['studio-sessions'] });

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><CalendarDays size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Schedule</h1>
          </div>
          <div className="flex-1" />
          <button onClick={() => navigate('/studio/import')} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50"><Upload size={13} /> Import</button>
          {tab === 'templates' && <button onClick={() => setNewTemplate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark"><Plus size={14} /> New class</button>}
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-2 flex gap-2">
          {(['sessions', 'templates'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={clsx('px-3 py-1.5 rounded-md text-sm font-medium capitalize', tab === t ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:bg-gray-100')}>{t === 'sessions' ? 'Upcoming' : 'Classes'}</button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          {tab === 'sessions' ? (
            sessions.length === 0 ? (
              <div className="text-center py-16"><CalendarDays size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No upcoming sessions. Create a class, then generate sessions.</p></div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <button key={s.id} onClick={() => setDetailId(s.id)} className="w-full text-left bg-white rounded-lg border border-gray-100 px-4 py-3 hover:border-primary/40 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{s.name}</p>
                      <p className="text-xs text-gray-500">{fmtDateTime(s.starts_at)}{s.discipline ? ` · ${s.discipline}` : ''}</p>
                    </div>
                    <AvailabilityBadge s={s} />
                  </button>
                ))}
              </div>
            )
          ) : (
            <TemplatesTab templates={templates} onChanged={() => { void qc.invalidateQueries({ queryKey: ['studio-templates'] }); refreshSessions(); }} />
          )}
        </div>
      </main>

      {detailId && <SessionDrawer sessionId={detailId} session={sessions.find((x) => x.id === detailId) ?? null} onClose={() => setDetailId(null)} onChanged={refreshSessions} />}
      {newTemplate && <TemplateModal onClose={() => setNewTemplate(false)} onSaved={() => { setNewTemplate(false); void qc.invalidateQueries({ queryKey: ['studio-templates'] }); }} />}
    </div>
  );
}

function AvailabilityBadge({ s }: { s: ClassSessionWithAvailability }) {
  const full = s.capacity > 0 && s.available <= 0;
  return (
    <span className={clsx('text-xs px-2 py-0.5 rounded-full shrink-0', full ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
      {s.capacity > 0 ? `${s.booked_count}/${s.capacity}` : `${s.booked_count} booked`}{full ? ' · full' : ''}
    </span>
  );
}

function TemplatesTab({ templates, onChanged }: { templates: ClassTemplate[]; onChanged: () => void }) {
  const [generating, setGenerating] = useState<ClassTemplate | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => schedApi.deleteTemplate(id),
    onSuccess: () => { showToast.success('Class deleted'); onChanged(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  if (templates.length === 0) return <div className="text-center py-16"><Repeat size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No classes yet. Add a class to define a recurring class, then Generate to create dated sessions.</p></div>;
  return (
    <div className="space-y-2">
      {templates.map((t) => {
        const rec = t.recurrence as { days?: number[]; time?: string };
        return (
          <div key={t.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800">{t.name}</p>
              <p className="text-xs text-gray-500">
                {Array.isArray(rec.days) && rec.days.length ? `${rec.days.map((d) => DOW[d]).join(' ')} @ ${rec.time}` : 'No recurrence'}
                {' · '}{t.duration_min}min · cap {t.capacity} · {t.credits_required} credit{t.credits_required === 1 ? '' : 's'}
              </p>
            </div>
            <button onClick={() => setGenerating(t)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50">Generate</button>
            <button onClick={() => window.confirm('Delete this class?') && del.mutate(t.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
          </div>
        );
      })}
      {generating && <GenerateModal template={generating} onClose={() => setGenerating(null)} onDone={() => { setGenerating(null); onChanged(); }} />}
    </div>
  );
}

function GenerateModal({ template, onClose, onDone }: { template: ClassTemplate; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const in4w = new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10);
  const [fromDate, setFrom] = useState(today);
  const [toDate, setTo] = useState(in4w);
  const gen = useMutation({
    mutationFn: () => schedApi.generate(template.id, fromDate, toDate),
    onSuccess: (r) => { showToast.success(`Generated ${r.created} session${r.created === 1 ? '' : 's'}`); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm';
  return (
    <Modal title={`Generate "${template.name}"`} onClose={onClose}>
      <label className="block text-xs font-semibold text-gray-600">From<input type="date" className={field} value={fromDate} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="block text-xs font-semibold text-gray-600">To<input type="date" className={field} value={toDate} onChange={(e) => setTo(e.target.value)} /></label>
      <p className="text-xs text-gray-400">Re-generating the same range is safe — existing sessions are never duplicated.</p>
      <SaveBar onClose={onClose} onSave={() => gen.mutate()} saving={gen.isPending} label="Generate" />
    </Modal>
  );
}

function TemplateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', discipline: '', durationMin: '60', capacity: '12', creditsRequired: '1', priceDropIn: '', days: [] as number[], time: '18:00' });
  const toggleDay = (d: number): void => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));
  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error('Name is required');
      return schedApi.createTemplate({
        name: form.name.trim(),
        discipline: form.discipline.trim() || undefined,
        durationMin: parseInt(form.durationMin, 10) || 60,
        capacity: parseInt(form.capacity, 10) || 0,
        creditsRequired: parseInt(form.creditsRequired, 10) || 0,
        priceDropIn: form.priceDropIn.trim() ? Math.round(parseFloat(form.priceDropIn) * 100) : 0,
        recurrence: form.days.length ? { freq: 'weekly', days: form.days, time: form.time } : undefined,
      });
    },
    onSuccess: () => { showToast.success('Class created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm';
  return (
    <Modal title="New class" onClose={onClose}>
      <input className={field} placeholder="Name (e.g. 6pm Spin)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <input className={field} placeholder="Discipline (optional)" value={form.discipline} onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value }))} />
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-gray-500">Min<input className={field} inputMode="numeric" value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} /></label>
        <label className="text-xs text-gray-500">Capacity<input className={field} inputMode="numeric" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} /></label>
        <label className="text-xs text-gray-500">Credits<input className={field} inputMode="numeric" value={form.creditsRequired} onChange={(e) => setForm((f) => ({ ...f, creditsRequired: e.target.value }))} /></label>
      </div>
      <input className={field} placeholder="Drop-in price USD (optional)" inputMode="decimal" value={form.priceDropIn} onChange={(e) => setForm((f) => ({ ...f, priceDropIn: e.target.value }))} />
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">Repeats weekly on</p>
        <div className="flex gap-1">
          {DOW.map((d, i) => <button key={i} type="button" onClick={() => toggleDay(i)} className={clsx('w-9 h-9 rounded-md text-xs font-medium', form.days.includes(i) ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>{d}</button>)}
        </div>
        <input type="time" className={field + ' mt-2'} value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
      </div>
      <SaveBar onClose={onClose} onSave={() => save.mutate()} saving={save.isPending} label="Create" />
    </Modal>
  );
}

function SessionDrawer({ sessionId, session, onClose, onChanged }: { sessionId: string; session: ClassSessionWithAvailability | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [booking, setBooking] = useState(false);
  const rosterQ = useQuery({ queryKey: ['roster', sessionId], queryFn: () => bookApi.roster(sessionId), retry: false });
  const refresh = (): void => { void qc.invalidateQueries({ queryKey: ['roster', sessionId] }); onChanged(); };

  const checkIn = useMutation({ mutationFn: (id: string) => bookApi.checkIn(id), onSuccess: () => { showToast.success('Checked in'); refresh(); }, onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed') });
  const cancelRes = useMutation({ mutationFn: (id: string) => bookApi.cancel(id), onSuccess: (r) => { showToast.success(r.state === 'cancelled' ? 'Cancelled — credit restored' : 'Late cancel'); refresh(); }, onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed') });
  const cancelSession = useMutation({ mutationFn: () => schedApi.cancelSession(sessionId), onSuccess: (r) => { showToast.success(`Session cancelled — ${r.creditsRestored} credit(s) restored`); onChanged(); onClose(); }, onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed') });

  const roster = rosterQ.data ?? [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{session?.name ?? 'Session'}</h2>
            {session && <p className="text-xs text-gray-500">{fmtDateTime(session.starts_at)}{session.price_drop_in > 0 ? ` · drop-in ${fmtCents(session.price_drop_in)}` : ''}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Roster ({roster.length})</h3>
            <button onClick={() => setBooking(true)} className="text-sm text-primary font-medium">+ Book member</button>
          </div>
          {roster.length === 0 ? <p className="text-sm text-gray-400">No one booked yet</p> : roster.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50">
              <div className="min-w-0">
                <p className="text-sm text-gray-800 truncate">{r.member_name ?? r.member_email ?? 'Member'}</p>
                <p className="text-xs text-gray-400 capitalize">{r.state.replace('_', ' ')}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {r.state === 'booked' && <button onClick={() => checkIn.mutate(r.id)} className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> In</button>}
                {(r.state === 'booked' || r.state === 'checked_in') && <button onClick={() => cancelRes.mutate(r.id)} className="text-xs px-2 py-1 rounded hover:bg-gray-100 text-gray-500">Cancel</button>}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 shrink-0">
          <button onClick={() => window.confirm('Cancel this whole session and refund credits?') && cancelSession.mutate()} disabled={cancelSession.isPending} className="w-full px-4 py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50">Cancel session</button>
        </div>
      </div>
      {booking && <BookMemberModal sessionId={sessionId} onClose={() => setBooking(false)} onBooked={() => { setBooking(false); refresh(); }} />}
    </div>
  );
}

function BookMemberModal({ sessionId, onClose, onBooked }: { sessionId: string; onClose: () => void; onBooked: () => void }) {
  const [search, setSearch] = useState('');
  const membersQ = useQuery({ queryKey: ['members-pick', search], queryFn: () => membersApi.list({ search: search || undefined, perPage: 20 }), retry: false });
  const book = useMutation({
    mutationFn: (memberId: string) => bookApi.book(sessionId, memberId),
    onSuccess: (r) => { if (r.status === 'full') { showToast.error('Session is full'); } else { showToast.success('Booked'); onBooked(); } },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const list: Member[] = membersQ.data?.members ?? [];
  return (
    <Modal title="Book a member" onClose={onClose}>
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-sm" /></div>
      <div className="max-h-60 overflow-y-auto -mx-1">
        {list.length === 0 ? <p className="text-sm text-gray-400 px-1 py-2">No members</p> : list.map((m) => (
          <button key={m.id} onClick={() => book.mutate(m.id)} disabled={book.isPending} className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 text-sm text-gray-800 disabled:opacity-50">{m.display_name ?? m.email ?? m.phone ?? 'Member'}</button>
        ))}
      </div>
    </Modal>
  );
}

// ── tiny shared modal shell ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{title}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="px-5 py-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}
function SaveBar({ onClose, onSave, saving, label }: { onClose: () => void; onSave: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">{saving ? 'Working…' : label}</button>
    </div>
  );
}
