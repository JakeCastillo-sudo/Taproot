/**
 * ReservationsPage — /reservations
 *
 * Two tabs: Waitlist (walk-ins queued by join time) and Reservations (by date).
 * Add parties, notify (SMS stub), and seat them to a table.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Bell, Armchair, Trash2, CalendarClock, Users } from 'lucide-react';
import { clsx } from 'clsx';
import {
  reservations as resApi, tables as tablesApi,
  type ReservationRow, type ReservationType,
} from '../lib/api';
import { showToast } from '../components/ui/Toast';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_BADGE: Record<string, string> = {
  waiting: 'bg-blue-50 text-blue-600', notified: 'bg-amber-50 text-amber-600',
  confirmed: 'bg-blue-50 text-blue-600', arrived: 'bg-teal-50 text-teal-600',
  seated: 'bg-green-50 text-green-600', no_show: 'bg-red-50 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500', removed: 'bg-gray-100 text-gray-500',
};

export function ReservationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ReservationType>('waitlist');
  const [date, setDate] = useState(todayLocal());
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['reservations', tab, tab === 'reservation' ? date : 'wl'],
    queryFn:  () => resApi.list({ type: tab, date: tab === 'reservation' ? date : undefined }),
  });
  const { data: tableList } = useQuery({ queryKey: ['tables'], queryFn: () => tablesApi.list(), staleTime: 60_000 });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['reservations'] });

  const notify = useMutation({
    mutationFn: (id: string) => resApi.notify(id),
    onSuccess: (r) => { showToast.success(r.channel === 'sms' ? 'SMS sent' : 'Guest notified (SMS not configured — logged)'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const seat = useMutation({
    mutationFn: ({ id, tableId }: { id: string; tableId: string | null }) => resApi.seat(id, tableId),
    onSuccess: () => { showToast.success('Seated'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => resApi.remove(id),
    onSuccess: () => { showToast.success('Removed'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const handleSeat = (r: ReservationRow) => {
    const tables = tableList ?? [];
    if (tables.length === 0) { seat.mutate({ id: r.id, tableId: null }); return; }
    const names = tables.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
    const pick = window.prompt(`Seat ${r.customer_name} at which table?\n${names}\n\nEnter number (or blank for none):`, '1');
    if (pick === null) return;
    const idx = parseInt(pick, 10) - 1;
    seat.mutate({ id: r.id, tableId: tables[idx]?.id ?? null });
  };

  const list = data ?? [];

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><CalendarClock size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Reservations</h1>
          </div>
          <div className="flex-1" />
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark"><Plus size={14} /> Add</button>
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-2 items-center">
          {(['waitlist', 'reservation'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-3 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize', tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t === 'waitlist' ? 'Waitlist' : 'Reservations'}
            </button>
          ))}
          {tab === 'reservation' && (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-auto my-2 px-2 py-1 border border-gray-200 rounded-md text-sm" />
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-shimmer" />)}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-16">
              <Users size={36} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">{tab === 'waitlist' ? 'Waitlist is empty' : 'No reservations for this date'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((r) => (
                <div key={r.id} className="bg-white rounded-lg border border-gray-100 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800">{r.customer_name}</p>
                      <span className="text-xs text-gray-400">party of {r.party_size}</span>
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-500')}>{r.status.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {r.phone ?? 'no phone'}
                      {r.type === 'reservation' && r.reserved_for ? ` · ${new Date(r.reserved_for).toLocaleString()}` : ` · waiting ${Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000))}m`}
                      {r.table_name ? ` · ${r.table_name}` : ''}
                    </p>
                  </div>
                  {r.status !== 'seated' && (
                    <>
                      <button onClick={() => notify.mutate(r.id)} title="Notify" className="p-2 rounded hover:bg-amber-50 text-gray-500 hover:text-amber-600"><Bell size={15} /></button>
                      <button onClick={() => handleSeat(r)} title="Seat" className="p-2 rounded hover:bg-green-50 text-gray-500 hover:text-green-600"><Armchair size={15} /></button>
                    </>
                  )}
                  <button onClick={() => remove.mutate(r.id)} title="Remove" className="p-2 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {adding && <AddModal type={tab} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function AddModal({ type, onClose, onSaved }: { type: ReservationType; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [party, setParty] = useState('2');
  const [phone, setPhone] = useState('');
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Name is required');
      return resApi.create({
        customerName: name.trim(), partySize: parseInt(party, 10) || 2, phone: phone.trim() || undefined,
        type, reservedFor: type === 'reservation' && when ? new Date(when).toISOString() : undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => { showToast.success(type === 'waitlist' ? 'Added to waitlist' : 'Reservation created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{type === 'waitlist' ? 'Add to waitlist' : 'New reservation'}</h2></div>
        <div className="px-5 py-4 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={1} value={party} onChange={(e) => setParty(e.target.value)} placeholder="Party size" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          </div>
          {type === 'reservation' && (
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
          )}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Add</button>
        </div>
      </div>
    </div>
  );
}
