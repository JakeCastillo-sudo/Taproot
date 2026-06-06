/**
 * ProductsSettingsPage — /settings/products
 *
 * Full product management: searchable/filterable list + create/edit modal.
 * Price is shown in dollars but stored/sent in cents. Creating a product also
 * creates a default variant + price on the backend (see product.service.ts).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Pencil, Archive, Trash2, ArchiveRestore, X, Package, ScanLine,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import {
  products as productsApi,
  categories as categoriesApi,
  inventoryApi,
  type ProductWithModifiers,
  type CategoryWithCount,
  type ArchivedProductRow,
} from '../lib/api';
import { QK } from '../lib/queryClient';
import { getLocationId } from '../lib/session';
import { showToast } from '../components/ui/Toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse a dollar string ("12.99", "$12.99", "12") into integer cents. */
function dollarsToCents(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  const dollars = parseFloat(cleaned);
  if (!isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

type StatusFilter = 'active' | 'all' | 'archived';

const DAY_PARTS = ['breakfast', 'brunch', 'lunch', 'dinner'] as const;
type DayPart = typeof DAY_PARTS[number];

// ─── Product edit modal ─────────────────────────────────────────────────────

interface EditState {
  id:             string | null; // null = create
  name:           string;
  description:    string;
  categoryId:     string;
  priceInput:     string;        // dollars as typed
  sku:            string;
  barcode:        string;
  trackInventory: boolean;
  isActive:       boolean;
  dayParts:       DayPart[];
}

const EMPTY_EDIT: EditState = {
  id: null, name: '', description: '', categoryId: '', priceInput: '',
  sku: '', barcode: '', trackInventory: true, isActive: true, dayParts: [],
};

function ProductModal({
  state, categories, onClose, onSaved,
}: {
  state:      EditState;
  categories: CategoryWithCount[];
  onClose:    () => void;
  onSaved:    () => void;
}) {
  const [form, setForm] = useState<EditState>(state);
  const [arming, setArming] = useState(false);
  const locationId = getLocationId();

  // "Scan to assign" — capture the next scan into the barcode field.
  useBarcodeScanner((code) => { setForm((f) => ({ ...f, barcode: code })); setArming(false); showToast.success(`Barcode set: ${code}`); }, arming);

  const save = useMutation({
    mutationFn: async () => {
      const price = dollarsToCents(form.priceInput);
      if (!form.name.trim()) throw new Error('Product name is required');
      const dayParts = form.dayParts.length > 0 ? form.dayParts : null;
      if (form.id) {
        await productsApi.update(form.id, {
          name:           form.name.trim(),
          description:    form.description.trim() || undefined,
          categoryId:     form.categoryId || null,
          sku:            form.sku.trim() || undefined,
          barcode:        form.barcode.trim() || undefined,
          trackInventory: form.trackInventory,
          isActive:       form.isActive,
          dayParts,
          ...(price > 0 ? { price } : {}),
        });
      } else {
        await productsApi.create({
          name:           form.name.trim(),
          description:    form.description.trim() || undefined,
          categoryId:     form.categoryId || null,
          price,
          sku:            form.sku.trim() || undefined,
          barcode:        form.barcode.trim() || undefined,
          trackInventory: form.trackInventory,
          isActive:       form.isActive,
          dayParts,
          locationId,
        });
      }
    },
    onSuccess: () => {
      showToast.success(form.id ? 'Product updated' : 'Product created');
      onSaved();
    },
    onError: (err: unknown) => {
      showToast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const toggleDayPart = (dp: DayPart) => {
    setForm((f) => ({
      ...f,
      dayParts: f.dayParts.includes(dp)
        ? f.dayParts.filter((x) => x !== dp)
        : [...f.dayParts, dp],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">
            {form.id ? 'Edit Product' : 'Add Product'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Classic Burger"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              placeholder="Quarter-pound beef patty…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Price *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  value={form.priceInput}
                  onChange={(e) => setForm((f) => ({ ...f, priceInput: e.target.value }))}
                  inputMode="decimal"
                  className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="12.99"
                />
              </div>
            </div>
          </div>

          {/* SKU */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">SKU</label>
            <input
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Auto-generated if blank"
            />
          </div>

          {/* Barcode */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Barcode</label>
            <div className="flex gap-2">
              <input
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Scan or enter"
              />
              <button type="button" onClick={() => setArming((a) => !a)}
                className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border shrink-0',
                  arming ? 'bg-primary text-white border-primary animate-pulse' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
                <ScanLine size={14} /> {arming ? 'Scan now…' : 'Scan to assign'}
              </button>
            </div>
          </div>

          {/* Day parts */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">When to show on register</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, dayParts: [] }))}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  form.dayParts.length === 0
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                )}
              >
                All day
              </button>
              {DAY_PARTS.map((dp) => (
                <button
                  key={dp}
                  type="button"
                  onClick={() => toggleDayPart(dp)}
                  className={clsx(
                    'px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-colors',
                    form.dayParts.includes(dp)
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {dp}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.trackInventory}
                onChange={(e) => setForm((f) => ({ ...f, trackInventory: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">Track inventory</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-md hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ProductsSettingsPage() {
  const qc = useQueryClient();
  const locationId = getLocationId();

  const [search, setSearch]       = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus]       = useState<StatusFilter>('active');
  const [editing, setEditing]     = useState<EditState | null>(null);

  const { data: catData } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 5 * 60_000,
  });
  const categories = catData?.categories ?? [];

  // Active / All products
  const { data: productData, isLoading } = useQuery({
    queryKey: QK.products({ scope: 'settings', search, categoryId, status }),
    queryFn:  () => productsApi.list({
      search:     search || undefined,
      categoryId: categoryId || undefined,
      isActive:   status === 'active' ? true : undefined,
      perPage:    200,
    }),
    enabled: status !== 'archived',
  });

  // Archived products
  const { data: archivedData } = useQuery({
    queryKey: ['products', 'archived', 'settings'],
    queryFn:  () => productsApi.listArchived(),
    enabled: status === 'archived',
  });

  // Inventory levels → stock status by product_id
  const { data: invData } = useQuery({
    queryKey: QK.inventory(locationId, { scope: 'settings-stock' }),
    queryFn:  () => inventoryApi.levels(locationId, { limit: 500 }),
    staleTime: 60_000,
  });
  const stockByProduct = useMemo(() => {
    const m = new Map<string, { qty: number; reorder: number | null }>();
    for (const lvl of invData?.levels ?? []) {
      const prev = m.get(lvl.product_id);
      const qty = (prev?.qty ?? 0) + Number(lvl.quantity_on_hand ?? 0);
      m.set(lvl.product_id, { qty, reorder: lvl.reorder_point });
    }
    return m;
  }, [invData]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: QK.categories() });
  };

  const archive = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => productsApi.archive(id, reason),
    onSuccess: () => { showToast.success('Product archived'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Archive failed'),
  });

  const restore = useMutation({
    mutationFn: (id: string) => productsApi.restore(id),
    onSuccess: () => { showToast.success('Product restored'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Restore failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => { showToast.success('Product deleted'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const handleArchive = (p: ProductWithModifiers) => {
    const reason = window.prompt(`Archive "${p.name}"? Optional reason:`, '') ?? undefined;
    archive.mutate({ id: p.id, reason: reason || undefined });
  };
  const handleDelete = (p: ProductWithModifiers) => {
    if (window.confirm(`Permanently delete "${p.name}"? This cannot be undone.`)) remove.mutate(p.id);
  };

  const openCreate = () => setEditing({ ...EMPTY_EDIT });
  const openEdit = (p: ProductWithModifiers) => setEditing({
    id:             p.id,
    name:           p.name,
    description:    p.description ?? '',
    categoryId:     p.category_id ?? '',
    priceInput:     p.defaultPrice ? (p.defaultPrice / 100).toFixed(2) : '',
    sku:            p.sku ?? '',
    barcode:        p.barcode ?? '',
    trackInventory: p.track_inventory,
    isActive:       p.is_active,
    dayParts:       (p.day_parts ?? []).filter((d): d is DayPart => (DAY_PARTS as readonly string[]).includes(d)),
  });

  const products = productData?.products ?? [];
  const archived = archivedData ?? [];
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null;
  const catColor = (id: string | null) => categories.find((c) => c.id === id)?.color ?? null;

  const stockBadge = (p: ProductWithModifiers) => {
    if (!p.track_inventory) return <span className="text-xs text-gray-300">—</span>;
    const s = stockByProduct.get(p.id);
    if (!s) return <span className="text-xs text-gray-300">—</span>;
    if (s.qty <= 0) return <span className="text-xs font-medium text-red-600">Out</span>;
    if (s.reorder != null && s.qty <= s.reorder) return <span className="text-xs font-medium text-amber-600">Low</span>;
    return <span className="text-xs font-medium text-green-600">In stock</span>;
  };

  const isEmpty = status === 'archived' ? archived.length === 0 : products.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">Products</h1>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark transition-colors"
          >
            <Plus size={16} /> Add Product
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="px-3 py-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading && status !== 'archived' ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-shimmer" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Package size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">
              {status === 'archived' ? 'No archived products' : 'No products yet'}
            </p>
            {status !== 'archived' && (
              <button onClick={openCreate} className="mt-2 text-sm text-primary hover:underline">
                Add your first product →
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 md:px-6 py-2">Product</th>
                <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Category</th>
                <th className="text-right font-medium px-3 py-2">Price</th>
                <th className="text-left font-medium px-3 py-2 hidden md:table-cell">SKU</th>
                <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Stock</th>
                <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Status</th>
                <th className="text-right font-medium px-4 md:px-6 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {status === 'archived'
                ? archived.map((p: ArchivedProductRow) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-white">
                    <td className="px-4 md:px-6 py-3">
                      <p className="font-medium text-gray-800">{p.name}</p>
                      {p.archive_reason && <p className="text-xs text-gray-400 truncate max-w-xs">{p.archive_reason}</p>}
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell text-gray-500">{p.category_name ?? '—'}</td>
                    <td className="px-3 py-3 text-right font-medium text-gray-700">{fmt(Number(p.last_price) || 0)}</td>
                    <td className="px-3 py-3 hidden md:table-cell text-gray-400">{p.sku ?? '—'}</td>
                    <td className="px-3 py-3 hidden lg:table-cell">—</td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Archived</span>
                    </td>
                    <td className="px-4 md:px-6 py-3 text-right">
                      <button
                        onClick={() => restore.mutate(p.id)}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ArchiveRestore size={13} /> Restore
                      </button>
                    </td>
                  </tr>
                ))
                : products.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-white">
                    <td className="px-4 md:px-6 py-3">
                      <p className="font-medium text-gray-800">{p.name}</p>
                      {p.description && <p className="text-xs text-gray-400 truncate max-w-xs">{p.description}</p>}
                    </td>
                    <td className="px-3 py-3 hidden sm:table-cell">
                      {catName(p.category_id) ? (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: (catColor(p.category_id) ?? '#64748b') + '22',
                            color: catColor(p.category_id) ?? '#475569',
                          }}
                        >
                          {catName(p.category_id)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-gray-700">{fmt(p.defaultPrice ?? 0)}</td>
                    <td className="px-3 py-3 hidden md:table-cell text-gray-400">{p.sku ?? '—'}</td>
                    <td className="px-3 py-3 hidden lg:table-cell">{stockBadge(p)}</td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      <span className={clsx(
                        'text-xs px-2 py-0.5 rounded-full',
                        p.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500',
                      )}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 md:px-6 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(p)} title="Edit"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleArchive(p)} title="Archive"
                          className="p-1.5 rounded hover:bg-amber-50 text-gray-500 hover:text-amber-600 transition-colors">
                          <Archive size={14} />
                        </button>
                        <button onClick={() => handleDelete(p)} title="Delete"
                          className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <ProductModal
          state={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}
