/**
 * ProductDetailSheet — slide-in right panel showing a single product's
 * stock level, movement history, and quick-adjust form.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, TrendingUp, TrendingDown, Minus, Plus, History, AlertCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { inventoryApi, type InventoryLevelRow } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { showToast } from '../ui/Toast';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProductDetailSheetProps {
  row:        InventoryLevelRow;
  locationId: string;
  onClose:    () => void;
}

// ─── Movement type label ──────────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, { label: string; cls: string }> = {
  sale:           { label: 'Sale',           cls: 'text-red-600' },
  return:         { label: 'Return',         cls: 'text-green-600' },
  waste:          { label: 'Waste',          cls: 'text-orange-600' },
  adjustment:     { label: 'Adjustment',     cls: 'text-blue-600' },
  transfer_in:    { label: 'Transfer In',    cls: 'text-green-600' },
  transfer_out:   { label: 'Transfer Out',   cls: 'text-red-600' },
  po_receipt:     { label: 'PO Receipt',     cls: 'text-green-600' },
  opening_count:  { label: 'Opening Count',  cls: 'text-blue-600' },
  cycle_count:    { label: 'Cycle Count',    cls: 'text-blue-600' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductDetailSheet({ row, locationId, onClose }: ProductDetailSheetProps) {
  const qc = useQueryClient();

  const [adjustDelta,  setAdjustDelta]  = useState(0);
  const [adjustReason, setAdjustReason] = useState('adjustment');
  const [adjustNotes,  setAdjustNotes]  = useState('');

  // Fetch movement history
  const { data: movData, isLoading: movLoading } = useQuery({
    queryKey: QK.inventoryMovements(locationId, row.product_id),
    queryFn:  () => inventoryApi.movements(locationId, row.product_id, row.variant_id, 50),
    staleTime: 30_000,
  });

  const movements = movData?.movements ?? [];

  // Adjust mutation
  const adjustMutation = useMutation({
    mutationFn: () => inventoryApi.adjust(locationId, {
      productId:    row.product_id,
      variantId:    row.variant_id,
      quantityDelta: adjustDelta,
      reason:       adjustReason,
      notes:        adjustNotes || undefined,
    }),
    onSuccess: () => {
      showToast.success('Stock adjusted');
      void qc.invalidateQueries({ queryKey: ['inventory', locationId] });
      void qc.invalidateQueries({ queryKey: QK.inventoryMovements(locationId, row.product_id) });
      setAdjustDelta(0);
      setAdjustNotes('');
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : 'Adjustment failed');
    },
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{row.product_name}</h2>
              {row.variant_name && (
                <p className="text-sm text-gray-500 mt-0.5">{row.variant_name}</p>
              )}
              {row.product_sku && (
                <p className="text-xs text-gray-400 font-mono mt-0.5">SKU: {row.product_sku}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Stock summary cards */}
          <div className="px-5 py-4 grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">On Hand</p>
              <p className={clsx(
                'text-2xl font-bold',
                row.quantity_on_hand <= 0 ? 'text-red-600'
                  : (row.reorder_point !== null && row.quantity_on_hand <= row.reorder_point)
                    ? 'text-amber-600' : 'text-gray-900',
              )}>
                {row.quantity_on_hand}
              </p>
              <p className="text-[11px] text-gray-400">{row.unit_of_measure}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">On Order</p>
              <p className="text-2xl font-bold text-gray-900">{row.quantity_on_order}</p>
              <p className="text-[11px] text-gray-400">{row.unit_of_measure}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">Reorder Pt</p>
              <p className="text-2xl font-bold text-gray-900">{row.reorder_point ?? '—'}</p>
              {row.reorder_point !== null && (
                <p className="text-[11px] text-gray-400">{row.unit_of_measure}</p>
              )}
            </div>
          </div>

          {/* Quick Adjust */}
          <div className="px-5 pb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Quick Adjust
            </h3>
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
              {/* Delta stepper */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Quantity change</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAdjustDelta((d) => d - 1)}
                    className="w-9 h-9 rounded-md border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    value={adjustDelta}
                    onChange={(e) => setAdjustDelta(parseInt(e.target.value, 10) || 0)}
                    className="flex-1 text-center py-2 border border-gray-200 rounded-md text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => setAdjustDelta((d) => d + 1)}
                    className="w-9 h-9 rounded-md border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {adjustDelta !== 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    New total: <strong className="font-mono">{row.quantity_on_hand + adjustDelta} {row.unit_of_measure}</strong>
                  </p>
                )}
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Reason</label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white"
                >
                  <option value="adjustment">Manual adjustment</option>
                  <option value="waste">Waste / spoilage</option>
                  <option value="return">Customer return</option>
                  <option value="cycle_count">Cycle count</option>
                  <option value="opening_count">Opening count</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Notes (optional)</label>
                <input
                  type="text"
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  placeholder="e.g. Damaged on delivery"
                  className="w-full py-2 px-3 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              <button
                onClick={() => adjustMutation.mutate()}
                disabled={adjustDelta === 0 || adjustMutation.isPending}
                className="w-full h-10 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {adjustDelta > 0
                  ? <TrendingUp size={14} />
                  : adjustDelta < 0
                    ? <TrendingDown size={14} />
                    : null}
                {adjustMutation.isPending ? 'Saving…' : 'Apply adjustment'}
              </button>

              {adjustMutation.isError && (
                <div className="flex items-center gap-2 text-red-600 text-xs">
                  <AlertCircle size={12} />
                  {(adjustMutation.error as Error)?.message ?? 'Error'}
                </div>
              )}
            </div>
          </div>

          {/* Movement history */}
          <div className="px-5 pb-6">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              <History size={12} /> Movement History
            </h3>

            {movLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No movements recorded yet</p>
            ) : (
              <div className="space-y-1">
                {movements.map((m) => {
                  const info = MOVEMENT_LABELS[m.movement_type] ?? { label: m.movement_type, cls: 'text-gray-600' };
                  return (
                    <div
                      key={m.id}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={clsx('text-xs font-medium', info.cls)}>{info.label}</span>
                          {m.notes && (
                            <span className="text-xs text-gray-400 truncate">{m.notes}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 font-mono">
                            {m.quantity_before} → {m.quantity_after}
                          </span>
                          {m.employee_name && (
                            <span className="text-xs text-gray-400">· {m.employee_name}</span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={clsx(
                          'text-sm font-semibold font-mono',
                          m.quantity_delta > 0 ? 'text-green-600' : 'text-red-600',
                        )}>
                          {m.quantity_delta > 0 ? '+' : ''}{m.quantity_delta}
                        </span>
                        <p className="text-[10px] text-gray-400">
                          {new Date(m.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
