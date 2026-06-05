/**
 * OrderHistoryPage — /orders
 *
 * Org-wide order history with date/status/employee/payment filters, search, CSV
 * export, and a right-side detail drawer (line items, payments, totals) backed by
 * the existing receipt endpoint. Void/Refund actions are wired in S2-02.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ClipboardList, Search, Download, X, Eye, Printer,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  orders as ordersApi, employees as employeesApi,
  type OrderHistoryRow,
} from '../lib/api';

function fmt(cents: number): string { return `$${(Number(cents) / 100).toFixed(2)}`; }

const STATUS_BADGE: Record<string, string> = {
  completed:          'bg-green-50 text-green-600',
  voided:             'bg-red-50 text-red-600',
  refunded:           'bg-amber-50 text-amber-600',
  partially_refunded: 'bg-amber-50 text-amber-600',
  open:               'bg-blue-50 text-blue-600',
  in_progress:        'bg-blue-50 text-blue-600',
  parked:             'bg-gray-100 text-gray-500',
};

type DatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'all';

function presetRange(p: DatePreset): { from?: string; to?: string } {
  if (p === 'all') return {};
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === 'today') return { from: startOfDay(now).toISOString() };
  if (p === 'yesterday') {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    return { from: startOfDay(y).toISOString(), to: startOfDay(now).toISOString() };
  }
  const days = p === '7d' ? 7 : 30;
  const from = new Date(now); from.setDate(now.getDate() - days);
  return { from: from.toISOString() };
}

export function OrderHistoryPage() {
  const navigate = useNavigate();
  const [preset, setPreset]   = useState<DatePreset>('7d');
  const [status, setStatus]   = useState('all');
  const [employeeId, setEmployeeId] = useState('');
  const [payMethod, setPayMethod]   = useState('');
  const [search, setSearch]   = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const range = useMemo(() => presetRange(preset), [preset]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['orders', 'history', { preset, status, employeeId, payMethod, search }],
    queryFn:  () => ordersApi.history({
      status, employeeId: employeeId || undefined, paymentMethod: payMethod || undefined,
      from: range.from, to: range.to, search: search || undefined, limit: 200,
    }),
  });

  const { data: staff } = useQuery({
    queryKey: ['employees', 'for-filter'],
    queryFn:  () => employeesApi.list().catch(() => []),
    staleTime: 5 * 60_000,
  });

  const list = data?.orders ?? [];

  const exportCsv = () => {
    const headers = ['Order', 'Date', 'Items', 'Total', 'Tip', 'Payment', 'Employee', 'Customer', 'Status'];
    const rows = list.map((o) => [
      o.order_number, new Date(o.created_at).toISOString(), o.item_count,
      (Number(o.total) / 100).toFixed(2), (Number(o.tip_total) / 100).toFixed(2),
      o.payment_methods ?? '', o.employee_name, o.customer_name ?? '', o.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={14} /> POS
          </button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><ClipboardList size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Order History</h1>
          </div>
          <div className="flex-1" />
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={13} /> Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">
          <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white">
            <option value="today">Today</option><option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white">
            <option value="all">All statuses</option><option value="completed">Completed</option>
            <option value="voided">Voided</option><option value="refunded">Refunded</option><option value="parked">Parked</option>
          </select>
          {(staff?.length ?? 0) > 0 && (
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white">
              <option value="">All employees</option>
              {staff!.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          )}
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white">
            <option value="">All payments</option><option value="cash">Cash</option>
            <option value="credit_card">Credit card</option><option value="debit_card">Debit card</option>
            <option value="gift_card">Gift card</option>
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order # or customer…"
              className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <ClipboardList size={36} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">No orders in this range</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Order #</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Date / Time</th>
                    <th className="text-right font-medium px-3 py-2">Items</th>
                    <th className="text-right font-medium px-3 py-2">Total</th>
                    <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Payment</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Employee</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-right font-medium px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setDetailId(o.id)}>
                      <td className="px-4 py-3 font-semibold text-gray-800">{o.order_number}</td>
                      <td className="px-3 py-3 hidden sm:table-cell text-gray-500 text-xs">{new Date(o.created_at).toLocaleString()}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{o.item_count}</td>
                      <td className="px-3 py-3 text-right font-medium text-gray-800">{fmt(o.total)}</td>
                      <td className="px-3 py-3 hidden md:table-cell text-gray-500 capitalize">{(o.payment_methods ?? '—').replace(/_/g, ' ')}</td>
                      <td className="px-3 py-3 hidden lg:table-cell text-gray-500">{o.employee_name}</td>
                      <td className="px-3 py-3">
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-500')}>
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setDetailId(o.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700" title="View"><Eye size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {detailId && (
        <OrderDetailDrawer
          orderId={detailId}
          order={list.find((o) => o.id === detailId) ?? null}
          onClose={() => { setDetailId(null); void refetch(); }}
        />
      )}
    </div>
  );
}

// ─── Detail drawer ──────────────────────────────────────────────────────────

function OrderDetailDrawer({ orderId, order, onClose }: {
  orderId: string;
  order:   OrderHistoryRow | null;
  onClose: () => void;
}) {
  const { data: receipt, isLoading } = useQuery({
    queryKey: ['order', 'receipt', orderId],
    queryFn:  () => ordersApi.getReceipt(orderId),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl animate-slide-in-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{receipt?.orderNumber ?? order?.order_number ?? 'Order'}</h2>
            {order && <p className="text-xs text-gray-400">{new Date(order.created_at).toLocaleString()}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 receipt-content">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-shimmer" />)}</div>
          ) : receipt ? (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">
                <p>Employee: <span className="text-gray-700">{receipt.employeeName}</span></p>
                {receipt.customerName && <p>Customer: <span className="text-gray-700">{receipt.customerName}</span></p>}
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Items</p>
                {receipt.lineItems.map((li, i) => (
                  <div key={i} className={clsx('flex justify-between text-sm py-1', li.voided && 'opacity-40 line-through')}>
                    <span className="text-gray-700">{li.quantity}× {li.name}</span>
                    <span className="text-gray-700 tabular-nums">{fmt(li.total)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{fmt(receipt.subtotal)}</span></div>
                {receipt.discountTotal > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>−{fmt(receipt.discountTotal)}</span></div>}
                <div className="flex justify-between text-gray-500"><span>Tax</span><span>{fmt(receipt.taxTotal)}</span></div>
                {receipt.tipTotal > 0 && <div className="flex justify-between text-gray-500"><span>Tip</span><span>{fmt(receipt.tipTotal)}</span></div>}
                <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-100"><span>Total</span><span>{fmt(receipt.total)}</span></div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Payments</p>
                {receipt.payments.length === 0 ? <p className="text-sm text-gray-400">No payments recorded</p> : receipt.payments.map((p, i) => (
                  <div key={i} className="flex justify-between text-sm py-0.5">
                    <span className="text-gray-600 capitalize">{p.method.replace(/_/g, ' ')}{p.last4 ? ` ••${p.last4}` : ''}</span>
                    <span className="text-gray-700 tabular-nums">{fmt(p.amount + p.tipAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Could not load order details.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 shrink-0 flex items-center gap-2 no-print">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50">
            <Printer size={14} /> Print
          </button>
          {/* Void / Refund actions added in S2-02 */}
        </div>
      </div>
    </div>
  );
}
