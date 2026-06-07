/**
 * CustomersPage — /customers
 *
 * Customer list with search, lifetime value, visits, loyalty points/tier and
 * tags. Row opens a profile drawer (recent orders, edit, adjust points). Create
 * new customers and export the list to CSV.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, Search, Plus, Download, X, Pencil, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { customers as custApi } from '../lib/api';
import { FDA_ALLERGENS, ALLERGEN_LABELS } from '../lib/allergens';
import { showToast } from '../components/ui/Toast';
import type { Customer } from '@taproot/shared';

function fmt(c: number): string { return `$${(Number(c) / 100).toFixed(2)}`; }
function fullName(c: Customer): string { return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(no name)'; }

const TIER_BADGE: Record<string, string> = {
  none: 'bg-gray-100 text-gray-500', bronze: 'bg-amber-50 text-amber-700',
  silver: 'bg-gray-100 text-gray-600', gold: 'bg-yellow-50 text-yellow-700', platinum: 'bg-purple-50 text-purple-700',
};

export function CustomersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn:  () => custApi.list({ search: search || undefined, perPage: 200, orderBy: 'total_spend', orderDir: 'desc' }),
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['customers'] });
  const list = data?.customers ?? [];

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Phone', 'Lifetime Value', 'Visits', 'Points', 'Tier', 'Tags'];
    const rows = list.map((c) => [fullName(c), c.email ?? '', c.phone ?? '',
      (Number(c.total_spend) / 100).toFixed(2), c.visit_count, c.loyalty_points, c.loyalty_tier, (c.tags ?? []).join('|')]);
    const csv = [headers, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><Users size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Customers</h1>
          </div>
          <div className="flex-1" />
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50"><Download size={13} /> Export</button>
          <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark"><Plus size={14} /> Add</button>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone…"
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-16"><Users size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No customers found</p></div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Contact</th>
                    <th className="text-right font-medium px-3 py-2">Lifetime</th>
                    <th className="text-right font-medium px-3 py-2 hidden md:table-cell">Visits</th>
                    <th className="text-right font-medium px-3 py-2 hidden md:table-cell">Points</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} onClick={() => setDetailId(c.id)} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-gray-800">{fullName(c)}
                        {(c.tags ?? []).length > 0 && <span className="ml-2 text-[10px] text-gray-400">{(c.tags ?? []).slice(0, 2).join(', ')}</span>}
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell text-gray-500 text-xs">{c.email ?? c.phone ?? '—'}</td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-800">{fmt(c.total_spend)}</td>
                      <td className="px-3 py-3 text-right text-gray-500 hidden md:table-cell">{c.visit_count}</td>
                      <td className="px-3 py-3 text-right text-gray-500 hidden md:table-cell">{c.loyalty_points}</td>
                      <td className="px-3 py-3 hidden lg:table-cell"><span className={clsx('text-xs px-2 py-0.5 rounded-full capitalize', TIER_BADGE[c.loyalty_tier] ?? 'bg-gray-100 text-gray-500')}>{c.loyalty_tier}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {detailId && <CustomerDrawer id={detailId} customer={list.find((c) => c.id === detailId) ?? null}
        onClose={() => setDetailId(null)} onEdit={(c) => { setEditing(c); setDetailId(null); }} onChanged={refresh} />}
      {editing && <CustomerModal customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function CustomerDrawer({ id, customer, onClose, onEdit, onChanged }: {
  id: string; customer: Customer | null; onClose: () => void; onEdit: (c: Customer) => void; onChanged: () => void;
}) {
  const { data: orders } = useQuery({ queryKey: ['customer', id, 'orders'], queryFn: () => custApi.orders(id) });
  const remove = useMutation({
    mutationFn: () => custApi.remove(id),
    onSuccess: () => { showToast.success('Customer deleted'); onChanged(); onClose(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const adjust = useMutation({
    mutationFn: (delta: number) => custApi.adjustLoyalty(id, delta, 'Manual adjustment'),
    onSuccess: () => { showToast.success('Points adjusted'); onChanged(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Failed'),
  });
  if (!customer) return null;
  const ords = orders?.orders ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl animate-slide-in-left" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">{fullName(customer)}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(customer)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
            <button onClick={() => window.confirm('Delete this customer?') && remove.mutate()} className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Lifetime value" value={fmt(customer.total_spend)} />
            <Stat label="Visits" value={String(customer.visit_count)} />
            <Stat label="Loyalty points" value={String(customer.loyalty_points)} />
            <Stat label="Account credit" value={fmt(customer.account_credit)} />
          </div>
          <div className="text-xs text-gray-500 space-y-0.5">
            {customer.email && <p>✉ {customer.email}</p>}
            {customer.phone && <p>☎ {customer.phone}</p>}
            {customer.notes && <p className="italic">{customer.notes}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => adjust.mutate(50)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50">+50 pts</button>
            <button onClick={() => adjust.mutate(-50)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50">−50 pts</button>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Recent orders</p>
            {ords.length === 0 ? <p className="text-sm text-gray-400">No orders yet</p> : (
              <div className="space-y-1">
                {ords.slice(0, 10).map((o, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-600">{String((o as { order_number?: string }).order_number ?? '—')}</span>
                    <span className="text-gray-700">{fmt(Number((o as { total?: number }).total ?? 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="bg-gray-50 rounded-md p-3"><p className="text-xs text-gray-400">{label}</p><p className="text-base font-bold text-gray-900 mt-0.5">{value}</p></div>;
}

function CustomerModal({ customer, onClose, onSaved }: { customer: Partial<Customer>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    firstName: customer.first_name ?? '', lastName: customer.last_name ?? '',
    email: customer.email ?? '', phone: customer.phone ?? '',
    tags: (customer.tags ?? []).join(', '), notes: customer.notes ?? '',
    allergens: customer.allergens ?? [] as string[],
  });
  // Only send allergens when touched — keeps saves working while migration 019 is pending
  const [allergensTouched, setAllergensTouched] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        firstName: form.firstName.trim() || undefined, lastName: form.lastName.trim() || undefined,
        email: form.email.trim() || undefined, phone: form.phone.trim() || undefined,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        notes: form.notes.trim() || undefined,
        ...(allergensTouched && customer.id ? { allergens: form.allergens } : {}),
      };
      if (!body.firstName && !body.lastName && !body.email && !body.phone) throw new Error('Enter at least a name, email, or phone');
      if (customer.id) return custApi.update(customer.id, body);
      const created = await custApi.create(body);
      // Allergen profile applies via update (create endpoint doesn't accept it)
      if (allergensTouched && form.allergens.length && created?.id) {
        await custApi.update(created.id, { allergens: form.allergens });
      }
      return created;
    },
    onSuccess: () => { showToast.success(customer.id ? 'Customer updated' : 'Customer created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{customer.id ? 'Edit Customer' : 'Add Customer'}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className={field} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="First name" />
            <input className={field} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="Last name" />
          </div>
          <input className={field} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" />
          <input className={field} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" inputMode="tel" />
          <input className={field} value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags (comma separated)" />
          <textarea className={field + ' resize-none'} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" />
          {/* Allergen profile (S8-05) */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Allergens on file</p>
            <div className="grid grid-cols-3 gap-1">
              {FDA_ALLERGENS.map((a) => (
                <label key={a} className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.allergens.includes(a)}
                    onChange={() => {
                      setAllergensTouched(true);
                      setForm((f) => ({
                        ...f,
                        allergens: f.allergens.includes(a)
                          ? f.allergens.filter((x) => x !== a)
                          : [...f.allergens, a],
                      }));
                    }}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  <span className="text-xs text-gray-700">{ALLERGEN_LABELS[a]}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">The register warns before adding items containing these.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Save</button></div>
      </div>
    </div>
  );
}
