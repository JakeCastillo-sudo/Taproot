/**
 * CashDrawerWidget — compact POS cash-drawer control.
 *
 * Shows the current session (opening amount + expected) with Open / Drop / Close
 * actions. Money in dollars in the UI, cents over the wire. Degrades quietly when
 * migration 015 hasn't been applied (current() returns null).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, ArrowDownToLine, Lock, Unlock, X } from 'lucide-react';
import { clsx } from 'clsx';
import { cashDrawer as cashApi, type CashDrawerSession } from '../../lib/api';
import { showToast } from '../ui/Toast';

function fmt(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function toCents(s: string): number { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }

type ModalKind = 'open' | 'drop' | 'close' | null;

export function CashDrawerWidget() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalKind>(null);

  const { data: session, isLoading } = useQuery({
    queryKey: ['cash-drawer', 'current'],
    queryFn:  () => cashApi.current(),
    staleTime: 15_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['cash-drawer'] });

  if (isLoading) return null;

  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <Banknote size={14} className="text-gray-400" />
          Cash drawer
        </div>
        {session ? (
          <span className="text-xs text-green-600 font-medium">Open</span>
        ) : (
          <span className="text-xs text-gray-400">Closed</span>
        )}
      </div>

      {session && (
        <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
          <div className="flex justify-between"><span>Opening</span><span>{fmt(session.opening_amount)}</span></div>
          <div className="flex justify-between font-medium text-gray-700"><span>Expected</span><span>{fmt(session.expected_amount ?? 0)}</span></div>
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        {session ? (
          <>
            <button onClick={() => setModal('drop')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50">
              <ArrowDownToLine size={12} /> Drop
            </button>
            <button onClick={() => setModal('close')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50">
              <Lock size={12} /> Close
            </button>
          </>
        ) : (
          <button onClick={() => setModal('open')} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary-dark">
            <Unlock size={12} /> Open drawer
          </button>
        )}
      </div>

      {modal === 'open' && <OpenModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'drop' && <DropModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal === 'close' && session && <CloseModal session={session} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder ?? '0.00'}
        className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" autoFocus />
    </div>
  );
}

function OpenModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const m = useMutation({
    mutationFn: () => cashApi.open(toCents(amount)),
    onSuccess: () => { showToast.success('Drawer opened'); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Shell title="Open drawer" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <label className="block text-xs font-semibold text-gray-600">Opening cash amount</label>
        <MoneyInput value={amount} onChange={setAmount} />
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Open drawer</button>
      </div>
    </Shell>
  );
}

function DropModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => cashApi.drop(toCents(amount), reason || undefined),
    onSuccess: () => { showToast.success('Cash drop recorded'); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Shell title="Cash drop" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">Amount to safe</label><MoneyInput value={amount} onChange={setAmount} /></div>
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Mid-shift drop"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" /></div>
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Record drop</button>
      </div>
    </Shell>
  );
}

function CloseModal({ session, onClose, onDone }: { session: CashDrawerSession; onClose: () => void; onDone: () => void }) {
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const expected = session.expected_amount ?? 0;
  const discrepancy = toCents(actual) - expected;
  const m = useMutation({
    mutationFn: () => cashApi.close(toCents(actual), notes || undefined),
    onSuccess: () => { showToast.success('Drawer closed'); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Shell title="Close drawer" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <label className="block text-xs font-semibold text-gray-600">Counted cash amount</label>
        <MoneyInput value={actual} onChange={setActual} />
        <div className="bg-gray-50 rounded-md p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-500"><span>Expected</span><span>{fmt(expected)}</span></div>
          <div className="flex justify-between text-gray-500"><span>Actual</span><span>{actual ? fmt(toCents(actual)) : '—'}</span></div>
          <div className={clsx('flex justify-between font-semibold pt-1 border-t border-gray-200', discrepancy === 0 ? 'text-gray-700' : discrepancy > 0 ? 'text-green-600' : 'text-red-600')}>
            <span>Discrepancy</span><span>{actual ? `${discrepancy > 0 ? '+' : ''}${fmt(discrepancy)}` : '—'}</span>
          </div>
        </div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending || !actual} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Close drawer</button>
      </div>
    </Shell>
  );
}
