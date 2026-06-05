/**
 * CategoriesSettingsPage — /settings/categories
 *
 * Drag-to-reorder category list (@dnd-kit) with inline color + icon editing and
 * an add/edit modal. Reordering persists via PATCH /categories/reorder. After any
 * change the categories query + dashboard layout store are invalidated so the POS
 * CategoryTileGrid reflects edits immediately.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, Pencil, Trash2, X, FolderTree } from 'lucide-react';
import { clsx } from 'clsx';
import { categories as categoriesApi, type CategoryWithCount, type CategoryInput } from '../lib/api';
import { CATEGORY_COLORS } from '../lib/categoryColors';
import { QK } from '../lib/queryClient';
import { useLayoutStore } from '../store/layout.store';
import { showToast } from '../components/ui/Toast';

const FOOD_EMOJIS = [
  '🍔','🍕','🥗','🍺','☕','🥤','🍷','🍸','🎂','🥐',
  '🌮','🍜','🥙','🧃','🍵','🥩','🍟','🥪','🍱','🎁',
];

// ─── Edit modal ─────────────────────────────────────────────────────────────

interface EditState {
  id:    string | null;
  name:  string;
  color: string | null;
  icon:  string | null;
}

function CategoryModal({
  state, onClose, onSaved,
}: {
  state:   EditState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<EditState>(state);
  const [hex, setHex]   = useState(state.color ?? '');

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Category name is required');
      const body: CategoryInput = {
        name:  form.name.trim(),
        color: form.color,
        icon:  form.icon,
      };
      if (form.id) await categoriesApi.update(form.id, body);
      else await categoriesApi.create(body);
    },
    onSuccess: () => { showToast.success(form.id ? 'Category updated' : 'Category created'); onSaved(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{form.id ? 'Edit Category' : 'Add Category'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Burgers"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Color</label>
            <div className="grid grid-cols-10 gap-1.5">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => { setForm((f) => ({ ...f, color })); setHex(color); }}
                  className={clsx('w-7 h-7 rounded-lg transition-all hover:scale-110',
                    form.color === color && 'ring-2 ring-offset-1 ring-gray-600')}
                  style={{ background: color }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={hex}
                onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setForm((f) => ({ ...f, color: e.target.value })); }}
                placeholder="#1D9E75"
                className="flex-1 px-2 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <button onClick={() => { setForm((f) => ({ ...f, color: null })); setHex(''); }}
                className="text-xs text-gray-500 hover:text-gray-700">Auto</button>
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Icon</label>
            <div className="grid grid-cols-10 gap-1.5">
              {FOOD_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setForm((f) => ({ ...f, icon: emoji }))}
                  className={clsx('w-7 h-7 rounded-lg text-base flex items-center justify-center transition-all hover:scale-110 hover:bg-gray-100',
                    form.icon === emoji && 'ring-2 ring-gray-600 bg-gray-100')}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button onClick={() => setForm((f) => ({ ...f, icon: null }))}
              className="text-xs text-gray-500 hover:text-gray-700 mt-2">Use initials instead</button>
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

// ─── Sortable row ───────────────────────────────────────────────────────────

function SortableRow({
  category, onEdit, onDelete,
}: {
  category: CategoryWithCount;
  onEdit:   (c: CategoryWithCount) => void;
  onDelete: (c: CategoryWithCount) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id });

  const icon = category.icon;
  const color = category.color ?? '#94A3B8';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-50',
        isDragging && 'opacity-60 shadow-lg rounded-lg',
      )}
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none">
        <GripVertical size={16} />
      </button>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
        style={{ background: color + '22', color }}
      >
        {icon ?? category.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{category.name}</p>
        <p className="text-xs text-gray-400">{category.product_count} product{category.product_count !== 1 ? 's' : ''}</p>
      </div>
      <button onClick={() => onEdit(category)} title="Edit"
        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"><Pencil size={14} /></button>
      <button onClick={() => onDelete(category)} title="Delete"
        className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function CategoriesSettingsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [order, setOrder]     = useState<CategoryWithCount[]>([]);
  const fetchLayout = useLayoutStore((s) => s.fetchLayout);

  const { data, isLoading } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 60_000,
  });

  // Keep a local ordered copy for optimistic drag reordering
  const serverCats = data?.categories;
  const lastSig = useRef('');
  useEffect(() => {
    if (!serverCats) return;
    const sig = serverCats.map((c) => c.id).join(',');
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      setOrder(serverCats);
    }
  }, [serverCats]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: QK.categories() });
    void fetchLayout(); // refresh POS tile layout
  };

  const reorder = useMutation({
    mutationFn: (positions: Array<{ id: string; sortOrder: number }>) => categoriesApi.reorder(positions),
    onSuccess: invalidate,
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Reorder failed'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => { showToast.success('Category deleted'); invalidate(); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Delete failed'),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = order.findIndex((c) => c.id === active.id);
    const newIdx = order.findIndex((c) => c.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(order, oldIdx, newIdx);
    setOrder(next);
    reorder.mutate(next.map((c, i) => ({ id: c.id, sortOrder: i })));
  };

  const handleDelete = (c: CategoryWithCount) => {
    if (window.confirm(`Delete "${c.name}"? Its ${c.product_count} product(s) will be uncategorized.`)) {
      remove.mutate(c.id);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Categories</h1>
          <p className="text-xs text-gray-400 mt-0.5">Drag to reorder — affects POS tile order</p>
        </div>
        <button
          onClick={() => setEditing({ id: null, name: '', color: null, icon: null })}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark transition-colors"
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded animate-shimmer" />)}
          </div>
        ) : order.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FolderTree size={36} className="text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-400">No categories yet</p>
            <button onClick={() => setEditing({ id: null, name: '', color: null, icon: null })}
              className="mt-2 text-sm text-primary hover:underline">Add your first category →</button>
          </div>
        ) : (
          <div className="max-w-2xl">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {order.map((c) => (
                  <SortableRow key={c.id} category={c} onEdit={(cat) => setEditing({
                    id: cat.id, name: cat.name, color: cat.color, icon: cat.icon,
                  })} onDelete={handleDelete} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      {editing && (
        <CategoryModal
          state={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
    </div>
  );
}
