/**
 * StockCountSheet — full-screen modal for performing a cycle count.
 * Loads current levels, lets user enter counted quantities, then submits.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Search, CheckCircle, AlertCircle, ClipboardList, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { inventoryApi, type StockCountLine } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Props ────────────────────────────────────────────────────────────────────

interface StockCountSheetProps {
  locationId: string;
  onClose:    () => void;
}

// ─── Counted row state ────────────────────────────────────────────────────────

interface CountRow {
  productId:   string;
  variantId:   string | null;
  productName: string;
  variantName: string | null;
  sku:         string | null;
  unit:        string;
  systemQty:   number;
  countedQty:  string; // string to allow empty while typing
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StockCountSheet({ locationId, onClose }: StockCountSheetProps) {
  const qc = useQueryClient();
  const [search,       setSearch]       = useState('');
  const [isOpening,    setIsOpening]    = useState(false);
  const [submitted,    setSubmitted]    = useState(false);
  const [countState,   setCountState]   = useState<Record<string, string>>({});

  // Key = `${productId}::${variantId ?? 'null'}`
  function rowKey(productId: string, variantId: string | null) {
    return `${productId}::${variantId ?? 'null'}`;
  }

  const { data, isLoading } = useQuery({
    queryKey: QK.inventory(locationId, { stockCount: true }),
    queryFn:  () => inventoryApi.levels(locationId, { limit: 200 }),
    staleTime: 60_000,
  });

  const rows: CountRow[] = useMemo(() => {
    return (data?.levels ?? []).map((l) => ({
      productId:   l.product_id,
      variantId:   l.variant_id,
      productName: l.product_name,
      variantName: l.variant_name,
      sku:         l.product_sku,
      unit:        l.unit_of_measure,
      systemQty:   l.quantity_on_hand,
      countedQty:  countState[rowKey(l.product_id, l.variant_id)] ?? '',
    }));
  }, [data, countState]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        r.sku?.toLowerCase().includes(q) ||
        r.variantName?.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const filledCount = rows.filter((r) => r.countedQty !== '').length;

  const submitMutation = useMutation({
    mutationFn: () => {
      const counts: StockCountLine[] = rows
        .filter((r) => r.countedQty !== '')
        .map((r) => ({
          productId:       r.productId,
          variantId:       r.variantId,
          countedQuantity: parseFloat(r.countedQty) || 0,
        }));
      if (counts.length === 0) throw new Error('No rows counted');
      return inventoryApi.stockCount(locationId, counts, isOpening);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', locationId] });
      setSubmitted(true);
      showToast.success(`Stock count saved — ${filledCount} products counted`);
      setTimeout(onClose, 1500);
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Stock count failed');
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-stretch justify-end sm:items-center sm:justify-center">
      <div className="w-full sm:w-[640px] sm:max-h-[90vh] bg-white sm:rounded-xl flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ClipboardList size={18} className="text-primary" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">Stock Count</h2>
              <p className="text-xs text-gray-500">{filledCount} of {rows.length} products counted</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Options bar */}
        <div className="px-5 py-3 border-b border-gray-50 shrink-0 flex items-center gap-4">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter products…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={isOpening}
              onChange={(e) => setIsOpening(e.target.checked)}
              className="rounded"
            />
            Opening count
          </label>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-12">No products match</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map((row) => {
                const key     = rowKey(row.productId, row.variantId);
                const counted = countState[key] ?? '';
                const diff    = counted !== '' ? (parseFloat(counted) || 0) - row.systemQty : null;
                return (
                  <div key={key} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{row.productName}</p>
                      <p className="text-xs text-gray-400">
                        {[row.variantName, row.sku].filter(Boolean).join(' · ') || row.unit}
                      </p>
                    </div>
                    <div className="text-right shrink-0 mr-3">
                      <p className="text-xs text-gray-500">System</p>
                      <p className="text-sm font-mono font-semibold text-gray-700">{row.systemQty}</p>
                    </div>
                    <div className="shrink-0">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={counted}
                        onChange={(e) => setCountState((s) => ({ ...s, [key]: e.target.value }))}
                        placeholder="Count"
                        className={clsx(
                          'w-24 text-center py-1.5 px-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors',
                          counted !== '' ? 'border-primary/40 bg-primary/5' : 'border-gray-200 bg-white',
                        )}
                      />
                    </div>
                    {diff !== null && (
                      <div className={clsx(
                        'w-12 text-right text-sm font-semibold font-mono shrink-0',
                        diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400',
                      )}>
                        {diff > 0 ? '+' : ''}{diff}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 border border-gray-200 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => submitMutation.mutate()}
            disabled={filledCount === 0 || submitMutation.isPending || submitted}
            className="flex-1 h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitted ? (
              <><CheckCircle size={14} /> Saved!</>
            ) : submitMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Saving…</>
            ) : (
              `Save count (${filledCount})`
            )}
          </button>
        </div>

        {submitMutation.isError && (
          <div className="px-5 pb-3 flex items-center gap-2 text-red-600 text-xs">
            <AlertCircle size={12} />
            {(submitMutation.error as Error)?.message ?? 'Error saving count'}
          </div>
        )}
      </div>
    </div>
  );
}
