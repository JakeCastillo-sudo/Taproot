/**
 * SplitCheckModal — divide an order across multiple payments.
 *
 * Modes: Split Evenly (N ways) and Custom Amounts. The order is created once on
 * the first charge; each split is processed as a separate payment against it
 * (the backend already accumulates amount_paid across payments). When the balance
 * reaches zero the receipt snapshot is built and we navigate to /receipt.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CreditCard, Banknote, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { usePOSStore } from '../../store/pos.store';
import { orders as ordersApi, payments as paymentsApi } from '../../lib/api';
import { getLocationId, getStoredUser } from '../../lib/session';
import { showToast } from '../ui/Toast';

function fmt(c: number): string { return `$${(c / 100).toFixed(2)}`; }
function toCents(s: string): number { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }

interface Split { amount: number; method: 'cash' | 'card'; paid: boolean }

export function SplitCheckModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { cart, subtotal, taxTotal, total, customerId, orderNotes, clearCart, setLastCompletedOrder } = usePOSStore();
  const locationId = getLocationId();

  const grandTotal = total();
  const [mode, setMode] = useState<'even' | 'custom'>('even');
  const [ways, setWays] = useState(2);
  const [custom, setCustom] = useState<string[]>(['', '']);
  const [splits, setSplits] = useState<Split[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNum, setOrderNum] = useState<string | null>(null);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  // Build the split list from the chosen mode.
  const plannedSplits = useMemo<Split[]>(() => {
    if (splits.length > 0) return splits;
    if (mode === 'even') {
      const base = Math.floor(grandTotal / ways);
      const rem = grandTotal - base * ways;
      return Array.from({ length: ways }, (_, i) => ({ amount: base + (i < rem ? 1 : 0), method: 'card' as const, paid: false }));
    }
    return custom.map((c) => ({ amount: toCents(c), method: 'card' as const, paid: false }));
  }, [mode, ways, custom, splits, grandTotal]);

  const start = () => {
    setSplits(plannedSplits.map((s) => ({ ...s })));
  };

  const paidTotal = splits.reduce((s, x) => s + (x.paid ? x.amount : 0), 0);
  const remaining = grandTotal - paidTotal;

  const ensureOrder = async (): Promise<string> => {
    if (orderId) return orderId;
    const order = await ordersApi.create(locationId, {
      customerId: customerId ?? undefined,
      items: cart.map((c) => ({
        productId: c.productId, variantId: c.variantId, quantity: c.quantity, unitPrice: c.unitPrice,
        notes: c.notes || undefined,
        modifiers: (c.modifiers ?? []).map((m) => ({ modifierId: m.modifierId, name: m.name, priceDelta: m.priceDelta })),
      })),
      notes: orderNotes || undefined,
    });
    const num = order.order_number?.toString() ?? order.id.slice(-6).toUpperCase();
    setOrderId(order.id); setOrderNum(num);
    return order.id;
  };

  const chargeSplit = async (idx: number) => {
    if (splits[idx].paid || busyIdx !== null) return;
    setBusyIdx(idx);
    try {
      const oid = await ensureOrder();
      await paymentsApi.process(locationId, oid, {
        paymentMethod: splits[idx].method === 'card' ? 'card' : 'cash',
        amount: splits[idx].amount,
      });
      const next = splits.map((s, i) => i === idx ? { ...s, paid: true } : s);
      setSplits(next);

      if (next.every((s) => s.paid)) {
        finalize(oid);
      }
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Payment failed for this split');
    } finally {
      setBusyIdx(null);
    }
  };

  const finalize = (oid: string) => {
    const ui = getStoredUser();
    setLastCompletedOrder({
      orderId: oid,
      orderNumber: orderNum ?? oid.slice(-6).toUpperCase(),
      items: cart.map((c) => ({ name: c.name, quantity: c.quantity, unitPrice: c.unitPrice, modifiers: (c.modifiers ?? []).map((m) => m.name), total: c.lineTotal })),
      subtotal: subtotal(), taxTotal: taxTotal(), tipTotal: 0, total: grandTotal,
      amountPaid: grandTotal, changeDue: 0, paymentMethod: 'split',
      employeeName: `${ui?.firstName ?? ''} ${ui?.lastName ?? ''}`.trim() || 'Staff',
      locationName: 'Location', orgName: 'Taproot', orderType: 'in_store',
      completedAt: new Date().toISOString(),
    });
    clearCart();
    onClose();
    navigate('/receipt', { replace: true });
  };

  const customSum = custom.reduce((s, c) => s + toCents(c), 0);
  const customValid = mode !== 'custom' || customSum === grandTotal;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">Split check · {fmt(grandTotal)}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {splits.length === 0 ? (
            <>
              <div className="flex gap-1.5">
                {(['even', 'custom'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={clsx('flex-1 px-3 py-2 rounded-md text-sm font-medium capitalize transition-colors',
                      mode === m ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                    {m === 'even' ? 'Split evenly' : 'Custom amounts'}
                  </button>
                ))}
              </div>

              {mode === 'even' ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">How many ways?</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={2} max={8} value={ways}
                      onChange={(e) => setWays(Math.max(2, Math.min(8, parseInt(e.target.value, 10) || 2)))}
                      className="w-20 px-3 py-2 border border-gray-200 rounded-md text-sm" />
                    <span className="text-sm text-gray-500">{fmt(Math.floor(grandTotal / ways))} each</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {custom.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 w-16">Person {i + 1}</span>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                        <input value={c} inputMode="decimal" onChange={(e) => setCustom((cs) => cs.map((x, j) => j === i ? e.target.value : x))}
                          className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm" placeholder="0.00" />
                      </div>
                      {custom.length > 2 && <button onClick={() => setCustom((cs) => cs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button onClick={() => setCustom((cs) => [...cs, ''])} className="text-xs text-primary hover:underline" disabled={custom.length >= 8}>+ Add person</button>
                    <span className={clsx('text-xs', customSum === grandTotal ? 'text-green-600' : 'text-gray-400')}>
                      {fmt(customSum)} / {fmt(grandTotal)}
                    </span>
                  </div>
                </div>
              )}

              <button onClick={start} disabled={!customValid}
                className="w-full h-11 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark disabled:opacity-40">
                Start split
              </button>
            </>
          ) : (
            <div className="space-y-2">
              {splits.map((s, i) => (
                <div key={i} className={clsx('flex items-center gap-2 p-3 rounded-md border', s.paid ? 'border-green-200 bg-green-50' : 'border-gray-200')}>
                  <span className="text-sm font-medium text-gray-700 w-20">Person {i + 1}</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(s.amount)}</span>
                  <div className="flex-1" />
                  {s.paid ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><Check size={14} /> Paid</span>
                  ) : (
                    <>
                      <select value={s.method} onChange={(e) => setSplits((ss) => ss.map((x, j) => j === i ? { ...x, method: e.target.value as 'cash' | 'card' } : x))}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white">
                        <option value="card">Card</option><option value="cash">Cash</option>
                      </select>
                      <button onClick={() => chargeSplit(i)} disabled={busyIdx !== null}
                        className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
                        {s.method === 'card' ? <CreditCard size={12} /> : <Banknote size={12} />}
                        {busyIdx === i ? '…' : 'Charge'}
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div className="flex justify-between text-sm pt-2 border-t border-gray-100">
                <span className="text-gray-500">Remaining</span>
                <span className="font-bold text-gray-900">{fmt(remaining)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
