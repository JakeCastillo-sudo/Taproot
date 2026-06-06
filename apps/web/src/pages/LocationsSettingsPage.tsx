/**
 * LocationsSettingsPage — /settings/locations
 * Manage org locations (name, address, phone, timezone, currency).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, MapPin } from 'lucide-react';
import { locations as locApi, type LocationRow } from '../lib/api';
import { showToast } from '../components/ui/Toast';

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];

interface Addr { line1?: string; city?: string; state?: string; zip?: string }
interface EditState { id: string | null; name: string; phone: string; timezone: string; currency: string; address: Addr }
const EMPTY: EditState = { id: null, name: '', phone: '', timezone: 'America/New_York', currency: 'USD', address: {} };

export function LocationsSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['locations'], queryFn: () => locApi.list() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['locations'] });

  const remove = useMutation({
    mutationFn: (id: string) => locApi.remove(id),
    onSuccess: () => { showToast.success('Location deleted'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const list = data ?? [];
  const openEdit = (l: LocationRow) => setEditing({
    id: l.id, name: l.name, phone: l.phone ?? '', timezone: l.timezone, currency: l.currency,
    address: (l.address ?? {}) as Addr,
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Locations</h1>
        <button onClick={() => setEditing({ ...EMPTY })} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark"><Plus size={16} /> Add Location</button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2 max-w-2xl">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-shimmer" />)}</div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {list.map((l) => {
              const a = (l.address ?? {}) as Addr;
              return (
                <div key={l.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg p-4">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><MapPin size={16} className="text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{l.name}</p>
                    <p className="text-xs text-gray-400 truncate">{[a.line1, a.city, a.state].filter(Boolean).join(', ') || 'No address'} · {l.timezone} · {l.currency}</p>
                  </div>
                  <button onClick={() => openEdit(l)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"><Pencil size={14} /></button>
                  <button onClick={() => window.confirm(`Delete "${l.name}"?`) && remove.mutate(l.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing && <LocationModal state={editing} timezones={TIMEZONES} currencies={CURRENCIES} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function LocationModal({ state, timezones, currencies, onClose, onSaved }: {
  state: EditState; timezones: string[]; currencies: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<EditState>(state);
  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const body = { name: form.name.trim(), phone: form.phone.trim() || undefined, timezone: form.timezone, currency: form.currency, address: form.address as Record<string, unknown> };
      if (form.id) await locApi.update(form.id, body); else await locApi.create(body);
    },
    onSuccess: () => { showToast.success(form.id ? 'Location updated' : 'Location created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
  const addr = (k: keyof Addr, v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Location' : 'Add Location'}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-3">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label><input autoFocus className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Downtown" /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Address</label><input className={field} value={form.address.line1 ?? ''} onChange={(e) => addr('line1', e.target.value)} placeholder="123 Main St" /></div>
          <div className="grid grid-cols-3 gap-2">
            <input className={field} value={form.address.city ?? ''} onChange={(e) => addr('city', e.target.value)} placeholder="City" />
            <input className={field} value={form.address.state ?? ''} onChange={(e) => addr('state', e.target.value)} placeholder="State" />
            <input className={field} value={form.address.zip ?? ''} onChange={(e) => addr('zip', e.target.value)} placeholder="ZIP" />
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label><input className={field} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Timezone</label><select className={field + ' bg-white'} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>{timezones.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label><select className={field + ' bg-white'} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>{currencies.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Save</button></div>
      </div>
    </div>
  );
}
