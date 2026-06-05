/**
 * ImportReview — inline-editable import review screen.
 *
 * For document_menu jobs: fully editable table so owners can fix AI-parsed
 * prices and names before products enter the database.
 * For all other job types: read-only preview + column mapping (unchanged).
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, CheckCircle2, X, AlertTriangle, MapPin,
  Search, Pencil, CheckCircle, AlertCircle, Loader2,
  Package, ArrowRight, RotateCcw,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  importsApi,
  type ImportJob,
  type ImportType,
  type ColumnMapping,
  type ConfirmedMenuItem,
  USER_KEY,
} from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type EditableCol = 'name' | 'price' | 'category' | 'description';

interface EditableItem {
  _id:         string;
  name:        string;
  price:       number; // cents
  category:    string;
  description: string;
  include:     boolean;
}

interface EditingCell {
  rowId: string;
  col:   EditableCol;
}

// Shape of mapping_config for a parsed menu job
interface MenuMappingConfig {
  confidence?: number;
  parsed?: {
    items: Array<{
      name:         string;
      price:        number;
      category?:    string;
      description?: string;
    }>;
    categories: string[];
    confidence: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLocationId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return '';
    const user = JSON.parse(raw) as { locationIds?: string[] };
    return user.locationIds?.[0] ?? '';
  } catch {
    return '';
  }
}

function fmtPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parsePriceCents(val: string): number {
  const n = parseFloat(val.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.max(0, Math.round(n * 100));
}

function needsAttention(item: EditableItem): boolean {
  return item.include && (item.price === 0 || !item.name.trim());
}

function confidenceBadge(conf: number) {
  const pct = Math.round(conf * 100);
  const cls = pct >= 85 ? 'bg-green-100 text-green-700'
    : pct >= 65 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return (
    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', cls)}>
      {pct}% confidence
    </span>
  );
}

// ─── Read-only preview + column mapping (non-menu import types) ───────────────

const TYPE_LABELS: Record<ImportType, string> = {
  document_menu:          'Menu / Price List',
  document_invoice:       'Supplier Invoice',
  document_goods_receipt: 'Goods Receipt',
  document_inventory:     'Inventory List',
  document_recipe:        'Recipe Sheet',
  generic_csv:            'CSV Import',
  migration_square:       'Square Migration',
  migration_shopify:      'Shopify Migration',
  migration_toast:        'Toast Migration',
  migration_lightspeed:   'Lightspeed Migration',
  migration_clover:       'Clover Migration',
};

const ALL_IMPORT_TYPES: ImportType[] = Object.keys(TYPE_LABELS) as ImportType[];

const STEPS = ['Upload', 'Review', 'Apply', 'Done'];

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center">
          <span className={clsx(
            'flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
            i < current  ? 'bg-primary text-white'
              : i === current ? 'bg-primary/20 text-primary border border-primary'
              : 'bg-gray-100 text-gray-400',
          )}>
            {i < current ? <CheckCircle2 size={12} /> : i + 1}
          </span>
          <span className={clsx(
            'ml-1 text-xs font-medium hidden sm:inline',
            i === current ? 'text-primary' : 'text-gray-400',
          )}>{s}</span>
          {i < STEPS.length - 1 && (
            <span className="mx-2 text-gray-300 text-sm">›</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function ColumnMappingEditor({
  mapping, onChange,
}: { mapping: ColumnMapping; onChange: (m: ColumnMapping) => void }) {
  const TARGET_FIELDS = [
    'name', 'sku', 'barcode', 'description', 'category',
    'price_cents', 'cost_price_cents', 'unit_of_measure',
    'quantity', 'location', 'reorder_point',
    'first_name', 'last_name', 'email', 'phone', '(skip)',
  ];
  return (
    <div className="space-y-2">
      {mapping.mappings.map((m, i) => (
        <div key={m.sourceColumn} className="flex items-center gap-3">
          <div className="w-40 text-sm font-medium text-gray-700 truncate">{m.sourceColumn}</div>
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
          <select
            value={m.targetField}
            onChange={(e) => {
              const updated = { ...mapping };
              updated.mappings = mapping.mappings.map((mm, j) =>
                j === i ? { ...mm, targetField: e.target.value } : mm,
              );
              onChange(updated);
            }}
            className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          {confidenceBadge(m.confidence)}
        </div>
      ))}
      {mapping.unmappedColumns.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">Unmapped: {mapping.unmappedColumns.join(', ')}</p>
      )}
    </div>
  );
}

function renderPreviewTable(rows: unknown[]) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  const cols = Object.keys(first);
  const isLowConfidence = (row: Record<string, unknown>) => {
    const c = row['_confidence'];
    return typeof c === 'number' && c < 0.7;
  };
  return (
    <div className="overflow-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {cols.filter((c) => !c.startsWith('_')).map((col) => (
              <th key={col} className="px-3 py-2 text-left text-gray-500 font-medium uppercase tracking-wide">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {(rows as Record<string, unknown>[]).map((row, i) => (
            <tr key={i} className={clsx(isLowConfidence(row) && 'bg-amber-50')}>
              {cols.filter((c) => !c.startsWith('_')).map((col) => (
                <td key={col} className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                  {row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}
                </td>
              ))}
              {isLowConfidence(row) && (
                <td className="px-3 py-2"><AlertTriangle size={11} className="text-amber-500" /></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Success Screen ───────────────────────────────────────────────────────────

function ImportSuccessScreen({
  job,
  skippedCount,
  onGoToPOS,
  onImportAnother,
}: {
  job:            ImportJob;
  skippedCount:   number;
  onGoToPOS:      () => void;
  onImportAnother:() => void;
}) {
  const created  = job.succeeded_rows ?? 0;
  const failed   = job.failed_rows ?? 0;
  const errors   = job.error_log ?? [];

  return (
    <div className="flex flex-col items-center justify-center h-full py-10 px-6 text-center gap-5">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center animate-scale-in">
        <CheckCircle size={32} className="text-green-600" />
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-900">Import complete! ✅</h2>
        <p className="text-sm text-gray-500 mt-1">
          Your menu items have been added to the database.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        <div className="bg-green-50 rounded-xl p-3">
          <p className="text-2xl font-bold text-green-700">{created}</p>
          <p className="text-xs text-green-600 mt-0.5">products added</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-2xl font-bold text-gray-600">{skippedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">skipped</p>
        </div>
        <div className={clsx('rounded-xl p-3', failed > 0 ? 'bg-red-50' : 'bg-gray-50')}>
          <p className={clsx('text-2xl font-bold', failed > 0 ? 'text-red-600' : 'text-gray-400')}>
            {failed}
          </p>
          <p className={clsx('text-xs mt-0.5', failed > 0 ? 'text-red-500' : 'text-gray-400')}>
            failed
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="w-full max-w-sm bg-red-50 rounded-lg p-3 text-left">
          <p className="text-xs font-semibold text-red-600 mb-1">
            {failed} item{failed !== 1 ? 's' : ''} failed to import:
          </p>
          <ul className="space-y-0.5 max-h-24 overflow-y-auto">
            {errors.map((e, i) => (
              <li key={i} className="text-xs text-red-500 truncate">{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
        <button
          onClick={onGoToPOS}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Go to POS <ArrowRight size={14} />
        </button>
        <button
          onClick={onImportAnother}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <RotateCcw size={13} /> Import another file
        </button>
      </div>
    </div>
  );
}

// ─── Editable menu review table ───────────────────────────────────────────────

function MenuImportReview({ job, onDone, onCancel }: ImportReviewProps) {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState(getLocationId);

  // Derive ALL items from mapping_config.parsed.items (the full AI output)
  const mapConf = job.mapping_config as MenuMappingConfig | null;
  const parsedItems = mapConf?.parsed?.items ?? [];
  const knownCategories = useMemo(() => {
    const fromParsed = mapConf?.parsed?.categories ?? [];
    return [...new Set([...fromParsed])];
  }, [mapConf]);
  const confidence = mapConf?.parsed?.confidence ?? mapConf?.confidence ?? 0;

  const [editedItems, setEditedItems] = useState<EditableItem[]>(() =>
    parsedItems.map((item, i) => ({
      _id:         String(i),
      name:        item.name ?? '',
      price:       typeof item.price === 'number' ? item.price : 0,
      category:    item.category ?? '',
      description: item.description ?? '',
      include:     true,
    })),
  );

  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue,   setEditValue]   = useState('');
  const [filterTab,   setFilterTab]   = useState<'all' | 'needs_review' | 'skipped'>('all');
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [showWarning, setShowWarning] = useState(false);
  const [importResult, setImportResult] = useState<{ job: ImportJob; skipped: number } | null>(null);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // ── Derived counts ─────────────────────────────────────────────────────────
  const includedCount = editedItems.filter((i) => i.include).length;
  const skippedCount  = editedItems.filter((i) => !i.include).length;
  const zeroPriceCount = editedItems.filter((i) => i.include && i.price === 0).length;
  const attentionCount = editedItems.filter(needsAttention).length;

  // ── Filtered view ──────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let items = editedItems;
    if (filterTab === 'needs_review') items = items.filter(needsAttention);
    if (filterTab === 'skipped')      items = items.filter((i) => !i.include);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((i) =>
        i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q),
      );
    }
    return items;
  }, [editedItems, filterTab, search]);

  // ── Cell editing ───────────────────────────────────────────────────────────

  const startEdit = useCallback((rowId: string, col: EditableCol, currentValue: string) => {
    setEditingCell({ rowId, col });
    setEditValue(col === 'price' ? String((parseFloat(currentValue.replace('$', '')) || 0)) : currentValue);
    // Focus input on next tick
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    setEditedItems((prev) => prev.map((item) => {
      if (item._id !== rowId) return item;
      if (col === 'price') return { ...item, price: parsePriceCents(editValue) };
      return { ...item, [col]: editValue };
    }));
    setEditingCell(null);
  }, [editingCell, editValue]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  const toggleInclude = useCallback((rowId: string) => {
    setEditedItems((prev) =>
      prev.map((item) => item._id === rowId ? { ...item, include: !item.include } : item),
    );
  }, []);

  // ── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(filteredItems.map((i) => i._id)));
  }, [filteredItems]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // ── Bulk actions ───────────────────────────────────────────────────────────

  const bulkSkip = useCallback(() => {
    setEditedItems((prev) =>
      prev.map((item) => selected.has(item._id) ? { ...item, include: false } : item),
    );
    clearSelection();
  }, [selected, clearSelection]);

  const bulkInclude = useCallback(() => {
    setEditedItems((prev) =>
      prev.map((item) => selected.has(item._id) ? { ...item, include: true } : item),
    );
    clearSelection();
  }, [selected, clearSelection]);

  const [bulkPriceValue, setBulkPriceValue] = useState('');
  const applyBulkPrice = useCallback(() => {
    const cents = parsePriceCents(bulkPriceValue);
    setEditedItems((prev) =>
      prev.map((item) => selected.has(item._id) ? { ...item, price: cents } : item),
    );
    setBulkPriceValue('');
    clearSelection();
  }, [selected, bulkPriceValue, clearSelection]);

  const [bulkCat, setBulkCat] = useState('');
  const applyBulkCategory = useCallback(() => {
    if (!bulkCat.trim()) return;
    setEditedItems((prev) =>
      prev.map((item) => selected.has(item._id) ? { ...item, category: bulkCat } : item),
    );
    setBulkCat('');
    clearSelection();
  }, [selected, bulkCat, clearSelection]);

  // ── Confirm mutation ───────────────────────────────────────────────────────

  const skippedAtConfirm = useRef(0);

  const confirm = useMutation({
    mutationFn: () => {
      skippedAtConfirm.current = editedItems.filter((i) => !i.include).length;
      // EDIT CHAIN: confirmedItems carries user-edited data to the backend
      const confirmedItems: ConfirmedMenuItem[] = editedItems.map((item) => ({
        name:        item.name,
        price:       item.price,
        category:    item.category || undefined,
        description: item.description || undefined,
        include:     item.include,
      }));
      return importsApi.confirm(job.id, { locationId, confirmedItems });
    },
    onSuccess: (updatedJob) => {
      qc.setQueryData(QK.importJob(job.id), updatedJob);
      void qc.invalidateQueries({ queryKey: QK.importJobs() });
      setImportResult({ job: updatedJob, skipped: skippedAtConfirm.current });
      setShowWarning(false);
    },
    onError: (err: Error) => {
      showToast.error(err.message);
      setShowWarning(false);
    },
  });

  const handleImportClick = useCallback(() => {
    if (includedCount === 0) {
      showToast.error('Please include at least one item before importing.');
      return;
    }
    if (zeroPriceCount > 0) {
      setShowWarning(true);
    } else {
      confirm.mutate();
    }
  }, [includedCount, zeroPriceCount, confirm]);

  // ── Success screen ─────────────────────────────────────────────────────────

  if (importResult) {
    return (
      <ImportSuccessScreen
        job={importResult.job}
        skippedCount={importResult.skipped}
        onGoToPOS={() => { onDone(); }}
        onImportAnother={() => { onDone(); }}
      />
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-200 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Review your import</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-500">
                {editedItems.length} items found
              </span>
              {confidence > 0 && confidenceBadge(confidence)}
              {attentionCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <AlertTriangle size={11} />
                  {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
                </span>
              )}
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-gray-100 shrink-0">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Location picker */}
        <div className="mt-3 flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm bg-white w-fit">
          <MapPin size={13} className="text-gray-400 shrink-0" />
          <input
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="Location ID"
            className="outline-none text-sm placeholder-gray-400 w-52"
          />
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-3 shrink-0">
        {/* Tabs */}
        <div className="flex gap-0.5">
          {(['all', 'needs_review', 'skipped'] as const).map((tab) => {
            const labels = { all: `All (${editedItems.length})`, needs_review: `Needs review (${attentionCount})`, skipped: `Skipped (${skippedCount})` };
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={clsx(
                  'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  filterTab === tab ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="flex-1 flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1.5 bg-white">
          <Search size={12} className="text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="outline-none text-xs text-gray-700 placeholder-gray-400 w-full"
          />
        </div>

        {/* Select all */}
        <button
          onClick={selected.size > 0 ? clearSelection : selectAll}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          {selected.size > 0 ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      {/* ── Bulk actions (when items selected) ───────────────────────────── */}
      {selected.size > 0 && (
        <div className="px-4 py-2 bg-primary/5 border-b border-primary/20 flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-primary">{selected.size} selected</span>
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            {/* Bulk price */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="price"
                value={bulkPriceValue}
                onChange={(e) => setBulkPriceValue(e.target.value)}
                className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded"
              />
              <button onClick={applyBulkPrice} disabled={!bulkPriceValue}
                className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                Set price
              </button>
            </div>
            {/* Bulk category */}
            <div className="flex items-center gap-1">
              <input
                placeholder="category"
                value={bulkCat}
                onChange={(e) => setBulkCat(e.target.value)}
                list="bulk-cat-list"
                className="w-24 px-1.5 py-0.5 text-xs border border-gray-300 rounded"
              />
              <datalist id="bulk-cat-list">
                {knownCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <button onClick={applyBulkCategory} disabled={!bulkCat.trim()}
                className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">
                Set category
              </button>
            </div>
            <button onClick={bulkSkip}
              className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">
              Skip
            </button>
            <button onClick={bulkInclude}
              className="px-2 py-0.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50">
              Include
            </button>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Package size={32} className="text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">No items match your filter.</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="w-24 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Price</th>
                <th className="w-32 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide hidden md:table-cell">Category</th>
                <th className="w-6 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                const isEditing = (col: EditableCol) =>
                  editingCell?.rowId === item._id && editingCell?.col === col;
                const attention = needsAttention(item);

                return (
                  <tr
                    key={item._id}
                    className={clsx(
                      'group hover:bg-gray-50 transition-colors',
                      !item.include && 'opacity-45',
                      selected.has(item._id) && 'bg-primary/5',
                    )}
                  >
                    {/* Checkbox */}
                    <td className="px-3 py-2 w-8">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(item._id)}
                          onChange={() => toggleSelect(item._id)}
                          className="rounded border-gray-300 text-primary focus:ring-primary/30 cursor-pointer"
                        />
                        <button
                          onClick={() => toggleInclude(item._id)}
                          className={clsx(
                            'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                            item.include
                              ? attention ? 'border-amber-400 bg-amber-50' : 'border-green-400 bg-green-50'
                              : 'border-gray-300 bg-white',
                          )}
                          title={item.include ? 'Click to skip' : 'Click to include'}
                        >
                          {item.include && !attention && <span className="w-2 h-2 rounded-full bg-green-500" />}
                          {item.include && attention && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                        </button>
                      </div>
                    </td>

                    {/* Name */}
                    <td className="px-3 py-2 max-w-0">
                      {isEditing('name') ? (
                        <input
                          ref={(el) => { inputRef.current = el; }}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          className="w-full px-1.5 py-0.5 text-sm border border-primary rounded outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(item._id, 'name', item.name)}
                          className={clsx(
                            'flex items-center gap-1 w-full text-left text-sm truncate rounded px-1 -ml-1 hover:bg-gray-100 group/name',
                            !item.name.trim() && 'text-red-500',
                          )}
                        >
                          <span className="truncate">{item.name || '(empty name)'}</span>
                          <Pencil size={10} className="text-gray-300 group-hover/name:text-gray-500 shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                        </button>
                      )}
                    </td>

                    {/* Price */}
                    <td className="w-24 px-3 py-2">
                      {isEditing('price') ? (
                        <div className="flex items-center gap-0.5">
                          <span className="text-gray-400 text-xs">$</span>
                          <input
                            ref={(el) => { inputRef.current = el; }}
                            type="number"
                            min="0"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit();
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="w-16 px-1.5 py-0.5 text-sm border border-primary rounded outline-none focus:ring-1 focus:ring-primary/40"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(item._id, 'price', String(item.price / 100))}
                          className={clsx(
                            'flex items-center gap-1 text-sm font-medium tabular-nums rounded px-1 -ml-1 hover:bg-gray-100 group/price',
                            item.price === 0 ? 'text-red-500' : 'text-gray-800',
                          )}
                        >
                          {fmtPrice(item.price)}
                          <Pencil size={10} className="text-gray-300 group-hover/price:text-gray-500 shrink-0 opacity-0 group-hover/price:opacity-100 transition-opacity" />
                        </button>
                      )}
                    </td>

                    {/* Category */}
                    <td className="w-32 px-3 py-2 hidden md:table-cell">
                      {isEditing('category') ? (
                        <input
                          ref={(el) => { inputRef.current = el; }}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          list={`cats-${item._id}`}
                          className="w-full px-1.5 py-0.5 text-xs border border-primary rounded outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      ) : (
                        <button
                          onClick={() => startEdit(item._id, 'category', item.category)}
                          className="flex items-center gap-1 w-full text-left text-xs text-gray-500 truncate rounded px-1 -ml-1 hover:bg-gray-100 group/cat"
                        >
                          <span className="truncate">{item.category || '—'}</span>
                          <Pencil size={9} className="text-gray-300 group-hover/cat:text-gray-500 shrink-0 opacity-0 group-hover/cat:opacity-100 transition-opacity" />
                        </button>
                      )}
                      <datalist id={`cats-${item._id}`}>
                        {knownCategories.map((c) => <option key={c} value={c} />)}
                      </datalist>
                    </td>

                    {/* Status dot */}
                    <td className="w-6 px-2 py-2">
                      {!item.include
                        ? <X size={12} className="text-gray-300" />
                        : attention
                          ? <AlertCircle size={12} className="text-amber-400" />
                          : <CheckCircle2 size={12} className="text-green-500" />
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Zero-price warning dialog ──────────────────────────────────────── */}
      {showWarning && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Items with $0.00 price</h3>
                <p className="text-xs text-gray-500">
                  {zeroPriceCount} item{zeroPriceCount !== 1 ? 's have' : ' has'} a $0.00 price — is that correct?
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowWarning(false)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Go back and review
              </button>
              <button
                onClick={() => confirm.mutate()}
                disabled={confirm.isPending}
                className="flex-1 px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {confirm.isPending && <Loader2 size={13} className="animate-spin" />}
                Import anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky footer ─────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-between gap-3">
          {/* Summary */}
          <div className="text-xs text-gray-500 space-y-0.5">
            <p><span className="font-medium text-gray-800">{includedCount}</span> of {editedItems.length} items will be imported</p>
            {zeroPriceCount > 0 && (
              <p className="text-amber-600 flex items-center gap-1">
                <AlertTriangle size={10} />
                {zeroPriceCount} item{zeroPriceCount !== 1 ? 's' : ''} with $0.00 price
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImportClick}
              disabled={!locationId.trim() || includedCount === 0 || confirm.isPending}
              className={clsx(
                'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors',
                locationId.trim() && includedCount > 0 && !confirm.isPending
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed',
              )}
            >
              {confirm.isPending && <Loader2 size={13} className="animate-spin" />}
              {confirm.isPending ? 'Importing…' : `Import ${includedCount} item${includedCount !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generic review (non-menu imports — unchanged) ────────────────────────────

function GenericImportReview({ job, onDone, onCancel }: ImportReviewProps) {
  const qc = useQueryClient();
  const [locationId, setLocationId] = useState(getLocationId);
  const [importType, setImportType] = useState<ImportType>(job.import_type);
  const [mapping, setMapping] = useState<ColumnMapping | null>(
    job.mapping_config ? (job.mapping_config as ColumnMapping) : null,
  );

  const parsedConf: number = mapping?.confidence ?? 0.8;
  // BUG-IMP-001 fix: read full CSV records from mapping_config.parsed.records
  // (stored there since fix), fallback to preview_data (max 10 rows).
  const storedMapping = job.mapping_config as (ColumnMapping & { parsed?: { records?: unknown[] } }) | null;
  const previewRows = Array.isArray(storedMapping?.parsed?.records)
    ? (storedMapping.parsed!.records as unknown[])
    : Array.isArray(job.preview_data) ? (job.preview_data as unknown[]) : [];

  const confirm = useMutation({
    mutationFn: () => importsApi.confirm(job.id, {
      locationId,
      confirmedMapping: mapping ?? undefined,
    }),
    onSuccess: (updatedJob) => {
      qc.setQueryData(QK.importJob(job.id), updatedJob);
      void qc.invalidateQueries({ queryKey: QK.importJobs() });
      showToast.success(`Import ${updatedJob.status === 'completed' ? 'completed' : 'partially applied'}`);
      onDone();
    },
    onError: (err: Error) => showToast.error(err.message),
  });

  const step = confirm.isPending ? 2 : confirm.isSuccess ? 3 : 1;

  return (
    // BUG-IMP-003 fix: add min-h-0 so flex-1 children can actually shrink + scroll
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 shrink-0">
        <StepIndicator current={step} />
        <button onClick={onCancel} className="p-1.5 rounded hover:bg-gray-100">
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Detected type */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Detected document type</p>
            <div className="flex items-center gap-2">
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value as ImportType)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ALL_IMPORT_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              {confidenceBadge(parsedConf)}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Apply to location</p>
            <div className="flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white">
              <MapPin size={13} className="text-gray-400" />
              <input
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="Location ID"
                className="outline-none w-52 text-sm placeholder-gray-400"
              />
            </div>
          </div>
        </div>

        {previewRows.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Preview — first {previewRows.length} rows
            </p>
            {renderPreviewTable(previewRows)}
          </div>
        )}

        {job.import_type === 'generic_csv' && mapping && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Column Mapping
            </p>
            <div className="bg-gray-50 rounded-lg p-4">
              <ColumnMappingEditor mapping={mapping} onChange={setMapping} />
            </div>
          </div>
        )}

        {job.total_rows != null && (
          <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700">
            <p className="font-medium">Ready to apply</p>
            <p className="text-xs text-blue-600 mt-1">
              {job.total_rows} {job.total_rows === 1 ? 'record' : 'records'} detected
              from &ldquo;{job.source_filename ?? 'uploaded file'}&rdquo;
            </p>
          </div>
        )}

        {job.error_log?.length > 0 && (
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-xs font-medium text-red-600 mb-2">Errors during processing</p>
            <ul className="space-y-1">
              {job.error_log.map((e, i) => (
                <li key={i} className="text-xs text-red-500 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => confirm.mutate()}
          disabled={!locationId.trim() || confirm.isPending}
          className={clsx(
            'flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors',
            locationId.trim() && !confirm.isPending
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed',
          )}
        >
          {confirm.isPending && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {confirm.isPending ? 'Applying…' : 'Apply Import'}
        </button>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImportReviewProps {
  job:      ImportJob;
  onDone:   () => void;
  onCancel: () => void;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function ImportReview(props: ImportReviewProps) {
  if (props.job.import_type === 'document_menu') {
    return <MenuImportReview {...props} />;
  }
  return <GenericImportReview {...props} />;
}
