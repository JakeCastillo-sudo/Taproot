/**
 * ProductsTab — product performance table with ABC analysis and top/bottom toggle.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { reports, type ReportDateParams } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { SalesBarChart } from '../charts/SalesBarChart';
import { fmtCurrency, fmtShortCurrency } from '../../lib/dateRanges';
import type { TopProductRow } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProductsTabProps {
  params: ReportDateParams;
}

// ─── ABC analysis ─────────────────────────────────────────────────────────────

function abcTier(rank: number, total: number): 'A' | 'B' | 'C' {
  const pct = rank / total;
  if (pct <= 0.2)  return 'A';
  if (pct <= 0.5)  return 'B';
  return 'C';
}

const ABC_BADGE: Record<'A' | 'B' | 'C', string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-gray-100 text-gray-500',
};

type SortKey = 'rank' | 'product_name' | 'qty_sold' | 'gross_sales' | 'order_count';
type SortDir = 'asc' | 'desc';

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(rows: TopProductRow[]) {
  const header = 'Rank,Product,Variant,Units Sold,Revenue,Orders\n';
  const body   = rows.map((r, i) =>
    `${i + 1},"${r.product_name}","${r.variant_name ?? ''}",${r.qty_sold},${(r.gross_sales / 100).toFixed(2)},${r.order_count}`,
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'product-performance.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductsTab({ params }: ProductsTabProps) {
  const [search,    setSearch]    = useState('');
  const [view,      setView]      = useState<'top' | 'bottom' | 'all'>('top');
  const [sortKey,   setSortKey]   = useState<SortKey>('rank');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');
  const [showABC,   setShowABC]   = useState(false);

  const { data: rawProducts, isLoading } = useQuery({
    queryKey: QK.reportTopProducts({ ...params, limit: 100 }),
    queryFn:  () => reports.getTopProducts(params, 100),
    staleTime: 30_000,
  });

  const allProducts = rawProducts ?? [];
  const totalRevenue = allProducts.reduce((s, r) => s + r.gross_sales, 0);

  // Add rank
  const ranked = useMemo(() =>
    [...allProducts]
      .sort((a, b) => b.gross_sales - a.gross_sales)
      .map((p, i) => ({ ...p, rank: i + 1, abc: abcTier(i + 1, allProducts.length) })),
  [allProducts]);

  // View filter
  const viewed = useMemo(() => {
    if (view === 'top')    return ranked.slice(0, 10);
    if (view === 'bottom') return [...ranked].reverse().slice(0, 10);
    return ranked;
  }, [ranked, view]);

  // Search filter
  const filtered = useMemo(() => {
    if (!search) return viewed;
    const q = search.toLowerCase();
    return viewed.filter((p) =>
      p.product_name.toLowerCase().includes(q) ||
      p.variant_name?.toLowerCase().includes(q),
    );
  }, [viewed, search]);

  // Sort
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const av = a[sortKey] as string | number;
    const bv = b[sortKey] as string | number;
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  }), [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'product_name' ? 'asc' : 'desc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />;
  }

  // Bar chart data (top 10 by revenue)
  const barData = ranked.slice(0, 10).map((p) => ({
    name:    p.product_name.length > 18 ? `${p.product_name.slice(0, 18)}…` : p.product_name,
    revenue: p.gross_sales,
  }));

  return (
    <div className="space-y-6">
      {/* ── Revenue bar chart ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Top 10 by Revenue</h3>
        {isLoading ? (
          <div className="h-52 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <SalesBarChart
            data={barData}
            xKey="name"
            bars={[{ key: 'revenue', color: '#16a34a', label: 'Revenue' }]}
            height={200}
            showLegend={false}
            yFormatter={fmtShortCurrency}
          />
        )}
      </div>

      {/* ── ABC Analysis ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">ABC Analysis</h3>
          <button
            onClick={() => setShowABC((v) => !v)}
            className="text-xs text-primary hover:underline"
          >
            {showABC ? 'Hide' : 'Show'}
          </button>
        </div>
        {showABC && (
          <div className="space-y-2">
            {(['A', 'B', 'C'] as const).map((tier) => {
              const items    = ranked.filter((p) => p.abc === tier);
              const tierRev  = items.reduce((s, p) => s + p.gross_sales, 0);
              const pct      = totalRevenue > 0 ? (tierRev / totalRevenue) * 100 : 0;
              const widthPct = Math.round(pct);
              return (
                <div key={tier} className="flex items-center gap-3">
                  <span className={clsx('w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0', ABC_BADGE[tier])}>
                    {tier}
                  </span>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{items.length} products ({tier === 'A' ? 'top 20%' : tier === 'B' ? 'next 30%' : 'bottom 50%'})</span>
                      <span>{fmtCurrency(tierRev)} — {pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full', tier === 'A' ? 'bg-green-500' : tier === 'B' ? 'bg-amber-400' : 'bg-gray-300')}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Product table ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter products…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex rounded-md border border-gray-200 overflow-hidden">
            {(['top', 'bottom', 'all'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx(
                  'px-2.5 py-1.5 text-xs font-medium transition-colors capitalize',
                  view === v ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {v === 'top' ? 'Top 10' : v === 'bottom' ? 'Bottom 10' : 'All'}
              </button>
            ))}
          </div>
          <button
            onClick={() => exportCSV(ranked)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No product data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {([
                    { key: 'rank',         label: '#'       },
                    { key: 'product_name', label: 'Product' },
                    { key: 'qty_sold',     label: 'Units'   },
                    { key: 'gross_sales',  label: 'Revenue' },
                    { key: 'order_count',  label: 'Orders'  },
                  ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className={clsx(
                        'pb-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none',
                        key === 'product_name' ? 'text-left' : 'text-right',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label} <SortIcon col={key} />
                      </span>
                    </th>
                  ))}
                  <th className="pb-2.5 font-medium text-gray-500 text-left">ABC</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={`${p.product_id}-${p.variant_name ?? ''}`} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 pr-3 text-gray-400 font-mono text-right">{p.rank}</td>
                    <td className="py-2.5">
                      <div className="font-medium text-gray-800">{p.product_name}</div>
                      {p.variant_name && <div className="text-xs text-gray-400">{p.variant_name}</div>}
                    </td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{p.qty_sold}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(p.gross_sales)}</td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{p.order_count}</td>
                    <td className="py-2.5 pl-3">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold', ABC_BADGE[p.abc])}>
                        {p.abc}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
