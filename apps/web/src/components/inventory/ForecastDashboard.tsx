/**
 * ForecastDashboard — shows stockout forecast urgency cards and a sortable table.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, TrendingDown } from 'lucide-react';
import { clsx } from 'clsx';
import { inventoryApi, type ForecastItem } from '../../lib/api';
import { QK } from '../../lib/queryClient';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ForecastDashboardProps {
  locationId: string;
}

// ─── Urgency config ───────────────────────────────────────────────────────────

const URGENCY_CONFIG = {
  critical: {
    label: 'Critical',
    cls:   'bg-red-50 border-red-200 text-red-700',
    dot:   'bg-red-500',
    icon:  AlertTriangle,
  },
  warning: {
    label: 'Warning',
    cls:   'bg-amber-50 border-amber-200 text-amber-700',
    dot:   'bg-amber-500',
    icon:  Clock,
  },
  ok: {
    label: 'OK',
    cls:   'bg-green-50 border-green-200 text-green-700',
    dot:   'bg-green-500',
    icon:  CheckCircle,
  },
};

function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 1)     return '< 1 h';
  if (h < 24)    return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ForecastDashboard({ locationId }: ForecastDashboardProps) {
  const [windowHours, setWindowHours] = useState(48);
  const [filterUrgency, setFilterUrgency] = useState<'critical' | 'warning' | 'ok' | 'all'>('all');

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: QK.forecast(locationId),
    queryFn:  () => inventoryApi.forecast(locationId, windowHours),
    staleTime: 2 * 60_000,
  });

  const items = data?.items ?? [];

  const criticalCount = items.filter((i) => i.urgency === 'critical').length;
  const warningCount  = items.filter((i) => i.urgency === 'warning').length;
  const okCount       = items.filter((i) => i.urgency === 'ok').length;

  const filtered = filterUrgency === 'all'
    ? items
    : items.filter((i) => i.urgency === filterUrgency);

  // Sort: critical first, then warning, then ok, within group by hours until stockout asc
  const sorted = [...filtered].sort((a, b) => {
    const order = { critical: 0, warning: 1, ok: 2 };
    if (order[a.urgency] !== order[b.urgency]) return order[a.urgency] - order[b.urgency];
    const ah = a.hoursUntilStockout ?? Infinity;
    const bh = b.hoursUntilStockout ?? Infinity;
    return ah - bh;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Forecast window:</span>
          {[24, 48, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => { setWindowHours(h); void refetch(); }}
              className={clsx(
                'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
                windowHours === h
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 bg-white hover:bg-gray-50',
              )}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </button>
          ))}
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="ml-auto p-2 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(['critical', 'warning', 'ok'] as const).map((u) => {
          const cfg   = URGENCY_CONFIG[u];
          const count = u === 'critical' ? criticalCount : u === 'warning' ? warningCount : okCount;
          const Icon  = cfg.icon;
          return (
            <button
              key={u}
              onClick={() => setFilterUrgency(filterUrgency === u ? 'all' : u)}
              className={clsx(
                'flex items-center gap-3 p-4 rounded-lg border transition-all',
                filterUrgency === u ? cfg.cls : 'bg-white border-gray-200 hover:border-gray-300',
              )}
            >
              <Icon size={20} className={filterUrgency === u ? undefined : 'text-gray-400'} />
              <div className="text-left">
                <p className={clsx('text-2xl font-bold', filterUrgency !== u && 'text-gray-800')}>
                  {isLoading ? '—' : count}
                </p>
                <p className={clsx('text-xs font-medium', filterUrgency !== u && 'text-gray-500')}>
                  {cfg.label}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">
            <TrendingDown size={28} className="mx-auto mb-2 text-gray-200" />
            <p className="text-sm">Loading forecast data…</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <CheckCircle size={28} className="mx-auto mb-2 text-green-300" />
            <p className="text-sm font-medium text-gray-500">
              {filterUrgency === 'all' ? 'No forecast data available' : `No ${filterUrgency} items`}
            </p>
            {filterUrgency !== 'all' && (
              <button onClick={() => setFilterUrgency('all')} className="text-xs text-primary mt-2 hover:underline">
                Show all
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Product</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">On Hand</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">Burn Rate/h</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">Time to Stockout</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500">Est. Stockout</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((item: ForecastItem) => {
                  const uCfg = URGENCY_CONFIG[item.urgency];
                  return (
                    <tr key={item.productId} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{item.productName}</div>
                        {item.sku && <div className="text-xs text-gray-400 font-mono">{item.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">
                        {item.currentOnHand} <span className="text-xs text-gray-400">{item.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {item.burnRatePerHour > 0 ? item.burnRatePerHour.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className={clsx(
                          'font-semibold',
                          item.urgency === 'critical' ? 'text-red-600'
                            : item.urgency === 'warning' ? 'text-amber-600'
                            : 'text-gray-600',
                        )}>
                          {fmtHours(item.hoursUntilStockout)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {item.estimatedStockoutAt
                          ? new Date(item.estimatedStockoutAt).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border', uCfg.cls)}>
                          <span className={clsx('w-1.5 h-1.5 rounded-full', uCfg.dot)} />
                          {uCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'text-xs font-medium capitalize',
                          item.confidence === 'high' ? 'text-green-600'
                            : item.confidence === 'medium' ? 'text-amber-600'
                            : 'text-gray-400',
                        )}>
                          {item.confidence}
                        </span>
                        {item.dataPoints > 0 && (
                          <span className="ml-1 text-xs text-gray-300">({item.dataPoints}pt)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
