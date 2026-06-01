/**
 * StockLevels — paginated table of inventory levels with search, low-stock filter,
 * and row-click to open ProductDetailSheet.
 *
 * Groups variant-level rows from the API into one row per product (summing quantities).
 * The "primary" row (variant_id IS NULL, or lowest variant) is passed to ProductDetailSheet.
 */

import { useState, useMemo } from 'react';
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

// ─── Grouped product row ──────────────────────────────────────────────────────

interface ProductRow {
  /** Representative row for detail-sheet (NULL-variant preferred, else first variant) */
  primary:         InventoryLevelRow;
  variantRows:     InventoryLevelRow[];
  /** Summed across all variants */
  total_on_hand:   number;
  total_on_order:  number;
  /** Lowest reorder point across variants (most conservative) */
  min_reorder_pt:  number | null;
  /** Most recent count */
  latest_counted:  string | null;
}

function groupByProduct(levels: InventoryLevelRow[]): ProductRow[] {
  const map = new Map<string, InventoryLevelRow[]>();
  for (const l of levels) {
    if (!map.has(l.product_id)) map.set(l.product_id, []);
    map.get(l.product_id)!.push(l);
  }
  const rows: ProductRow[] = [];
  for (const [, variants] of map) {
    // Prefer NULL-variant as primary (product-level row); fall back to first
    const primary = variants.find((v) => v.variant_id === null) ?? variants[0];
    const total_on_hand  = variants.reduce((s, v) => s + v.quantity_on_hand,  0);
    const total_on_order = variants.reduce((s, v) => s + v.quantity_on_order, 0);
    const reorderPts = variants.map((v) => v.reorder_point).filter((v): v is number => v !== null);
    const countedDates = variants.map((v) => v.last_counted_at).filter((v): v is string => v !== null);
    rows.push({
      primary,
      variantRows:    variants,
      total_on_hand,
      total_on_order,
      min_reorder_pt: reorderPts.length > 0 ? Math.min(...reorderPts) : null,
      latest_counted: countedDates.length > 0 ? countedDates.sort()[countedDates.length - 1] ?? null : null,
    });
  }
  return rows;
}

// ─── Stock badge ──────────────────────────────────────────────────────────────

function stockBadge(total: number, reorderPt: number | null) {
  if (total <= 0)                             return { label: 'Out of stock', cls: 'bg-red-100 text-red-700' };
  if (reorderPt !== null && total <= reorderPt) return { label: 'Low stock',    cls: 'bg-amber-100 text-amber-700' };
  return { label: 'In stock', cls: 'bg-green-100 text-green-700' };
}

type SortKey = 'product_name' | 'total_on_hand' | 'min_reorder_pt';
type SortDir = 'asc' | 'desc';

// ─── Component ────────────────────────────────────────────────────────────────

export function StockLevels({ locationId }: StockLevelsProps) {
  const [search,       setSearch]       = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selectedRow,  setSelectedRow]  = useState<InventoryLevelRow | null>(null);
  const [page,         setPage]         = useState(1);
  const [sortKey,      setSortKey]      = useState<SortKey>('product_name');
  const [sortDir,      setSortDir]      = useState<SortDir>('asc');
  const limit = 25;

  // Fetch more rows than displayed so grouping doesn't lose data across page boundaries.
  // We fetch up to 200 rows and group client-side, then slice for pagination display.
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: QK.inventory(locationId, { search, lowStockOnly }),
    queryFn:  () => inventoryApi.levels(locationId, {
      search:            search || undefined,
      belowReorderPoint: lowStockOnly || undefined,
      limit:             200,
    }),
    staleTime: 30_000,
  });

  const grouped = useMemo(() => groupByProduct(data?.levels ?? []), [data]);

  // Client-side sort
  const sorted = useMemo(() => [...grouped].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (sortKey === 'product_name')   { av = a.primary.product_name.toLowerCase(); bv = b.primary.product_name.toLowerCase(); }
    else if (sortKey === 'total_on_hand')  { av = a.total_on_hand;  bv = b.total_on_hand; }
    else                              { av = a.min_reorder_pt ?? -Infinity; bv = b.min_reorder_pt ?? -Infinity; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  }), [grouped, sortKey, sortDir]);

  // Client-side pagination over grouped rows
  const total  = sorted.length;
  const pages  = Math.max(1, Math.ceil(total / limit));
  const paged  = sorted.slice((page - 1) * limit, page * limit);

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
                  onClick={() => handleSort('total_on_hand')}
                >
                  <span className="flex items-center justify-end gap-1">On hand <SortIcon col="total_on_hand" /></span>
                </th>
                <th
                  className="text-right px-4 py-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                  onClick={() => handleSort('min_reorder_pt')}
                >
                  <span className="flex items-center justify-end gap-1">Reorder pt <SortIcon col="min_reorder_pt" /></span>
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
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    <Package size={28} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-sm font-medium">No inventory records found</p>
                    {search && <p className="text-xs mt-1">Try clearing the search</p>}
                  </td>
                </tr>
              ) : (
                paged.map((row) => {
                  const badge = stockBadge(row.total_on_hand, row.min_reorder_pt);
                  const hasVariants = row.variantRows.length > 1 ||
                    (row.variantRows.length === 1 && row.variantRows[0].variant_id !== null);
                  return (
                    <tr
                      key={row.primary.product_id}
                      onClick={() => setSelectedRow(row.primary)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{row.primary.product_name}</div>
                        {hasVariants && (
                          <div className="text-xs text-gray-400">{row.variantRows.length} variant{row.variantRows.length !== 1 ? 's' : ''}</div>
                        )}
                        {row.primary.product_sku && (
                          <div className="text-xs text-gray-400 font-mono">{row.primary.product_sku}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.primary.category_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-gray-800">
                        {row.total_on_hand}{' '}
                        <span className="text-gray-400 text-xs">{row.primary.unit_of_measure}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {row.min_reorder_pt ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-500">
                        {row.total_on_order > 0 ? row.total_on_order : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', badge.cls)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">
                        {row.latest_counted
                          ? new Date(row.latest_counted).toLocaleDateString()
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
              {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} products
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
