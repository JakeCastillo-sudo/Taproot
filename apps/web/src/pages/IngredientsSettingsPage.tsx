/**
 * IngredientsSettingsPage — /settings/ingredients
 *
 * Ingredient master library: CRUD, stock levels + status, stock adjustment with
 * movement history, and universal add-on configuration. Money in cents.
 */
import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, X, Carrot, Plus as PlusIcon, Minus, ChevronDown, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  ingredientsApi, SUPPORTED_UNITS, type Ingredient, type IngredientInput, type StockMovement,
} from '../lib/api';
import { showToast } from '../components/ui/Toast';

const CATEGORIES = ['produce', 'dairy', 'meat', 'dry', 'beverage', 'spice', 'other'] as const;
const MOVEMENT_TYPES = [
  { value: 'received_delivery', label: 'Received delivery' },
  { value: 'manual_count', label: 'Manual count' },
  { value: 'waste', label: 'Waste' },
  { value: 'other', label: 'Other' },
];

function fmt(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function dollarsToCents(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return isFinite(n) ? Math.round(n * 100) : 0;
}

function stockStatus(i: Ingredient): { label: string; cls: string } {
  const s = Number(i.current_stock);
  if (s <= 0) return { label: 'Out', cls: 'bg-gray-100 text-gray-500' };
  if (s < Number(i.reorder_point)) return { label: 'Critical', cls: 'bg-red-50 text-red-600' };
  if (s < Number(i.par_level)) return { label: 'Low', cls: 'bg-amber-50 text-amber-600' };
  return { label: 'OK', cls: 'bg-green-50 text-green-600' };
}

// ─── Create / edit modal ────────────────────────────────────────────────────

interface EditState extends IngredientInput { id: string | null }

const EMPTY: EditState = {
  id: null, name: '', unit: 'qty', unitLabel: '', costPerUnit: 0,
  currentStock: 0, parLevel: 0, reorderPoint: 0,
  isUniversalAddon: false, universalAddonPrice: 0, universalAddonLabel: '', category: 'other',
};

function IngredientModal({ state, onClose, onSaved }: {
  state: EditState; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<EditState>(state);
  const [costInput, setCostInput] = useState((state.costPerUnit ?? 0) ? ((state.costPerUnit ?? 0) / 100).toFixed(2) : '');
  const [addonInput, setAddonInput] = useState((state.universalAddonPrice ?? 0) ? ((state.universalAddonPrice ?? 0) / 100).toFixed(2) : '');

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name is required');
      const payload: IngredientInput = {
        name: form.name.trim(),
        unit: form.unit,
        unitLabel: form.unit === 'custom' ? (form.unitLabel || null) : null,
        costPerUnit: dollarsToCents(costInput),
        currentStock: Number(form.currentStock) || 0,
        parLevel: Number(form.parLevel) || 0,
        reorderPoint: Number(form.reorderPoint) || 0,
        isUniversalAddon: form.isUniversalAddon,
        universalAddonPrice: form.isUniversalAddon ? dollarsToCents(addonInput) : 0,
        universalAddonLabel: form.isUniversalAddon ? (form.universalAddonLabel || null) : null,
        category: form.category || null,
      };
      if (form.id) await ingredientsApi.update(form.id, payload);
      else await ingredientsApi.create(payload);
    },
    onSuccess: () => { showToast.success(form.id ? 'Ingredient updated' : 'Ingredient created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const set = <K extends keyof EditState>(k: K, v: EditState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Ingredient' : 'Add Ingredient'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="Cheddar Cheese" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select value={form.category ?? 'other'} onChange={(e) => set('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white capitalize">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Unit</label>
              <select value={form.unit} onChange={(e) => set('unit', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
                {SUPPORTED_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>
          {form.unit === 'custom' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Unit label</label>
              <input value={form.unitLabel ?? ''} onChange={(e) => set('unitLabel', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" placeholder="e.g. bottle" />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Cost / unit</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <input value={costInput} onChange={(e) => setCostInput(e.target.value)} inputMode="decimal"
                  className="w-full pl-5 pr-2 py-2 border border-gray-200 rounded-md text-sm" placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Par level</label>
              <input type="number" step="0.25" value={form.parLevel ?? 0} onChange={(e) => set('parLevel', Number(e.target.value))}
                className="w-full px-2 py-2 border border-gray-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Reorder pt</label>
              <input type="number" step="0.25" value={form.reorderPoint ?? 0} onChange={(e) => set('reorderPoint', Number(e.target.value))}
                className="w-full px-2 py-2 border border-gray-200 rounded-md text-sm" />
            </div>
          </div>
          {!form.id && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Starting stock</label>
              <input type="number" step="0.25" value={form.currentStock ?? 0} onChange={(e) => set('currentStock', Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
            </div>
          )}

          {/* Universal add-on */}
          <div className="pt-2 border-t border-gray-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isUniversalAddon} onChange={(e) => set('isUniversalAddon', e.target.checked)}
                className="w-4 h-4 accent-primary" />
              <span className="text-sm font-medium text-gray-700">Show as add-on on all menu items</span>
            </label>
            {form.isUniversalAddon && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Price when added</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                    <input value={addonInput} onChange={(e) => setAddonInput(e.target.value)} inputMode="decimal"
                      className="w-full pl-5 pr-2 py-2 border border-gray-200 rounded-md text-sm" placeholder="0.00 = free" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Label override</label>
                  <input value={form.universalAddonLabel ?? ''} onChange={(e) => set('universalAddonLabel', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" placeholder="Add Pickles" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
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

// ─── Stock adjustment modal ─────────────────────────────────────────────────

function StockModal({ ingredient, onClose, onSaved }: {
  ingredient: Ingredient; onClose: () => void; onSaved: () => void;
}) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  const [movementType, setMovementType] = useState('received_delivery');
  const [notes, setNotes] = useState('');

  const save = useMutation({
    mutationFn: () => ingredientsApi.adjustStock(ingredient.id, {
      quantityChange: sign * (parseFloat(amount) || 0),
      movementType, notes: notes.trim() || undefined,
    }),
    onSuccess: () => { showToast.success('Stock adjusted'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Adjustment failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Adjust stock · {ingredient.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-500">Current: <span className="font-semibold text-gray-800">{Number(ingredient.current_stock)} {ingredient.unit}</span></p>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              <button onClick={() => setSign(1)} className={clsx('px-3 py-2', sign === 1 ? 'bg-primary text-white' : 'text-gray-500')}><PlusIcon size={14} /></button>
              <button onClick={() => setSign(-1)} className={clsx('px-3 py-2', sign === -1 ? 'bg-danger text-white' : 'text-gray-500')}><Minus size={14} /></button>
            </div>
            <input type="number" step="0.25" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm" />
            <span className="text-sm text-gray-500">{ingredient.unit}</span>
          </div>
          <select value={movementType} onChange={(e) => setMovementType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-white">
            {MOVEMENT_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !amount}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Movement history (expandable) ──────────────────────────────────────────

function MovementHistory({ ingredientId }: { ingredientId: string }) {
  const { data: movements, isLoading } = useQuery({
    queryKey: ['ingredient-movements', ingredientId],
    queryFn: () => ingredientsApi.stockMovements(ingredientId, 20),
  });
  if (isLoading) return <p className="text-xs text-gray-400 px-4 py-2">Loading…</p>;
  if (!movements?.length) return <p className="text-xs text-gray-400 px-4 py-2">No stock movements yet.</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-gray-400">
        <tr><th className="text-left px-4 py-1">Date</th><th className="text-left px-2 py-1">Type</th>
          <th className="text-right px-2 py-1">Change</th><th className="text-right px-2 py-1">After</th>
          <th className="text-left px-2 py-1">Notes</th></tr>
      </thead>
      <tbody>
        {movements.map((m: StockMovement) => (
          <tr key={m.id} className="border-t border-gray-50">
            <td className="px-4 py-1 text-gray-500">{new Date(m.created_at).toLocaleDateString()}</td>
            <td className="px-2 py-1 text-gray-600">{m.movement_type.replace(/_/g, ' ')}</td>
            <td className={clsx('px-2 py-1 text-right font-medium', Number(m.quantity_change) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {Number(m.quantity_change) >= 0 ? '+' : ''}{Number(m.quantity_change)}
            </td>
            <td className="px-2 py-1 text-right text-gray-600">{Number(m.quantity_after)}</td>
            <td className="px-2 py-1 text-gray-400 truncate max-w-[160px]">{m.notes ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function IngredientsSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: ingredients, isLoading } = useQuery({
    queryKey: ['ingredients'],
    queryFn: () => ingredientsApi.list(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['ingredients'] });
    void qc.invalidateQueries({ queryKey: ['ingredient-movements'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => ingredientsApi.remove(id),
    onSuccess: () => { showToast.success('Ingredient deleted'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const list = ingredients ?? [];
  const stats = useMemo(() => {
    let low = 0, critical = 0, universal = 0;
    for (const i of list) {
      const s = stockStatus(i).label;
      if (s === 'Low') low++;
      if (s === 'Critical' || s === 'Out') critical++;
      if (i.is_universal_addon) universal++;
    }
    return { total: list.length, low, critical, universal };
  }, [list]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Ingredient Library</h1>
          <p className="text-sm text-gray-500">Manage ingredients, stock levels, and universal add-ons.</p>
        </div>
        <button onClick={() => setEditing({ ...EMPTY })}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">
          <Plus size={16} /> Add Ingredient
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Total ingredients', value: stats.total, cls: 'text-gray-900' },
            { label: 'Low stock', value: stats.low, cls: 'text-amber-600' },
            { label: 'Critical', value: stats.critical, cls: 'text-red-600' },
            { label: 'Universal add-ons', value: stats.universal, cls: 'text-primary' },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-gray-100 rounded-lg p-4">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={clsx('text-2xl font-bold mt-1', s.cls)}>{s.value}</p>
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />)}</div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Carrot size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">No ingredients yet</p>
            <button onClick={() => setEditing({ ...EMPTY })} className="mt-2 text-sm text-primary hover:underline">Add your first ingredient →</button>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="text-left font-medium px-4 py-2 w-6" />
                  <th className="text-left font-medium px-2 py-2">Name</th>
                  <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Category</th>
                  <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Unit</th>
                  <th className="text-right font-medium px-3 py-2">Stock</th>
                  <th className="text-right font-medium px-3 py-2 hidden lg:table-cell">Par</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Universal</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => {
                  const st = stockStatus(i);
                  const open = expanded === i.id;
                  return (
                    <Fragment key={i.id}>
                      <tr className="border-b border-gray-50 hover:bg-surface-2/40">
                        <td className="px-4 py-3">
                          <button onClick={() => setExpanded(open ? null : i.id)} className="text-gray-400 hover:text-gray-600">
                            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </button>
                        </td>
                        <td className="px-2 py-3 font-medium text-gray-800">{i.name}</td>
                        <td className="px-3 py-3 hidden sm:table-cell text-gray-500 capitalize">{i.category ?? '—'}</td>
                        <td className="px-3 py-3 hidden md:table-cell text-gray-500">{i.unit === 'custom' ? (i.unit_label ?? 'custom') : i.unit}</td>
                        <td className="px-3 py-3 text-right text-gray-700">{Number(i.current_stock)}</td>
                        <td className="px-3 py-3 text-right hidden lg:table-cell text-gray-400">{Number(i.par_level)}</td>
                        <td className="px-3 py-3"><span className={clsx('text-xs px-2 py-0.5 rounded-full', st.cls)}>{st.label}</span></td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          {i.is_universal_addon
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">Add-on {i.universal_addon_price ? fmt(i.universal_addon_price) : 'free'}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setAdjusting(i)} title="Adjust stock" className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><PlusIcon size={14} /></button>
                            <button onClick={() => setEditing({
                              id: i.id, name: i.name, unit: i.unit, unitLabel: i.unit_label, costPerUnit: i.cost_per_unit,
                              currentStock: i.current_stock, parLevel: i.par_level, reorderPoint: i.reorder_point,
                              isUniversalAddon: i.is_universal_addon, universalAddonPrice: i.universal_addon_price,
                              universalAddonLabel: i.universal_addon_label, category: i.category,
                            })} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
                            <button onClick={() => { if (window.confirm(`Delete "${i.name}"?`)) remove.mutate(i.id); }}
                              title="Delete" className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-2/30">
                          <td colSpan={9} className="px-0 py-1"><MovementHistory ingredientId={i.id} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <IngredientModal state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />}
      {adjusting && <StockModal ingredient={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); invalidate(); }} />}
    </div>
  );
}
