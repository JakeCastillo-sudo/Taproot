/**
 * DashboardEditorPage — customize the POS register layout.
 *
 * Route: /settings/dashboard
 *
 * Features:
 * - Drag-to-reorder categories (touch + mouse via @dnd-kit)
 * - Custom color per category (10 presets + hex input)
 * - Custom icon per category (food emojis + initials)
 * - Pin/hide per category
 * - Grid columns (2 / 3 / 4)
 * - All Items tile toggle + color
 * - Live preview
 * - Save / Reset to defaults
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, GripVertical, Pin, EyeOff, Eye, Save,
  RotateCcw, Loader2, Package,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  DndContext, closestCenter,
  PointerSensor, TouchSensor,
  useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery } from '@tanstack/react-query';
import { useLayoutStore } from '../store/layout.store';
import { categories as categoriesApi, type CategoryWithCount } from '../lib/api';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayout,
  type CategoryLayoutConfig,
} from '../lib/api';
import { CATEGORY_COLORS, getCategoryColor } from '../lib/categoryColors';
import { QK } from '../lib/queryClient';
import { showToast } from '../components/ui/Toast';

// ─── Food emojis for icon picker ─────────────────────────────────────────────

const FOOD_EMOJIS = [
  '🍔','🍕','🥗','🍺','☕','🥤','🍷','🍸','🎂','🥐',
  '🌮','🍜','🥙','🧃','🍵','🥩','🍟','🥪','🍱','🎁',
];

// ─── Color picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange }: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex]   = useState(value ?? '');
  const ref             = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const swatch = value ?? '#94A3B8';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-md border-2 border-white ring-1 ring-gray-200 shadow-sm flex-shrink-0 transition-transform hover:scale-110"
        style={{ background: swatch }}
        title="Change color"
      />
      {open && (
        <div className="absolute top-9 left-0 z-50 bg-white rounded-xl shadow-xl border border-gray-100 p-3 w-52">
          <div className="grid grid-cols-5 gap-1.5 mb-2">
            {CATEGORY_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => { onChange(color); setHex(color); setOpen(false); }}
                className={clsx(
                  'w-8 h-8 rounded-lg transition-all hover:scale-110',
                  value === color && 'ring-2 ring-offset-1 ring-gray-600',
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <button
            onClick={() => { onChange(null); setHex(''); setOpen(false); }}
            className="w-full text-xs text-gray-500 hover:text-gray-700 text-center py-1 border border-gray-100 rounded-md hover:bg-gray-50 transition-colors mb-2"
          >
            Auto (based on name)
          </button>
          <input
            type="text"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => {
              if (/^#[0-9A-Fa-f]{6}$/.test(hex)) { onChange(hex); setOpen(false); }
            }}
            placeholder="#hex color"
            className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
      )}
    </div>
  );
}

// ─── Icon picker ──────────────────────────────────────────────────────────────

function IconPicker({ value, categoryName, onChange }: {
  value:        string | null;
  categoryName: string;
  onChange:     (icon: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const display = value ?? categoryName.slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center text-sm font-bold hover:bg-gray-200 transition-colors border border-gray-200 flex-shrink-0"
        title="Change icon"
      >
        {display}
      </button>
      {open && (
        <div className="absolute top-11 left-0 z-50 bg-white rounded-xl shadow-xl border border-gray-100 p-3 w-52">
          <div className="grid grid-cols-5 gap-1 mb-2">
            {FOOD_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onChange(emoji); setOpen(false); }}
                className={clsx(
                  'w-9 h-9 flex items-center justify-center rounded-lg text-xl transition-colors',
                  value === emoji ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-gray-100',
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-xs text-gray-500 hover:text-gray-700 text-center py-1 border border-gray-100 rounded-md hover:bg-gray-50 transition-colors"
          >
            Use initials ({categoryName.slice(0, 2).toUpperCase()})
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sortable category row ────────────────────────────────────────────────────

interface SortableRowProps {
  config:      CategoryLayoutConfig;
  category:    CategoryWithCount;
  onUpdate:    (updates: Partial<CategoryLayoutConfig>) => void;
}

function SortableRow({ config, category, onUpdate }: SortableRowProps) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: config.categoryId });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.5 : 1,
    zIndex:     isDragging ? 10 : undefined,
  };

  const resolvedColor = config.color ?? getCategoryColor(category.name);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-2 p-2.5 rounded-lg border bg-white transition-colors',
        config.isHidden ? 'border-gray-100 opacity-60' : 'border-gray-200',
        isDragging && 'shadow-lg border-primary/30',
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-500 transition-colors touch-none flex-shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      {/* Color swatch */}
      <ColorPicker
        value={config.color}
        onChange={(color) => onUpdate({ color })}
      />

      {/* Icon */}
      <IconPicker
        value={config.icon}
        categoryName={category.name}
        onChange={(icon) => onUpdate({ icon })}
      />

      {/* Name + count */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{category.name}</p>
        <p className="text-xs text-gray-400">{category.product_count} items</p>
      </div>

      {/* Preview swatch */}
      <div
        className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center"
        style={{ background: resolvedColor }}
      >
        <span className="text-[9px] font-bold text-white leading-none">
          {config.icon ?? category.name.slice(0, 1)}
        </span>
      </div>

      {/* Pin toggle */}
      <button
        onClick={() => onUpdate({ isPinned: !config.isPinned })}
        title={config.isPinned ? 'Unpin' : 'Pin (shows first)'}
        className={clsx(
          'p-1.5 rounded-md transition-colors flex-shrink-0',
          config.isPinned ? 'text-primary bg-primary/10' : 'text-gray-300 hover:text-gray-500',
        )}
      >
        <Pin size={14} />
      </button>

      {/* Hide toggle */}
      <button
        onClick={() => onUpdate({ isHidden: !config.isHidden })}
        title={config.isHidden ? 'Show on register' : 'Hide from register'}
        className={clsx(
          'p-1.5 rounded-md transition-colors flex-shrink-0',
          config.isHidden ? 'text-amber-500 bg-amber-50' : 'text-gray-300 hover:text-gray-500',
        )}
      >
        {config.isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

// ─── Live preview ─────────────────────────────────────────────────────────────

function LivePreview({ layout, categories }: {
  layout:     DashboardLayout;
  categories: CategoryWithCount[];
}) {
  const configMap = new Map(layout.categoryConfigs.map((c) => [c.categoryId, c]));

  const visible = categories
    .filter((cat) => !configMap.get(cat.id)?.isHidden)
    .sort((a, b) => {
      const ca = configMap.get(a.id);
      const cb = configMap.get(b.id);
      if ((ca?.isPinned ? 0 : 1) !== (cb?.isPinned ? 0 : 1))
        return (ca?.isPinned ? 0 : 1) - (cb?.isPinned ? 0 : 1);
      return (ca?.displayOrder ?? a.sort_order ?? 999) -
             (cb?.displayOrder ?? b.sort_order ?? 999);
    });

  const cols = layout.gridColumns;
  const gridCls = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-4' : 'grid-cols-3';

  return (
    <div className="bg-surface-2 rounded-xl overflow-hidden border border-gray-200">
      <div className="px-3 py-2 bg-white border-b border-gray-100 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-xs font-medium text-gray-500">Live Preview</span>
      </div>
      <div className={clsx('grid gap-2 p-3', gridCls)}>
        {layout.showAllItemsTile && (
          <div
            className="aspect-square rounded-lg flex flex-col items-center justify-center shadow-sm"
            style={{ background: layout.allItemsTileColor }}
          >
            <Package size={18} className="text-white mb-1" />
            <span className="text-[10px] font-bold text-white">All Items</span>
          </div>
        )}
        {visible.slice(0, cols * 3 - (layout.showAllItemsTile ? 1 : 0)).map((cat) => {
          const cfg   = configMap.get(cat.id);
          const color = cfg?.color ?? getCategoryColor(cat.name);
          const icon  = cfg?.icon  ?? cat.name.slice(0, 2).toUpperCase();
          return (
            <div
              key={cat.id}
              className="aspect-square rounded-lg flex flex-col items-center justify-center gap-1 shadow-sm"
              style={{ background: color }}
            >
              <span className="text-sm leading-none">{icon}</span>
              <span className="text-[9px] font-bold text-white text-center line-clamp-1 px-1">
                {cat.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardEditorPage() {
  const navigate = useNavigate();
  const { dashboardLayout, fetchLayout, saveLayout, resetLayout, isSaving } = useLayoutStore();

  const { data: catData } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 5 * 60_000,
  });
  const allCats: CategoryWithCount[] = catData?.categories ?? [];

  const [localLayout, setLocalLayout] = useState<DashboardLayout>(DEFAULT_DASHBOARD_LAYOUT);
  const [hasChanges,  setHasChanges]  = useState(false);

  // Fetch from API on mount
  useEffect(() => {
    void fetchLayout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync local state when store loads
  useEffect(() => {
    if (dashboardLayout) {
      setLocalLayout(dashboardLayout);
    }
  }, [dashboardLayout]);

  // Ensure all categories have a config entry
  useEffect(() => {
    if (!allCats.length) return;
    setLocalLayout((prev) => {
      const existingIds = new Set(prev.categoryConfigs.map((c) => c.categoryId));
      const newConfigs = allCats
        .filter((cat) => !existingIds.has(cat.id))
        .map((cat, i) => ({
          categoryId:   cat.id,
          displayOrder: prev.categoryConfigs.length + i,
          color:        null,
          icon:         null,
          isPinned:     false,
          isHidden:     false,
        }));
      if (!newConfigs.length) return prev;
      return { ...prev, categoryConfigs: [...prev.categoryConfigs, ...newConfigs] };
    });
  }, [allCats]);

  const updateCategory = (categoryId: string, updates: Partial<CategoryLayoutConfig>) => {
    setLocalLayout((prev) => ({
      ...prev,
      categoryConfigs: prev.categoryConfigs.map((c) =>
        c.categoryId === categoryId ? { ...c, ...updates } : c,
      ),
    }));
    setHasChanges(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalLayout((prev) => {
      const oldIdx = prev.categoryConfigs.findIndex((c) => c.categoryId === active.id);
      const newIdx = prev.categoryConfigs.findIndex((c) => c.categoryId === over.id);
      const reordered = arrayMove(prev.categoryConfigs, oldIdx, newIdx)
        .map((c, i) => ({ ...c, displayOrder: i }));
      return { ...prev, categoryConfigs: reordered };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      await saveLayout(localLayout);
      setHasChanges(false);
      showToast.success('Layout saved — register will update immediately');
    } catch {
      showToast.error('Failed to save layout');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all layout changes to defaults?')) return;
    try {
      await resetLayout();
      setLocalLayout({ ...DEFAULT_DASHBOARD_LAYOUT });
      setHasChanges(false);
      showToast.success('Layout reset to defaults');
    } catch {
      showToast.error('Failed to reset layout');
    }
  };

  // Build config map for editor rendering
  const configMap = new Map(localLayout.categoryConfigs.map((c) => [c.categoryId, c]));

  // Get sorted rows for the editor list
  const sortedConfigs = [...localLayout.categoryConfigs].sort(
    (a, b) => a.displayOrder - b.displayOrder,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  return (
    <div className="h-screen overflow-hidden bg-surface-2 flex flex-col">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={14} /> Register
          </button>

          <div className="flex-1 flex items-center gap-2 ml-2">
            <h1 className="text-base font-bold text-gray-900">Customize Register Layout</h1>
            {hasChanges && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                Unsaved changes
              </span>
            )}
          </div>

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RotateCcw size={12} /> Reset
          </button>

          <button
            onClick={() => void handleSave()}
            disabled={isSaving || !hasChanges}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              hasChanges && !isSaving
                ? 'bg-primary text-white hover:bg-primary/90 active:scale-[0.98]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed',
            )}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isSaving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      {/* Mobile: one page-level scroller; lg: columns scroll independently */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col lg:flex-row gap-6 min-h-0 overflow-y-auto lg:overflow-hidden">

        {/* Left: Live Preview */}
        <div className="w-full lg:w-[55%] shrink-0 space-y-4 lg:overflow-y-auto lg:min-h-0">
          <LivePreview layout={localLayout} categories={allCats} />

          {/* Global settings */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Grid settings</h2>

            {/* Grid columns */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-28">Columns</span>
              <div className="flex gap-1.5">
                {([2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => { setLocalLayout((p) => ({ ...p, gridColumns: n })); setHasChanges(true); }}
                    className={clsx(
                      'w-9 h-9 rounded-lg text-sm font-semibold border transition-colors',
                      localLayout.gridColumns === n
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* All Items tile */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-28">All Items tile</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localLayout.showAllItemsTile}
                  onChange={(e) => {
                    setLocalLayout((p) => ({ ...p, showAllItemsTile: e.target.checked }));
                    setHasChanges(true);
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary/30"
                />
                <span className="text-sm text-gray-600">Show</span>
              </label>
              {localLayout.showAllItemsTile && (
                <ColorPicker
                  value={localLayout.allItemsTileColor}
                  onChange={(c) => {
                    setLocalLayout((p) => ({ ...p, allItemsTileColor: c ?? '#1D9E75' }));
                    setHasChanges(true);
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right: Category editor */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Categories ({sortedConfigs.length})
            </h2>
            <p className="text-xs text-gray-400">Drag to reorder</p>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedConfigs.map((c) => c.categoryId)}
                strategy={verticalListSortingStrategy}
              >
                {sortedConfigs.map((config) => {
                  const cat = allCats.find((c) => c.id === config.categoryId);
                  if (!cat) return null;
                  return (
                    <SortableRow
                      key={config.categoryId}
                      config={config}
                      category={cat}
                      onUpdate={(updates) => updateCategory(config.categoryId, updates)}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>

            {sortedConfigs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Package size={32} className="text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">No categories yet</p>
                <p className="text-xs text-gray-300 mt-1">
                  Add categories in Inventory to customize them here
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
