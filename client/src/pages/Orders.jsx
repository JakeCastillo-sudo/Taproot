import React, { useState } from 'react';
import { Eye, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFetch, apiPatch } from '../hooks/useApi';
import Modal from '../components/Modal';
import { useApp } from '../context/AppContext';

export default function Orders() {
  const { settings } = useApp();
  const sym = settings.currency_symbol || '$';
  const [page, setPage] = useState(0);
  const [dateFilter, setDateFilter] = useState('');
  const [viewing, setViewing] = useState(null);
  const limit = 20;

  const queryParams = new URLSearchParams({ limit, offset: page * limit });
  if (dateFilter) queryParams.set('date', dateFilter);
  const { data, refetch } = useFetch(`/api/orders?${queryParams}`, [page, dateFilter]);

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const pages = Math.ceil(total / limit);
  const fmt = (n) => `${sym}${Number(n || 0).toFixed(2)}`;

  async function handleVoid(id) {
    if (!confirm('Void this order? This cannot be undone.')) return;
    await apiPatch(`/api/orders/${id}/void`);
    refetch();
    setViewing(null);
  }

  async function openOrder(o) {
    const res = await fetch(`/api/orders/${o.id}`);
    setViewing(await res.json());
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Orders</h1>
        <div className="flex items-center gap-3">
          <input type="date" className="input w-auto" value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(0); }} />
          {dateFilter && <button onClick={() => { setDateFilter(''); setPage(0); }} className="btn-ghost text-xs">Clear</button>}
          <span className="text-sm text-gray-500">{total} total</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Order #</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Payment</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map(o => (
              <tr key={o.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{o.order_number}</td>
                <td className="px-4 py-3 text-gray-500">{new Date(o.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 capitalize">{o.payment_method}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmt(o.total)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    o.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>{o.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openOrder(o)} className="btn-ghost p-1.5 rounded-lg">
                      <Eye size={14} />
                    </button>
                    {o.status === 'completed' && (
                      <button onClick={() => handleVoid(o.id)} className="btn-ghost p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50">
                        <Ban size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">No orders found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary p-2">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-600">Page {page + 1} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="btn-secondary p-2">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Order Detail" size="lg">
        {viewing && (
          <div className="p-5 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div><span className="text-gray-500">Order #</span><p className="font-mono font-medium">{viewing.order_number}</p></div>
              <div><span className="text-gray-500">Date</span><p>{new Date(viewing.created_at).toLocaleString()}</p></div>
              <div><span className="text-gray-500">Payment</span><p className="capitalize">{viewing.payment_method}</p></div>
              <div><span className="text-gray-500">Status</span>
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 ${
                  viewing.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                }`}>{viewing.status}</span>
              </div>
            </div>
            {viewing.note && <div className="bg-yellow-50 rounded-lg p-3 text-xs text-yellow-800">Note: {viewing.note}</div>}
            <table className="w-full border-t pt-2">
              <thead><tr className="text-xs text-gray-500 border-b">
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2">Qty</th>
                <th className="text-right py-2">Unit</th>
                <th className="text-right py-2">Total</th>
              </tr></thead>
              <tbody className="divide-y">
                {(viewing.items || []).map(i => (
                  <tr key={i.id}>
                    <td className="py-2">{i.product_name}</td>
                    <td className="py-2 text-right">{i.quantity}</td>
                    <td className="py-2 text-right">{fmt(i.unit_price)}</td>
                    <td className="py-2 text-right font-medium">{fmt(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="space-y-1 border-t pt-3 text-xs">
              <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{fmt(viewing.subtotal)}</span></div>
              {viewing.discount > 0 && <div className="flex justify-between text-red-500"><span>Discount</span><span>-{fmt(viewing.discount)}</span></div>}
              <div className="flex justify-between text-gray-500"><span>Tax</span><span>{fmt(viewing.tax)}</span></div>
              <div className="flex justify-between font-bold text-base"><span>Total</span><span>{fmt(viewing.total)}</span></div>
              {viewing.payment_method === 'cash' && viewing.change_due != null && (
                <div className="flex justify-between text-green-600"><span>Change</span><span>{fmt(viewing.change_due)}</span></div>
              )}
            </div>
            {viewing.status === 'completed' && (
              <button onClick={() => handleVoid(viewing.id)} className="btn-danger w-full">
                <Ban size={14} /> Void Order
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
