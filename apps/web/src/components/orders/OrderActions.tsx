/**
 * OrderActions — Void & Refund controls for the order detail drawer.
 *
 * Void: full reversal (refunds completed card/cash payments) with a reason.
 * Refund: full / partial ($) / by-item, with a reason and a live preview.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ban, RotateCcw, X } from 'lucide-react';
import { clsx } from 'clsx';
import { orders as ordersApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

function fmt(cents: number): string { return `$${(Number(cents) / 100).toFixed(2)}`; }

const VOID_REASONS = ['Customer changed mind', 'Incorrect order', 'Item unavailable', 'Test order', 'Other'];

function dollarsToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isFinite(n) ? Math.round(n * 100) : 0;
}

export function OrderActions({ orderId, status, onChanged }: {
  orderId:   string;
  status:    string;
  onChanged: () => void;
}) {
  const [modal, setModal] = useState<'void' | 'refund' | null>(null);

  const terminal = status === 'voided' || status === 'refunded';
  if (terminal) {
    return <span className="text-xs text-gray-400 ml-auto self-center capitalize">{status.replace(/_/g, ' ')}</span>;
  }

  return (
    <>
      <button onClick={() => setModal('refund')}
        className="flex items-center gap-1.5 px-3 py-2 border border-amber-200 text-amber-700 rounded-md text-sm hover:bg-amber-50 transition-colors">
        <RotateCcw size={14} /> Refund
      </button>
      <button onClick={() => setModal('void')}
        className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-600 rounded-md text-sm hover:bg-red-50 transition-colors">
        <Ban size={14} /> Void
      </button>
      {modal === 'void' && <VoidModal orderId={orderId} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
      {modal === 'refund' && <RefundModal orderId={orderId} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
    </>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col overflow-hidden max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function VoidModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(VOID_REASONS[0]);
  const m = useMutation({
    mutationFn: () => ordersApi.voidOrder(orderId, reason),
    onSuccess: (r) => { showToast.success(r.refundedAmount > 0 ? `Voided — ${fmt(r.refundedAmount)} refunded` : 'Order voided'); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Void failed'),
  });
  return (
    <ModalShell title="Void order" onClose={onClose}>
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-red-600 font-medium">This cannot be undone.</p>
        <p className="text-xs text-gray-500">Any captured card payment will be fully refunded to the customer.</p>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
            {VOID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending}
          className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">
          {m.isPending ? 'Voiding…' : 'Void order'}
        </button>
      </div>
    </ModalShell>
  );
}

function RefundModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'full' | 'partial' | 'items'>('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: lineItems } = useQuery({
    queryKey: ['order', 'line-items', orderId],
    queryFn:  () => ordersApi.lineItems(orderId),
    enabled: type === 'items',
  });

  const itemsTotal = (lineItems ?? []).filter((li) => selected.has(li.id)).reduce((s, li) => s + Number(li.total), 0);

  const m = useMutation({
    mutationFn: () => {
      const reasonText = reason.trim() || 'Refund';
      if (type === 'items') {
        if (selected.size === 0) throw new Error('Select at least one item');
        return ordersApi.refund(orderId, { type: 'partial', lineItemIds: [...selected], reason: reasonText });
      }
      if (type === 'partial') {
        const cents = dollarsToCents(amount);
        if (cents <= 0) throw new Error('Enter a refund amount');
        return ordersApi.refund(orderId, { type: 'partial', amount: cents, reason: reasonText });
      }
      return ordersApi.refund(orderId, { type: 'full', reason: reasonText });
    },
    onSuccess: (r) => { showToast.success(`Refunded ${fmt(r.refundedAmount)}`); onDone(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Refund failed'),
  });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <ModalShell title="Issue refund" onClose={onClose}>
      <div className="px-5 py-4 space-y-3 overflow-y-auto">
        <div className="flex gap-1.5">
          {(['full', 'partial', 'items'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={clsx('flex-1 px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors',
                type === t ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
              {t === 'items' ? 'By item' : t}
            </button>
          ))}
        </div>

        {type === 'partial' && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
                className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="0.00" />
            </div>
          </div>
        )}

        {type === 'items' && (
          <div className="border border-gray-100 rounded-md max-h-48 overflow-y-auto">
            {(lineItems ?? []).filter((li) => !li.voided).map((li) => (
              <label key={li.id} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={selected.has(li.id)} onChange={() => toggle(li.id)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm text-gray-700 truncate">{li.quantity}× {li.name}</span>
                </div>
                <span className="text-sm text-gray-600 tabular-nums">{fmt(li.total)}</span>
              </label>
            ))}
            {(lineItems ?? []).length === 0 && <p className="text-xs text-gray-400 p-3">Loading items…</p>}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="Reason for refund" />
        </div>

        <div className="p-3 bg-gray-50 rounded-md text-sm text-gray-600">
          {type === 'items' ? `Refunding ${fmt(itemsTotal)} for ${selected.size} item(s)`
            : type === 'partial' ? `Refunding ${fmt(dollarsToCents(amount))}`
            : 'Refunding the full captured amount'}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
        <button onClick={() => m.mutate()} disabled={m.isPending}
          className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
          {m.isPending ? 'Refunding…' : 'Issue refund'}
        </button>
      </div>
    </ModalShell>
  );
}
