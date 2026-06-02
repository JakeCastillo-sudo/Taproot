/**
 * MenuReviewStep — Step 3
 *
 * Category tabs, inline editing, confidence dots, bulk actions.
 * Flagged items (low confidence) are sorted to the top automatically.
 * DEMO badge on sample items. Sticky footer with approve button.
 */

import { useState, useCallback, useRef } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { clsx } from 'clsx';
import type { MenuReviewItem } from '../../store/onboarding.store';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MenuReviewStepProps {
  items:      MenuReviewItem[];
  onComplete: (items: MenuReviewItem[], editedCount: number) => void;
  onSkip:     () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8 ? 'bg-green-400' :
    confidence >= 0.6 ? 'bg-amber-400' :
    'bg-red-400';
  const label =
    confidence >= 0.8 ? 'High confidence' :
    confidence >= 0.6 ? 'Needs quick check' :
    'Needs review';
  return (
    <span
      className={clsx('inline-block w-2 h-2 rounded-full shrink-0 mt-0.5', color)}
      title={`${label} (${Math.round(confidence * 100)}%)`}
    />
  );
}

function fmtPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

function newItem(category = 'Uncategorized'): MenuReviewItem {
  return {
    id:          `new-${crypto.randomUUID()}`,
    name:        '',
    price:       0,
    category,
    description: '',
    confidence:  1.0,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MenuReviewStep({ items: initialItems, onComplete, onSkip }: MenuReviewStepProps) {
  const [items,         setItems]         = useState<MenuReviewItem[]>(initialItems);
  const [activeTab,     setActiveTab]     = useState<string>('All');
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [editingCell,   setEditingCell]   = useState<{ id: string; field: string } | null>(null);
  const [bulkCategory,  setBulkCategory]  = useState('');

  const editCountRef = useRef(0);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const categories = ['All', ...Array.from(new Set(items.map((i) => i.category))).sort()];

  const visibleItems = items
    .filter((i) => activeTab === 'All' || i.category === activeTab)
    .sort((a, b) => {
      // Flagged items (low confidence) float to top
      const af = a.confidence < 0.8;
      const bf = b.confidence < 0.8;
      if (af && !bf) return -1;
      if (!af && bf) return 1;
      return 0;
    });

  const flaggedCount  = items.filter((i) => i.confidence < 0.8).length;
  const allVisSelected = visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.id));

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, field: keyof MenuReviewItem, raw: string) => {
    editCountRef.current++;
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      if (field === 'price')
        return { ...item, price: Math.round((parseFloat(raw) || 0) * 100) };
      if (field === 'id' || field === 'confidence' || field === 'isDemo') return item;
      return { ...item, [field]: raw };
    }));
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const addItem = () => {
    const item = newItem(activeTab !== 'All' ? activeTab : 'Uncategorized');
    setItems((prev) => [...prev, item]);
    setTimeout(() => setEditingCell({ id: item.id, field: 'name' }), 0);
  };

  // ── Bulk actions ──────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const selectAll = () => setSelectedIds(
    allVisSelected ? new Set() : new Set(visibleItems.map((i) => i.id)),
  );

  const deleteSelected = () => {
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    setSelectedIds(new Set());
  };

  const moveBulkCategory = () => {
    if (!bulkCategory.trim()) return;
    setItems((prev) => prev.map((i) =>
      selectedIds.has(i.id) ? { ...i, category: bulkCategory.trim() } : i,
    ));
    setSelectedIds(new Set());
    setBulkCategory('');
  };

  const isEditing = (id: string, field: string) =>
    editingCell?.id === id && editingCell.field === field;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-0.5">Here&apos;s what we found!</h2>
        <p className="text-sm text-gray-500">
          {items.length} item{items.length !== 1 ? 's' : ''} across{' '}
          {categories.length - 1} categor{categories.length - 1 === 1 ? 'y' : 'ies'}
        </p>
        {flaggedCount > 0 && (
          <p className="text-xs text-amber-600 mt-0.5">
            {items.length - flaggedCount} look great · {flaggedCount} need your attention
          </p>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        {categories.map((cat) => {
          const count = cat === 'All'
            ? items.length
            : items.filter((i) => i.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => { setActiveTab(cat); setSelectedIds(new Set()); }}
              className={clsx(
                'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
                activeTab === cat
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {cat}
              <span className={clsx(
                'ml-1',
                activeTab === cat ? 'opacity-70' : 'text-gray-400',
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
          <span className="text-xs font-medium text-primary shrink-0">
            {selectedIds.size} selected
          </span>
          <input
            type="text"
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && moveBulkCategory()}
            placeholder="Move to category…"
            className="flex-1 min-w-0 text-xs px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={moveBulkCategory}
            disabled={!bulkCategory.trim()}
            className="shrink-0 px-2 py-1 bg-primary text-white text-xs font-medium rounded hover:bg-primary-dark disabled:opacity-40 transition-colors"
          >
            Move
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="shrink-0 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-1 max-h-60 overflow-y-auto pr-0.5">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className={clsx(
              'flex items-center gap-2 rounded-lg border px-2.5 py-2 group transition-colors',
              selectedIds.has(item.id)
                ? 'border-primary/40 bg-primary/5'
                : item.confidence < 0.8
                ? 'border-amber-200 bg-amber-50/40 hover:border-amber-300'
                : 'border-gray-100 bg-white hover:border-gray-200',
            )}
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={selectedIds.has(item.id)}
              onChange={() => toggleSelect(item.id)}
              className="shrink-0 w-3.5 h-3.5 rounded accent-primary cursor-pointer"
            />

            {/* Confidence */}
            <ConfidenceDot confidence={item.confidence} />

            {/* Name */}
            <div className="flex-[2] min-w-0">
              {isEditing(item.id, 'name') ? (
                <input
                  type="text"
                  defaultValue={item.name}
                  autoFocus
                  onBlur={(e) => { updateItem(item.id, 'name', e.target.value); setEditingCell(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') (e.target as HTMLInputElement).blur(); }}
                  className="w-full text-xs bg-transparent border-0 border-b border-primary/50 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingCell({ id: item.id, field: 'name' })}
                  className={clsx(
                    'text-left w-full text-xs font-medium truncate transition-colors',
                    item.name ? 'text-gray-800 hover:text-primary' : 'text-gray-300 italic hover:text-primary',
                  )}
                >
                  {item.name || 'Tap to name…'}
                </button>
              )}
            </div>

            {/* Price */}
            <div className="w-14 shrink-0">
              {isEditing(item.id, 'price') ? (
                <div className="flex items-center gap-0.5">
                  <span className="text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={fmtPrice(item.price)}
                    autoFocus
                    onBlur={(e) => { updateItem(item.id, 'price', e.target.value); setEditingCell(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full text-xs bg-transparent border-0 border-b border-primary/50 focus:outline-none"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingCell({ id: item.id, field: 'price' })}
                  className="text-xs text-gray-600 hover:text-primary transition-colors"
                >
                  ${fmtPrice(item.price)}
                </button>
              )}
            </div>

            {/* Category */}
            <div className="w-24 shrink-0 hidden sm:block">
              {isEditing(item.id, 'category') ? (
                <input
                  type="text"
                  defaultValue={item.category}
                  autoFocus
                  onBlur={(e) => { updateItem(item.id, 'category', e.target.value); setEditingCell(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-full text-xs bg-transparent border-0 border-b border-primary/50 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingCell({ id: item.id, field: 'category' })}
                  className="text-left text-xs text-gray-400 hover:text-primary transition-colors truncate w-full"
                >
                  {item.category}
                </button>
              )}
            </div>

            {/* DEMO badge + delete */}
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              {item.isDemo && (
                <span className="text-[9px] font-bold tracking-widest text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  DEMO
                </span>
              )}
              <button
                type="button"
                onClick={() => deleteItem(item.id)}
                aria-label="Remove item"
                className="p-0.5 rounded text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                tabIndex={-1}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        {/* Add item */}
        <button
          type="button"
          onClick={addItem}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border-2 border-dashed border-gray-200 hover:border-primary/40 hover:bg-primary/5 text-xs text-gray-400 hover:text-primary transition-colors"
        >
          <Plus size={13} />
          Add item{activeTab !== 'All' ? ` to ${activeTab}` : ''}
        </button>
      </div>

      {/* Select all row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary transition-colors"
        >
          <div className={clsx(
            'w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors',
            allVisSelected ? 'bg-primary border-primary' : 'border-gray-300',
          )}>
            {allVisSelected && <Check size={9} className="text-white" />}
          </div>
          {allVisSelected ? 'Deselect all' : 'Select all'}
        </button>
        <span className="text-xs text-gray-300">·</span>
        <span className="text-xs text-gray-400">{items.length} items total</span>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => onComplete(items, editCountRef.current)}
          disabled={items.length === 0}
          className="w-full py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Check size={16} />
          Approve &amp; Continue
          <span className="opacity-70 font-normal text-xs">
            ({items.length} items)
          </span>
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Review more later — skip for now
        </button>
      </div>
    </div>
  );
}
