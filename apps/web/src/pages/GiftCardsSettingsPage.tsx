/**
 * GiftCardsSettingsPage — /settings/gift-cards
 *
 * Issue gift cards (the "sell" action for staff), view balances, look up by code,
 * reload, and deactivate. Redemption happens at the POS PaymentSheet (gift_card
 * method) — fully wired server-side.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Ban, CreditCard, X, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import { giftCards as gcApi, type GiftCardRow } from '../lib/api';
import { showToast } from '../components/ui/Toast';

function fmt(c: number): string { return `$${(Number(c) / 100).toFixed(2)}`; }
function toCents(s: string): number { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }

export function GiftCardsSettingsPage() {
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<GiftCardRow | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['gift-cards'], queryFn: () => gcApi.list() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gift-cards'] });

  const deactivate = useMutation({
    mutationFn: (id: string) => gcApi.deactivate(id),
    onSuccess: () => { showToast.success('Gift card deactivated'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const doLookup = async () => {
    if (!lookup.trim()) return;
    try { setFound(await gcApi.lookup(lookup.trim())); }
    catch (e) { setFound(null); showToast.error(e instanceof Error ? e.message : 'Not found'); }
  };

  const cards = data?.cards ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-gray-900">Gift Cards</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doLookup()}
              placeholder="Look up code" className="pl-8 pr-3 py-2 border border-gray-200 rounded-md text-sm w-44" />
          </div>
          <button onClick={() => setIssuing(true)} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark"><Plus size={15} /> Issue</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {found && (
          <div className="mb-4 p-4 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
            <div>
              <p className="font-mono text-sm font-semibold text-gray-800">{found.code}</p>
              <p className="text-xs text-gray-500">Balance {fmt(found.current_balance)} · {found.is_active ? 'active' : 'inactive'}</p>
            </div>
            <button onClick={() => setFound(null)} className="p-1.5 rounded hover:bg-white"><X size={15} className="text-gray-400" /></button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
        ) : cards.length === 0 ? (
          <div className="text-center py-16">
            <CreditCard size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No gift cards issued yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Code</th>
                  <th className="text-right font-medium px-3 py-2">Balance</th>
                  <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Initial</th>
                  <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Issued</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-gray-800">
                      <button onClick={() => { navigator.clipboard?.writeText(c.code); showToast.success('Copied'); }} className="inline-flex items-center gap-1 hover:text-primary">
                        {c.code} <Copy size={11} className="text-gray-300" />
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-800">{fmt(c.current_balance)}</td>
                    <td className="px-3 py-3 text-right text-gray-400 hidden sm:table-cell">{fmt(c.initial_balance)}</td>
                    <td className="px-3 py-3 text-gray-400 text-xs hidden md:table-cell">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded-full', c.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500')}>{c.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.is_active && (
                        <button onClick={() => window.confirm(`Deactivate ${c.code}?`) && deactivate.mutate(c.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600" title="Deactivate"><Ban size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {issuing && <IssueModal onClose={() => setIssuing(false)} onIssued={() => { setIssuing(false); refresh(); }} />}
    </div>
  );
}

function IssueModal({ onClose, onIssued }: { onClose: () => void; onIssued: () => void }) {
  const [amount, setAmount] = useState('');
  const [issued, setIssued] = useState<GiftCardRow | null>(null);

  const issue = useMutation({
    mutationFn: () => {
      const cents = toCents(amount);
      if (cents <= 0) throw new Error('Enter an amount');
      return gcApi.issue({ initialBalance: cents });
    },
    onSuccess: (card) => { setIssued(card); showToast.success('Gift card issued'); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">Issue gift card</h2></div>
        {issued ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-gray-500 mb-2">Gift card created</p>
            <p className="font-mono text-lg font-bold text-gray-900">{issued.code}</p>
            <p className="text-sm text-gray-500 mt-1">Balance {fmt(issued.current_balance)}</p>
            <button onClick={onIssued} className="mt-4 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Done</button>
          </div>
        ) : (
          <>
            <div className="px-5 py-4">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Initial balance</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="25.00"
                  className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
              <button onClick={() => issue.mutate()} disabled={issue.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Issue</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
