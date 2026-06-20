/**
 * StudioCatalogPage — manage sellable studio catalog items (v2.1): drop-ins, class
 * packs, add-ons, memberships. These are normal products (item_type + studio_meta)
 * sold via the EXISTING checkout — this UI just CRUDs them.
 *
 * STUDIO-GATED via useRequireStudio(); the nav item is hidden unless studio is on.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Boxes, Plus, X, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { studioCatalog as catalogApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { useRequireStudio } from '../hooks/useCapabilities';
import type { StudioCatalogItem, StudioItemType } from '@taproot/shared';

const ITEM_TYPES: StudioItemType[] = ['drop_in', 'class_pack', 'add_on', 'membership', 'gift_card'];
const TYPE_LABEL: Record<string, string> = {
  drop_in: 'Drop-in', class_pack: 'Class pack', add_on: 'Add-on', membership: 'Membership', gift_card: 'Gift card',
};
const fmtCents = (c: number | null): string => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);

export function StudioCatalogPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { ready, allowed } = useRequireStudio();
  const [editing, setEditing] = useState<Partial<StudioCatalogItem> | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ['studio-catalog'],
    queryFn: () => catalogApi.list(),
    enabled: ready && allowed,
    retry: false,
  });

  if (!ready) return <div className="h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  if (!allowed) return null;

  const refresh = (): void => void qc.invalidateQueries({ queryKey: ['studio-catalog'] });
  const list = items ?? [];

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><Boxes size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">Studio Catalog</h1>
          </div>
          <div className="flex-1" />
          <button onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark"><Plus size={14} /> Add item</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : list.length === 0 ? (
            <div className="text-center py-16"><Boxes size={36} className="text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No studio items yet</p></div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-100 overflow-clip">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2">Type</th>
                    <th className="text-right font-medium px-3 py-2">Price</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((it) => (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-medium text-gray-800">{it.name}{!it.is_active && <span className="ml-2 text-[10px] text-gray-400">inactive</span>}</td>
                      <td className="px-3 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{TYPE_LABEL[it.item_type] ?? it.item_type}</span></td>
                      <td className="px-3 py-3 text-right font-semibold text-gray-800">{fmtCents(it.price_cents)}</td>
                      <td className="px-3 py-3 text-right"><button onClick={() => setEditing(it)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {editing && <StudioItemModal item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function StudioItemModal({ item, onClose, onSaved }: { item: Partial<StudioCatalogItem>; onClose: () => void; onSaved: () => void }) {
  const isEdit = Boolean(item.id);
  const meta = (item.studio_meta ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState({
    name: item.name ?? '',
    itemType: (item.item_type && ITEM_TYPES.includes(item.item_type as StudioItemType) ? item.item_type : 'drop_in') as StudioItemType,
    priceDollars: item.price_cents != null ? (item.price_cents / 100).toFixed(2) : '',
    description: item.description ?? '',
    creditCount: typeof meta.credit_count === 'number' ? String(meta.credit_count) : '',
    isActive: item.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const priceCents = form.priceDollars.trim() ? Math.round(parseFloat(form.priceDollars) * 100) : undefined;
      if (priceCents !== undefined && (!Number.isFinite(priceCents) || priceCents < 0)) throw new Error('Invalid price');
      const studioMeta = form.itemType === 'class_pack' && form.creditCount.trim()
        ? { credit_count: Math.max(1, parseInt(form.creditCount, 10) || 0) }
        : undefined;
      if (isEdit && item.id) {
        return catalogApi.update(item.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          priceCents: priceCents ?? null,
          isActive: form.isActive,
          ...(studioMeta ? { studioMeta } : {}),
        });
      }
      return catalogApi.create({
        name: form.name.trim(),
        itemType: form.itemType,
        priceCents,
        description: form.description.trim() || undefined,
        studioMeta,
      });
    },
    onSuccess: () => { showToast.success(isEdit ? 'Item updated' : 'Item created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"><h2 className="text-base font-bold text-gray-900">{isEdit ? 'Edit Studio Item' : 'Add Studio Item'}</h2><button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button></div>
        <div className="px-5 py-4 space-y-3">
          <input className={field} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name (e.g. 10-Class Pack)" />
          <select className={clsx(field, 'capitalize', isEdit && 'opacity-60')} value={form.itemType} disabled={isEdit} onChange={(e) => setForm((f) => ({ ...f, itemType: e.target.value as StudioItemType }))}>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <input className={field} value={form.priceDollars} onChange={(e) => setForm((f) => ({ ...f, priceDollars: e.target.value }))} placeholder="Price (USD, e.g. 120.00)" inputMode="decimal" />
          {form.itemType === 'class_pack' && (
            <input className={field} value={form.creditCount} onChange={(e) => setForm((f) => ({ ...f, creditCount: e.target.value }))} placeholder="Credits in pack (e.g. 10)" inputMode="numeric" />
          )}
          <textarea className={field + ' resize-none'} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" />
          {isEdit && (
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active</label>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button><button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">Save</button></div>
      </div>
    </div>
  );
}
