/**
 * ModifiersSettingsPage — /settings/modifiers
 *
 * Accordion of modifier groups. Each group expands to show its modifiers
 * (inline add/edit/reorder/delete) and a product-assignment picker. Prices are
 * shown in dollars, stored in cents (price deltas may be negative).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ChevronDown, ChevronRight, Pencil, Trash2, X, SlidersHorizontal,
  ArrowUp, ArrowDown, Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  modifiers as modifiersApi, products as productsApi,
  type ModifierGroupFull, type ModifierItem, type ModifierSelectionType,
} from '../lib/api';
import { QK } from '../lib/queryClient';
import { showToast } from '../components/ui/Toast';

const SELECTION_LABELS: Record<ModifierSelectionType, string> = {
  single:            'Choose one (optional)',
  multiple:          'Choose any (optional)',
  required_single:   'Required — choose one',
  required_multiple: 'Required — choose minimum',
};

function fmtDelta(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function dollarsToCents(input: string): number {
  const neg = input.trim().startsWith('-');
  const cleaned = input.replace(/[^0-9.]/g, '');
  const dollars = parseFloat(cleaned);
  if (!isFinite(dollars)) return 0;
  return Math.round(dollars * 100) * (neg ? -1 : 1);
}

// ─── Group modal ────────────────────────────────────────────────────────────

interface GroupEdit {
  id:            string | null;
  name:          string;
  selectionType: ModifierSelectionType;
  minSelections: number;
  maxSelections: string; // '' = none
}

function GroupModal({ state, onClose, onSaved }: {
  state: GroupEdit; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<GroupEdit>(state);
  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Group name is required');
      const required = form.selectionType.startsWith('required');
      const body = {
        name:          form.name.trim(),
        selectionType: form.selectionType,
        minSelections: required ? Math.max(1, form.minSelections) : 0,
        maxSelections: form.maxSelections ? parseInt(form.maxSelections, 10) : null,
      };
      if (form.id) await modifiersApi.updateGroup(form.id, body);
      else await modifiersApi.createGroup(body);
    },
    onSuccess: () => { showToast.success(form.id ? 'Group updated' : 'Group created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const required = form.selectionType.startsWith('required');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Group' : 'Add Group'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
            <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Temperature, Add-ons…" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Selection type</label>
            <select value={form.selectionType} onChange={(e) => setForm((f) => ({ ...f, selectionType: e.target.value as ModifierSelectionType }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="single">Single — choose one (optional)</option>
              <option value="multiple">Multiple — choose any (optional)</option>
              <option value="required_single">Required Single — must choose one</option>
              <option value="required_multiple">Required Multiple — must choose minimum</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Min selections</label>
              <input type="number" min={0} disabled={!required} value={form.minSelections}
                onChange={(e) => setForm((f) => ({ ...f, minSelections: parseInt(e.target.value, 10) || 0 }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-gray-50 disabled:text-gray-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Max selections</label>
              <input type="number" min={1} value={form.maxSelections} placeholder="No limit"
                onChange={(e) => setForm((f) => ({ ...f, maxSelections: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
            {save.isPending ? 'Saving…' : form.id ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group card ─────────────────────────────────────────────────────────────

function GroupCard({ group, products, onChanged, onEdit }: {
  group:     ModifierGroupFull;
  products:  Array<{ id: string; name: string }>;
  onChanged: () => void;
  onEdit:    (g: ModifierGroupFull) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName]   = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  const del = useMutation({
    mutationFn: () => modifiersApi.deleteGroup(group.id),
    onSuccess: () => { showToast.success('Group deleted'); onChanged(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });
  const addMod = useMutation({
    mutationFn: () => modifiersApi.addModifier(group.id, { name: newName.trim(), priceDelta: dollarsToCents(newPrice) }),
    onSuccess: () => { setNewName(''); setNewPrice(''); onChanged(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Add failed'),
  });
  const updMod = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof modifiersApi.updateModifier>[1] }) => modifiersApi.updateModifier(v.id, v.body),
    onSuccess: onChanged,
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Update failed'),
  });
  const delMod = useMutation({
    mutationFn: (id: string) => modifiersApi.deleteModifier(id),
    onSuccess: onChanged,
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });
  const assign = useMutation({
    mutationFn: (productIds: string[]) => modifiersApi.setGroupProducts(group.id, productIds),
    onSuccess: () => { showToast.success('Assignments saved'); onChanged(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const move = (m: ModifierItem, dir: -1 | 1) => {
    const sorted = [...group.modifiers].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((x) => x.id === m.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    updMod.mutate({ id: m.id, body: { sortOrder: swap.sortOrder } });
    updMod.mutate({ id: swap.id, body: { sortOrder: m.sortOrder } });
  };

  const sortedMods = [...group.modifiers].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setOpen((v) => !v)} className="text-gray-400 hover:text-gray-600">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
          <p className="text-sm font-semibold text-gray-800 truncate">{group.name}</p>
          <p className="text-xs text-gray-400">
            {SELECTION_LABELS[group.selectionType]} · {group.modifiers.length} option{group.modifiers.length !== 1 ? 's' : ''}
            {group.productIds.length > 0 && ` · ${group.productIds.length} product${group.productIds.length !== 1 ? 's' : ''}`}
          </p>
        </button>
        <button onClick={() => onEdit(group)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"><Pencil size={14} /></button>
        <button onClick={() => { if (window.confirm(`Delete group "${group.name}" and all its options?`)) del.mutate(); }}
          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
      </div>

      {open && (
        <div className="border-t border-gray-50 px-4 py-3 bg-gray-50/50 space-y-3">
          {/* Modifiers */}
          <div className="space-y-1.5">
            {sortedMods.map((m, i) => (
              <div key={m.id} className="flex items-center gap-2 bg-white rounded-md border border-gray-100 px-3 py-2">
                <div className="flex flex-col">
                  <button disabled={i === 0} onClick={() => move(m, -1)} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={11} /></button>
                  <button disabled={i === sortedMods.length - 1} onClick={() => move(m, 1)} className="text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={11} /></button>
                </div>
                <span className="flex-1 text-sm text-gray-700 truncate">{m.name}</span>
                <span className={clsx('text-xs font-medium tabular-nums', m.priceDelta < 0 ? 'text-green-600' : 'text-gray-500')}>
                  {m.priceDelta === 0 ? '—' : fmtDelta(m.priceDelta)}
                </span>
                <button
                  title="Default selection"
                  onClick={() => updMod.mutate({ id: m.id, body: { isDefault: !m.isDefault } })}
                  className={clsx('flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors',
                    m.isDefault ? 'bg-primary/10 text-primary' : 'text-gray-400 hover:bg-gray-100')}
                >
                  <Check size={11} /> Default
                </button>
                <button onClick={() => delMod.mutate(m.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          {/* Add modifier inline */}
          <div className="flex items-center gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add option (e.g. Extra cheese)"
              className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) addMod.mutate(); }} />
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
              <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" inputMode="decimal"
                className="w-full pl-5 pr-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <button onClick={() => newName.trim() && addMod.mutate()} disabled={!newName.trim() || addMod.isPending}
              className="px-3 py-1.5 bg-gray-800 text-white text-xs font-semibold rounded-md hover:bg-gray-900 disabled:opacity-40">Add</button>
          </div>

          {/* Product assignment */}
          <div className="pt-2 border-t border-gray-100">
            <button onClick={() => setShowAssign((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {showAssign ? 'Hide' : 'Assign to products'} ({group.productIds.length})
            </button>
            {showAssign && (
              <AssignProducts
                products={products}
                assigned={group.productIds}
                saving={assign.isPending}
                onSave={(ids) => assign.mutate(ids)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignProducts({ products, assigned, onSave, saving }: {
  products: Array<{ id: string; name: string }>;
  assigned: string[];
  onSave:   (ids: string[]) => void;
  saving:   boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(assigned));
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  return (
    <div className="mt-2">
      <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1 border border-gray-100 rounded-md p-2 bg-white">
        {products.map((p) => (
          <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="w-4 h-4 accent-primary" />
            <span className="text-sm text-gray-700 truncate">{p.name}</span>
          </label>
        ))}
        {products.length === 0 && <p className="text-xs text-gray-400 p-2">No products available</p>}
      </div>
      <button onClick={() => onSave([...sel])} disabled={saving}
        className="mt-2 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
        {saving ? 'Saving…' : 'Save assignments'}
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ModifiersSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<GroupEdit | null>(null);

  const { data: groups, isLoading } = useQuery({
    queryKey: ['modifier-groups'],
    queryFn:  () => modifiersApi.listGroups(),
    staleTime: 60_000,
  });

  const { data: productData } = useQuery({
    queryKey: QK.products({ scope: 'modifier-assign' }),
    queryFn:  () => productsApi.list({ perPage: 200 }),
    staleTime: 60_000,
  });
  const products = useMemo(
    () => (productData?.products ?? []).map((p) => ({ id: p.id, name: p.name })),
    [productData],
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['modifier-groups'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };

  const list = groups ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Modifiers</h1>
        <button
          onClick={() => setEditing({ id: null, name: '', selectionType: 'single', minSelections: 0, maxSelections: '' })}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark transition-colors"
        >
          <Plus size={16} /> Add Group
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2 max-w-2xl">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded animate-shimmer" />)}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <SlidersHorizontal size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">No modifier groups yet</p>
            <button onClick={() => setEditing({ id: null, name: '', selectionType: 'single', minSelections: 0, maxSelections: '' })}
              className="mt-2 text-sm text-primary hover:underline">Add your first group →</button>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {list.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                products={products}
                onChanged={invalidate}
                onEdit={(grp) => setEditing({
                  id: grp.id, name: grp.name, selectionType: grp.selectionType,
                  minSelections: grp.minSelections, maxSelections: grp.maxSelections?.toString() ?? '',
                })}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <GroupModal state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />
      )}
    </div>
  );
}
