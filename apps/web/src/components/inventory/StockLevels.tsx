/**
 * StockLevels — paginated table of inventory levels with search, low-stock filter,
 * and row-click to open ProductDetailSheet.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, AlertTriangle, Package, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { inventoryApi, type InventoryLevelRow } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { ProductDetailSheet } from './ProductDetailSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

interface StockLevelsProps {
  locationId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stockBadge(row: InventoryLevelRow) {
  const qty = row.quantity_on_hand;
  const rp  = row.reorder_point;
  if (qty <= 0)               return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' };
  if (rp !== null && qty <= rp) return { label: 'Low stock',    cls: 'bg-amber-100 text-amber-700' };
  return { label: 'In stock', cls: 'bg-green-100 text-green-700' };
}

type SortKey = 'product_name' | 'quantity_on_hand' | 'reorder_point';
type SortDir = 'asc' | 'desc';

// ─── Component ────────────────────────────────────────────────────────────────

export function StockLevels({ locationId }: StockLevelsProps) {
  const [search,          setSearch]          = useState('');
  const [lowStockOnly,    setLowStockOnly]    = useState(false);
  const [selectedRow,     setSelectedRow]     = useState<InventoryLevelRow | null>(null);
  const [page,            setPage]            = useState(1);
  const [sortKey,         setSortKey]         = useState<SortKey>('product_name');
  const [sortDir,         setSortDir]         = useState<SortDir>('asc');
  const limit = 25;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: QK.inventory(locationId, { search, lowStockOnly, page }),
    queryFn:  () => inventoryApi.levels(locationId, {
      search:            search || undefined,
      belowReorderPoint: lowStockOnly || undefined,
      page,
      limit,
    }),
    staleTime: 30_000,
  });

  const levels = data?.levels ?? [];
  const total  = data?.total  ?? 0;
  const pages  = Math.max(1, Math.ceil(total / limit));

  // Client-side sort (already paginated from server — sort within page)
  const sorted = [...levels].sort((a, b) => {
    let av: string | number = a[sortKey] ?? '';
    let bv: string | number = b[sortKey] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={12} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-primary" />
      : <ChevronDown size={12} className="text-primary" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search products…"
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        {/* Low-stock toggle */}
        <button
          onClick={() => { setLowStockOnly((v) => !v); setPage(1); }}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border transition-colors',
            lowStockOnly
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
          )}
        >
          <AlertTriangle size={14} />
          Low stock only
        </button>

        {/* Refresh */}
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="p-2 rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={clsx(isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* ── Table ── */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th
                  className="text-left px-4 py-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('product_name')}
                >
                  <span className="flex items-center gap-1">Product <SortIcon col="product_name" /></span>
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Category</th>
                <th
                  className="text-right px-4 py-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('quantity_on_hand')}
                >
                  <span className="flex items-center justify-end gap-1">On hand <SortIcon col="quantity_on_hand" /></span>
                </th>
                <th
                  className="text-right px-4 py-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('reorder_point')}
                >
                  <span className="flex items-center justify-end gap-1">Reorder pt <SortIcon col="reorder_point" /></span>
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-500">On order</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-500">Last count</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + (i * j) % 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    <Package size={28} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-sm font-medium">No inventory records found</p>
                    {search && <p className="text-xs mt-1">Try clearing the search</p>}
                  </td>
                </tr>
              ) : (
                sorted.map((row) => {
                  const badge = stockBadge(row);
                  return (
                    <tr
                      key={`${row.product_id}-${row.variant_id ?? 'null'}`}
                      onClick={() => setSelectedRow(row)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{row.product_name}</div>
                        {row.variant_name && <div className="text-xs text-gray-400">{row.variant_name}</div>}
                        {row.product_sku  && <div className="text-xs text-gray-400 font-mono">{row.product_sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.category_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-gray-800">
                        {row.quantity_on_hand} <span className="text-gray-400 text-xs">{row.unit_of_measure}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {row.reorder_point ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {row.quantity_on_order > 0 ? row.quantity_on_order : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', badge.cls)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {row.last_counted_at
                          ? new Date(row.last_counted_at).toLocaleDateString()
                          : 'Never'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500">
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                const pg = i + 1;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={clsx(
                      'px-2 py-1 text-xs rounded border transition-colors',
                      page === pg
                        ? 'bg-primary text-white border-primary'
                        : 'border-gray-200 bg-white hover:bg-gray-50',
                    )}
                  >
                    {pg}
                  </button>
                );
              })}
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Sheet */}
      {selectedRow && (
        <ProductDetailSheet
          row={selectedRow}
          locationId={locationId}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
