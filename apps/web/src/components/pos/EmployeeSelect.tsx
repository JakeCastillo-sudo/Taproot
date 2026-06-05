/**
 * EmployeeSelect — POS PIN lock screen.
 *
 * Grid of employee cards → tap one → 4–6 digit PIN pad → /auth/pin-login switches
 * the active employee on this (already-authenticated) device. On success the new
 * tokens + user are stored and the app reloads so every screen reflects the new
 * employee. Owners/managers can fall back to password login.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Delete, X, Lock } from 'lucide-react';
import { clsx } from 'clsx';
import {
  employees as employeesApi, auth as authApi,
  setTokens, USER_KEY, type SelectableEmployee,
} from '../../lib/api';
import { getLocationId } from '../../lib/session';

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700',
  'bg-pink-100 text-pink-700', 'bg-amber-100 text-amber-700',
  'bg-teal-100 text-teal-700', 'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700', 'bg-green-100 text-green-700',
];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const MAX_ATTEMPTS = 3;

export function EmployeeSelect({ onClose }: { onClose: () => void }) {
  const { data: employees } = useQuery({
    queryKey: ['employees', 'selectable'],
    queryFn:  () => employeesApi.selectable(),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<SelectableEmployee | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => employees ?? [], [employees]);
  const locked = attempts >= MAX_ATTEMPTS;

  const submit = async (fullPin: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await authApi.pinLogin(selected.id, fullPin, getLocationId());
      setTokens(res.accessToken, res.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify({
        id: res.employee.id, firstName: res.employee.firstName, lastName: res.employee.lastName,
        email: res.employee.email, role: res.employee.role, orgId: res.employee.orgId,
        locationIds: res.employee.locationIds, permissions: res.employee.permissions,
      }));
      // Reload so the whole app picks up the new employee/session.
      window.location.assign('/');
    } catch {
      setError(true);
      setPin('');
      setAttempts((a) => a + 1);
      setBusy(false);
      setTimeout(() => setError(false), 500);
    }
  };

  const press = (d: string) => {
    if (locked || busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4) {
      // Auto-submit once a plausible PIN length is reached on Enter; here submit at 4
      // only via the explicit button to allow 5–6 digit PINs. (Handled by Enter key.)
    }
  };

  // Allow keyboard entry
  useEffect(() => {
    if (!selected) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) void submit(pin);
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pin, busy, locked]);

  return (
    <div className="fixed inset-0 z-[100] bg-surface-2 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2">
          <Lock size={18} className="text-primary" />
          <h1 className="text-base font-bold text-gray-900">Who's working?</h1>
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X size={18} className="text-gray-500" /></button>
      </div>

      {!selected ? (
        <div className="flex-1 overflow-y-auto p-6">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <p className="text-sm text-gray-400">No PIN-enabled employees.</p>
              <p className="text-xs text-gray-400 mt-1">Add staff + a PIN in Settings → Employees.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-w-4xl mx-auto">
              {list.map((e) => {
                const initials = (e.first_name[0] ?? '') + (e.last_name[0] ?? '');
                return (
                  <button key={e.id} onClick={() => { setSelected(e); setPin(''); setAttempts(0); }}
                    className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-gray-100 hover:border-primary/40 hover:shadow-sm transition-all">
                    <div className={clsx('w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold', colorFor(e.first_name + e.last_name))}>
                      {initials.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-800 text-center truncate w-full">{e.first_name} {e.last_name}</span>
                    <span className="text-[11px] text-gray-400 capitalize">{e.role}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <p className="text-sm text-gray-500 mb-1">Enter PIN for</p>
          <p className="text-lg font-bold text-gray-900 mb-4">{selected.first_name} {selected.last_name}</p>

          <div className={clsx('flex gap-2 mb-6', error && 'animate-shake')}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={clsx('w-3.5 h-3.5 rounded-full border', i < pin.length ? 'bg-primary border-primary' : 'border-gray-300')} />
            ))}
          </div>

          {locked ? (
            <div className="text-center">
              <p className="text-sm font-medium text-red-600">Too many attempts.</p>
              <p className="text-xs text-gray-500 mt-1">Ask a manager to reset the PIN or use password login.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {['1','2','3','4','5','6','7','8','9'].map((d) => (
                <button key={d} onClick={() => press(d)} disabled={busy}
                  className="w-16 h-16 rounded-full bg-white border border-gray-200 text-xl font-semibold text-gray-800 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-50">
                  {d}
                </button>
              ))}
              <button onClick={() => setSelected(null)} className="w-16 h-16 rounded-full text-xs font-medium text-gray-400 hover:text-gray-600">Back</button>
              <button onClick={() => press('0')} disabled={busy}
                className="w-16 h-16 rounded-full bg-white border border-gray-200 text-xl font-semibold text-gray-800 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-50">0</button>
              <button onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy}
                className="w-16 h-16 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 active:scale-95 transition-all"><Delete size={20} /></button>
            </div>
          )}

          {!locked && (
            <button onClick={() => pin.length >= 4 && submit(pin)} disabled={pin.length < 4 || busy}
              className="mt-6 px-8 py-2.5 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-40">
              {busy ? 'Checking…' : 'Enter'}
            </button>
          )}

          <a href="/login" className="mt-4 text-xs text-gray-400 hover:text-primary">Use password instead</a>
        </div>
      )}
    </div>
  );
}
