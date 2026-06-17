/**
 * InventoryDashboardPage — /settings/inventory
 *
 * Operational view of ingredient stock: summary cards, alerts (out / reorder /
 * low), usage this week, recent stock movements, and quick stock adjustments.
 * Renders inside SettingsLayout's <Outlet/>. Auto-refreshes every minute.
 *
 * NOTE: lives under /settings/inventory (not /inventory) — the latter is the
 * legacy product inventory_levels page. inventoryApi (legacy) is also taken, so
 * dashboard data comes from ingredientsApi.dashboard().
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Package, AlertCircle, AlertTriangle, DollarSign, Plus, ArrowRight,
  ChevronDown, ChevronRight, PackagePlus, Trash2, ClipboardCheck,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ingredientsApi } from '../lib/api';
import { StockAdjustModal, type AdjustTarget } from '../components/inventory/StockAdjustModal';

function fmtCents(c: number): string { return `$${(c / 100).toFixed(2)}`; }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function daysLeftColor(d: number | null): string {
  if (d === null) return 'text-gray-400';
  if (d < 3) return 'text-red-600';
  if (d <= 7) return 'text-amber-600';
  return 'text-green-600';
}

const MOVEMENT_DISPLAY: Record<string, { label: string; emoji: string }> = {
  sale:              { label: 'Used in order',  emoji: '📦' },
  sale_void:         { label: 'Order voided',   emoji: '↩️' },
  received_delivery: { label: 'Stock received', emoji: '📥' },
  manual_count:      { label: 'Stock count',    emoji: '🔧' },
  waste:             { label: 'Waste recorded', emoji: '🗑️' },
  other:             { label: 'Adjustment',     emoji: '✏️' },
};
function movementDisplay(type: string) {
  return MOVEMENT_DISPLAY[type] ?? { label: type.replace(/_/g, ' '), emoji: '•' };
}

interface ModalState { ingredient?: AdjustTarget | null; defaultType: string; defaultSign: 1 | -1 }

export function InventoryDashboardPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [showLow, setShowLow] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['inventory', 'dashboard'],
    queryFn:  () => ingredientsApi.dashboard(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['ingredients'] });
  };

  const card = 'bg-white border border-gray-100 rounded-lg p-4';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500">Stock levels and usage — last 7 days</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/settings/ingredients" className="hidden sm:inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            Manage ingredients <ArrowRight size={14} />
          </Link>
          <button onClick={() => setModal({ defaultType: 'received_delivery', defaultSign: 1 })}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">
            <Plus size={16} /> Adjust Stock
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6">
        {isError ? (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Could not load inventory. It refreshes automatically — or reload the page.
          </div>
        ) : isLoading || !data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-shimmer" />)}
            </div>
            <div className="h-40 bg-gray-100 rounded-lg animate-shimmer" />
          </div>
        ) : (
          <>
            {/* ── Summary cards ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className={card}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Total ingredients</p>
                  <Package size={16} className="text-gray-300" />
                </div>
                <p className="text-2xl font-bold mt-1 text-gray-900">{data.summary.totalIngredients}</p>
              </div>
              <div className={card}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Out of Stock</p>
                  <AlertCircle size={16} className={data.summary.outOfStock > 0 ? 'text-red-500' : 'text-gray-300'} />
                </div>
                <p className={clsx('text-2xl font-bold mt-1', data.summary.outOfStock > 0 ? 'text-red-600' : 'text-gray-900')}>{data.summary.outOfStock}</p>
              </div>
              <div className={card}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Need Reorder</p>
                  <AlertTriangle size={16} className={data.summary.critical > 0 ? 'text-amber-500' : 'text-gray-300'} />
                </div>
                <p className={clsx('text-2xl font-bold mt-1', data.summary.critical > 0 ? 'text-amber-600' : 'text-gray-900')}>{data.summary.critical}</p>
              </div>
              <div className={card}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">Est. Stock Value</p>
                  <DollarSign size={16} className="text-green-500" />
                </div>
                <p className="text-2xl font-bold mt-1 text-green-600">{fmtCents(data.summary.totalStockValue)}</p>
              </div>
            </div>

            {/* ── Alerts ─────────────────────────────────────────────────── */}
            {(data.alerts.outOfStock.length > 0 || data.alerts.critical.length > 0 || data.alerts.low.length > 0) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-4">
                <h2 className="text-sm font-bold text-gray-800">⚠️ Needs attention</h2>

                {data.alerts.outOfStock.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-600 mb-1.5">Out of stock ({data.alerts.outOfStock.length})</p>
                    <div className="space-y-1.5">
                      {data.alerts.outOfStock.map((a) => (
                        <div key={a.id} className="flex items-center justify-between bg-white rounded-md border border-red-100 px-3 py-2">
                          <span className="text-sm font-medium text-gray-800">{a.name}</span>
                          <button onClick={() => setModal({ ingredient: a, defaultType: 'received_delivery', defaultSign: 1 })}
                            className="text-xs font-semibold text-primary hover:underline">Adjust stock</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.alerts.critical.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-700 mb-1.5">Need reorder ({data.alerts.critical.length})</p>
                    <div className="space-y-1.5">
                      {data.alerts.critical.map((a) => (
                        <div key={a.id} className="flex items-center justify-between bg-white rounded-md border border-amber-100 px-3 py-2 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                            <p className="text-xs text-gray-500">
                              {a.currentStock} / reorder {a.reorderPoint} {a.unit}
                              {a.daysRemaining !== null && <span className="ml-1">· ~{a.daysRemaining}d left</span>}
                              <span className="ml-1 text-amber-700 font-medium">· order {a.suggestedOrderQty} {a.unit}</span>
                            </p>
                          </div>
                          <button onClick={() => setModal({ ingredient: a, defaultType: 'received_delivery', defaultSign: 1 })}
                            className="text-xs font-semibold text-primary hover:underline shrink-0">Adjust stock</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {data.alerts.low.length > 0 && (
                  <div>
                    <button onClick={() => setShowLow((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700">
                      {showLow ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Running low ({data.alerts.low.length})
                    </button>
                    {showLow && (
                      <div className="space-y-1.5 mt-1.5">
                        {data.alerts.low.map((a) => (
                          <div key={a.id} className="flex items-center justify-between bg-white rounded-md border border-gray-100 px-3 py-2 gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                              <p className="text-xs text-gray-500">{a.currentStock} / par {a.parLevel} {a.unit}
                                {a.daysRemaining !== null && <span className="ml-1">· ~{a.daysRemaining}d left</span>}</p>
                            </div>
                            <button onClick={() => setModal({ ingredient: a, defaultType: 'received_delivery', defaultSign: 1 })}
                              className="text-xs font-semibold text-primary hover:underline shrink-0">Adjust stock</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Usage this week ────────────────────────────────────────── */}
            <div className={card}>
              <h2 className="text-sm font-bold text-gray-800">Most used this week</h2>
              <p className="text-xs text-gray-400 mb-3">Based on completed orders</p>
              {data.topUsed.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  Start taking orders to see usage data here. Stock updates automatically when orders are completed.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 font-semibold">Ingredient</th>
                      <th className="py-1.5 font-semibold text-right">Used (7d)</th>
                      <th className="py-1.5 font-semibold text-right">Avg/day</th>
                      <th className="py-1.5 font-semibold text-right">Days left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topUsed.map((u) => (
                      <tr key={u.ingredientId} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 text-gray-700">{u.ingredientName}</td>
                        <td className="py-1.5 text-right text-gray-600">{Math.round(u.totalUsed * 100) / 100} {u.unit}</td>
                        <td className="py-1.5 text-right text-gray-500">{(Math.round(u.avgDailyUsage * 100) / 100)} {u.unit}</td>
                        <td className={clsx('py-1.5 text-right font-semibold', daysLeftColor(u.daysRemaining))}>
                          {u.daysRemaining === null ? 'N/A' : `${u.daysRemaining}d`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Recent movements ───────────────────────────────────────── */}
            <div className={card}>
              <h2 className="text-sm font-bold text-gray-800 mb-3">Recent stock movements</h2>
              {data.recentMovements.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No stock movements yet.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {data.recentMovements.map((m) => {
                    const d = movementDisplay(m.movementType);
                    const positive = m.quantityChange >= 0;
                    return (
                      <div key={m.id} className="flex items-center gap-3 py-2">
                        <span className="text-base shrink-0">{d.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">
                            <span className="font-medium">{m.ingredientName}</span>
                            <span className="text-gray-400"> · {d.label}</span>
                          </p>
                          {m.notes && <p className="text-xs text-gray-400 truncate">{m.notes}</p>}
                        </div>
                        <span className={clsx('text-sm font-semibold tabular-nums shrink-0', positive ? 'text-green-600' : 'text-red-600')}>
                          {positive ? '+' : ''}{Math.round(m.quantityChange * 100) / 100} {m.unit}
                        </span>
                        <span className="text-xs text-gray-400 shrink-0 w-16 text-right">{timeAgo(m.createdAt)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Quick adjust ───────────────────────────────────────────── */}
            <div className={card}>
              <h2 className="text-sm font-bold text-gray-800 mb-3">Need to update stock?</h2>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setModal({ defaultType: 'received_delivery', defaultSign: 1 })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                  <PackagePlus size={15} className="text-green-600" /> Record delivery
                </button>
                <button onClick={() => setModal({ defaultType: 'waste', defaultSign: -1 })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                  <Trash2 size={15} className="text-red-500" /> Record waste
                </button>
                <button onClick={() => setModal({ defaultType: 'manual_count', defaultSign: 1 })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50">
                  <ClipboardCheck size={15} className="text-gray-500" /> Stock count
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && (
        <StockAdjustModal
          ingredient={modal.ingredient ?? null}
          defaultType={modal.defaultType}
          defaultSign={modal.defaultSign}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}
    </div>
  );
}
