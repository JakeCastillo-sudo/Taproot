/**
 * DiscountsSettingsPage — /settings/discounts
 *
 * Manage promo codes (percentage / fixed / BOGO / free item), active windows,
 * usage limits, and view redemption reporting. Codes are applied in the POS cart
 * ("Add discount") and validated server-side.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Tag } from 'lucide-react';
import { clsx } from 'clsx';
import { discounts as discApi, type DiscountRow, type DiscountType } from '../lib/api';
import { showToast } from '../components/ui/Toast';

function fmt(c: number): string { return `$${(Number(c) / 100).toFixed(2)}`; }
function toCents(s: string): number { const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; }

const TYPE_LABEL: Record<DiscountType, string> = {
  percentage: 'Percentage', fixed_amount: 'Fixed amount', bogo: 'BOGO', free_item: 'Free item',
};

function valueDisplay(d: DiscountRow): string {
  if (d.discount_type === 'percentage') return `${d.value}%`;
  if (d.discount_type === 'fixed_amount') return fmt(d.value);
  return TYPE_LABEL[d.discount_type];
}

interface EditState {
  id: string | null; name: string; code: string; discountType: DiscountType;
  valueInput: string; minOrder: string; usageLimit: string; stackable: boolean;
  activeUntil: string;
}
const EMPTY: EditState = { id: null, name: '', code: '', discountType: 'percentage', valueInput: '', minOrder: '', usageLimit: '', stackable: true, activeUntil: '' };

export function DiscountsSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);

  const { data: list, isLoading } = useQuery({ queryKey: ['discounts'], queryFn: () => discApi.list() });
  const { data: report } = useQuery({ queryKey: ['discounts', 'report'], queryFn: () => discApi.report(), staleTime: 60_000 });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['discounts'] }); };

  const remove = useMutation({
    mutationFn: (id: string) => discApi.remove(id),
    onSuccess: () => { showToast.success('Discount deleted'); refresh(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const savedFor = (id: string) => report?.find((r) => r.id === id);
  const discounts = list ?? [];

  const openEdit = (d: DiscountRow) => setEditing({
    id: d.id, name: d.name, code: d.code ?? '', discountType: d.discount_type,
    valueInput: d.discount_type === 'fixed_amount' ? (d.value / 100).toFixed(2) : String(d.value),
    minOrder: d.minimum_order_amount != null ? (d.minimum_order_amount / 100).toFixed(2) : '',
    usageLimit: d.usage_limit != null ? String(d.usage_limit) : '',
    stackable: d.stackable, activeUntil: d.active_until ? d.active_until.slice(0, 10) : '',
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Discounts</h1>
        <button onClick={() => setEditing({ ...EMPTY })} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark"><Plus size={16} /> Add Discount</button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
        ) : discounts.length === 0 ? (
          <div className="text-center py-16"><Tag size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No discounts yet</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 md:px-6 py-2">Name</th>
                <th className="text-left font-medium px-3 py-2">Code</th>
                <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Type</th>
                <th className="text-right font-medium px-3 py-2">Value</th>
                <th className="text-right font-medium px-3 py-2 hidden md:table-cell">Used</th>
                <th className="text-right font-medium px-3 py-2 hidden lg:table-cell">Saved</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-right font-medium px-4 md:px-6 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-white">
                  <td className="px-4 md:px-6 py-3 font-medium text-gray-800">{d.name}</td>
                  <td className="px-3 py-3 font-mono text-gray-600">{d.code ?? '—'}</td>
                  <td className="px-3 py-3 hidden sm:table-cell text-gray-500">{TYPE_LABEL[d.discount_type]}</td>
                  <td className="px-3 py-3 text-right font-medium text-gray-700">{valueDisplay(d)}</td>
                  <td className="px-3 py-3 text-right text-gray-500 hidden md:table-cell">{d.usage_count}{d.usage_limit != null ? `/${d.usage_limit}` : ''}</td>
                  <td className="px-3 py-3 text-right text-gray-500 hidden lg:table-cell">{fmt(savedFor(d.id)?.total_saved ?? 0)}</td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full', d.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500')}>{d.is_active ? 'Active' : 'Off'}</span>
                  </td>
                  <td className="px-4 md:px-6 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(d)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"><Pencil size={14} /></button>
                      <button onClick={() => window.confirm(`Delete "${d.name}"?`) && remove.mutate(d.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && <DiscountModal state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); void qc.invalidateQueries({ queryKey: ['discounts', 'report'] }); }} />}
    </div>
  );
}

function DiscountModal({ state, onClose, onSaved }: { state: EditState; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditState>(state);
  const isPct = form.discountType === 'percentage';

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const value = isPct ? (parseFloat(form.valueInput) || 0) : toCents(form.valueInput);
      const body = {
        name: form.name.trim(), code: form.code.trim() || null, discountType: form.discountType, value,
        minimumOrderAmount: form.minOrder ? toCents(form.minOrder) : null,
        usageLimit: form.usageLimit ? parseInt(form.usageLimit, 10) : null,
        stackable: form.stackable,
        activeUntil: form.activeUntil ? new Date(form.activeUntil).toISOString() : null,
      };
      if (form.id) await discApi.update(form.id, body);
      else await discApi.create(body);
    },
    onSuccess: () => { showToast.success(form.id ? 'Discount updated' : 'Discount created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Discount' : 'Add Discount'}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label><input autoFocus className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Happy Hour" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Code</label><input className={field + ' font-mono'} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="HAPPY10" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Type</label>
              <select className={field + ' bg-white'} value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as DiscountType }))}>
                <option value="percentage">Percentage</option><option value="fixed_amount">Fixed amount</option>
                <option value="bogo">BOGO</option><option value="free_item">Free item</option>
              </select></div>
          </div>
          {(isPct || form.discountType === 'fixed_amount') && (
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">{isPct ? 'Percent off' : 'Amount off ($)'}</label>
              <input className={field} inputMode="decimal" value={form.valueInput} onChange={(e) => setForm((f) => ({ ...f, valueInput: e.target.value }))} placeholder={isPct ? '10' : '5.00'} /></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Min order ($)</label><input className={field} inputMode="decimal" value={form.minOrder} onChange={(e) => setForm((f) => ({ ...f, minOrder: e.target.value }))} placeholder="Optional" /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Usage limit</label><input type="number" min={0} className={field} value={form.usageLimit} onChange={(e) => setForm((f) => ({ ...f, usageLimit: e.target.value }))} placeholder="Unlimited" /></div>
          </div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Active until</label><input type="date" className={field} value={form.activeUntil} onChange={(e) => setForm((f) => ({ ...f, activeUntil: e.target.value }))} /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.stackable} onChange={(e) => setForm((f) => ({ ...f, stackable: e.target.checked }))} className="w-4 h-4 accent-primary" /><span className="text-sm text-gray-700">Stackable with other discounts</span></label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save'}</button></div>
      </div>
    </div>
  );
}
