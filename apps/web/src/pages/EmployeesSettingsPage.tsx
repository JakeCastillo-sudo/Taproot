/**
 * EmployeesSettingsPage — /settings/employees
 *
 * Staff list with add/edit, deactivate, and reset-PIN. PINs are 4–6 digits,
 * hashed server-side. Restricted to owner/manager (enforced on the API too).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, KeyRound, X, Users, Eye, EyeOff } from 'lucide-react';
import { clsx } from 'clsx';
import {
  employees as employeesApi, locations as locationsApi,
  type EmployeeListRow, type LocationRow,
} from '../lib/api';
import { showToast } from '../components/ui/Toast';

const ROLES = ['owner', 'manager', 'cashier', 'kitchen', 'readonly'] as const;

const ROLE_BADGE: Record<string, string> = {
  owner:    'bg-purple-50 text-purple-700',
  manager:  'bg-blue-50 text-blue-700',
  cashier:  'bg-green-50 text-green-700',
  kitchen:  'bg-amber-50 text-amber-700',
  readonly: 'bg-gray-100 text-gray-500',
};

interface EditState {
  id:          string | null;
  firstName:   string;
  lastName:    string;
  email:       string;
  role:        string;
  pin:         string;
  hourlyRate:  string;
  locationIds: string[];
}

function EmployeeModal({ state, locations, onClose, onSaved }: {
  state: EditState; locations: LocationRow[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<EditState>(state);
  const [showPin, setShowPin] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.firstName.trim() || !form.lastName.trim()) throw new Error('First and last name are required');
      if (!form.email.trim()) throw new Error('Email is required');
      if (form.pin && !/^\d{4,6}$/.test(form.pin)) throw new Error('PIN must be 4–6 digits');
      const hourlyRate = form.hourlyRate ? parseFloat(form.hourlyRate) : null;
      const base = {
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim(), role: form.role,
        locationIds: form.locationIds, hourlyRate,
      };
      if (form.id) {
        await employeesApi.update(form.id, base);
        if (form.pin) await employeesApi.resetPin(form.id, form.pin);
      } else {
        await employeesApi.create({ ...base, pin: form.pin || undefined });
      }
    },
    onSuccess: () => { showToast.success(form.id ? 'Employee updated' : 'Employee added'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const toggleLoc = (id: string) => setForm((f) => ({
    ...f,
    locationIds: f.locationIds.includes(id) ? f.locationIds.filter((x) => x !== id) : [...f.locationIds, id],
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Employee' : 'Add Employee'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">First name *</label>
              <input autoFocus value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Last name *</label>
              <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Email *</label>
            <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Role</label>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white capitalize focus:outline-none focus:ring-2 focus:ring-primary/40">
                {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
              </select></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Hourly rate</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input value={form.hourlyRate} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                  placeholder="Optional" className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">{form.id ? 'New PIN (leave blank to keep)' : 'PIN (4–6 digits)'}</label>
            <div className="relative">
              <input type={showPin ? 'text' : 'password'} value={form.pin} inputMode="numeric" maxLength={6}
                onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))}
                className="w-full px-3 py-2 pr-9 border border-gray-200 rounded-md text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="••••" />
              <button type="button" onClick={() => setShowPin((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div></div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Locations</label>
            {locations.length === 0 ? <p className="text-xs text-gray-400">No locations</p> : (
              <div className="flex flex-wrap gap-2">
                {locations.map((l) => (
                  <button key={l.id} type="button" onClick={() => toggleLoc(l.id)}
                    className={clsx('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                      form.locationIds.includes(l.id) ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}>
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-1">No locations selected = access to all locations.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
            {save.isPending ? 'Saving…' : form.id ? 'Save' : 'Add employee'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmployeesSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);

  const { data: employees, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() });
  const { data: locs } = useQuery({ queryKey: ['locations'], queryFn: () => locationsApi.list(), staleTime: 5 * 60_000 });
  const locations = locs ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['employees'] });

  const remove = useMutation({
    mutationFn: (id: string) => employeesApi.remove(id),
    onSuccess: () => { showToast.success('Employee deactivated'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const resetPin = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => employeesApi.resetPin(id, pin),
    onSuccess: () => showToast.success('PIN reset'),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const handleResetPin = (e: EmployeeListRow) => {
    const pin = window.prompt(`New 4–6 digit PIN for ${e.first_name} ${e.last_name}:`, '');
    if (pin == null) return;
    if (!/^\d{4,6}$/.test(pin)) { showToast.error('PIN must be 4–6 digits'); return; }
    resetPin.mutate({ id: e.id, pin });
  };
  const handleDelete = (e: EmployeeListRow) => {
    if (window.confirm(`Deactivate ${e.first_name} ${e.last_name}? They will be unable to log in.`)) remove.mutate(e.id);
  };

  const openEdit = (e: EmployeeListRow) => setEditing({
    id: e.id, firstName: e.first_name, lastName: e.last_name, email: e.email,
    role: e.role, pin: '', hourlyRate: e.hourly_rate != null ? String(e.hourly_rate) : '',
    locationIds: e.location_ids ?? [],
  });

  const list = employees ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Employees</h1>
        <button
          onClick={() => setEditing({ id: null, firstName: '', lastName: '', email: '', role: 'cashier', pin: '', hourlyRate: '', locationIds: [] })}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark transition-colors">
          <Plus size={16} /> Add Employee
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Users size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">No employees yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 md:px-6 py-2">Name</th>
                <th className="text-left font-medium px-3 py-2">Role</th>
                <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Email</th>
                <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">PIN</th>
                <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Last login</th>
                <th className="text-right font-medium px-4 md:px-6 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-white">
                  <td className="px-4 md:px-6 py-3 font-medium text-gray-800">{e.first_name} {e.last_name}</td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', ROLE_BADGE[e.role] ?? 'bg-gray-100 text-gray-500')}>{e.role}</span>
                  </td>
                  <td className="px-3 py-3 hidden sm:table-cell text-gray-500">{e.email}</td>
                  <td className="px-3 py-3 hidden lg:table-cell">
                    {e.has_pin ? <span className="text-xs text-green-600">Set</span> : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 hidden lg:table-cell text-gray-400 text-xs">
                    {e.last_login_at ? new Date(e.last_login_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 md:px-6 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(e)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"><Pencil size={14} /></button>
                      <button onClick={() => handleResetPin(e)} title="Reset PIN" className="p-1.5 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600"><KeyRound size={14} /></button>
                      <button onClick={() => handleDelete(e)} title="Deactivate" className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EmployeeModal state={editing} locations={locations} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />
      )}
    </div>
  );
}
