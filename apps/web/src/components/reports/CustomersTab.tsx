/**
 * CustomersTab — customer metrics, top customers table.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { reports, type ReportDateParams } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { DonutChart } from '../charts/DonutChart';
import { fmtCurrency } from '../../lib/dateRanges';
import type { TopCustomerRow, LoyaltyTier } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CustomersTabProps {
  params: ReportDateParams;
}

// ─── Loyalty tier badge ────────────────────────────────────────────────────────

const TIER_BADGE: Record<LoyaltyTier, string> = {
  none:     'bg-gray-100 text-gray-500',
  bronze:   'bg-orange-100 text-orange-700',
  silver:   'bg-gray-200 text-gray-700',
  gold:     'bg-yellow-100 text-yellow-700',
  platinum: 'bg-blue-100 text-blue-700',
};

const TIER_COLORS: Record<LoyaltyTier, string> = {
  none:     '#94A3B8',
  bronze:   '#EA580C',
  silver:   '#94A3B8',
  gold:     '#CA8A04',
  platinum: '#3B82F6',
};

type SortKey = 'order_count' | 'total_spend' | 'loyalty_points';
type SortDir = 'asc' | 'desc';

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CustomersTab({ params }: CustomersTabProps) {
  const [search,  setSearch]  = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data: rawCustomers, isLoading } = useQuery({
    queryKey: QK.reportTopCustomers({ ...params, limit: 50 }),
    queryFn:  () => reports.getTopCustomers(params, 50),
    staleTime: 30_000,
  });

  const customers: TopCustomerRow[] = rawCustomers ?? [];

  // Aggregate metrics
  const totalCustomers = customers.length;
  const totalSpend     = customers.reduce((s, c) => s + c.total_spend, 0);
  const avgLTV         = totalCustomers > 0 ? totalSpend / totalCustomers : 0;
  const avgOrders      = totalCustomers > 0
    ? customers.reduce((s, c) => s + c.order_count, 0) / totalCustomers
    : 0;

  // Loyalty tier distribution for donut
  const tierMap = new Map<LoyaltyTier, number>();
  for (const c of customers) {
    tierMap.set(c.loyalty_tier, (tierMap.get(c.loyalty_tier) ?? 0) + 1);
  }
  const donutData = Array.from(tierMap.entries())
    .filter(([, v]) => v > 0)
    .map(([tier, count]) => ({
      label: tier.charAt(0).toUpperCase() + tier.slice(1),
      value: count,
      color: TIER_COLORS[tier],
    }));

  // Filter + sort
  const filtered = useMemo(() => {
    let list = customers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) => c.customer_name.toLowerCase().includes(q) ||
               c.email?.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [customers, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />;
  }

  return (
    <div className="space-y-6">
      {/* ── Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Customers"   value={String(totalCustomers)} />
        <StatCard label="Avg Lifetime Value" value={fmtCurrency(avgLTV)} />
        <StatCard label="Avg Orders"         value={avgOrders.toFixed(1)} />
        <StatCard label="Total Spend"        value={fmtCurrency(totalSpend)} />
      </div>

      {/* ── Tier distribution ── */}
      {donutData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Loyalty Tier Distribution</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-center">
            <DonutChart
              data={donutData}
              height={200}
              showLegend
              valueFormatter={(v) => `${v} customers`}
            />
            <div className="space-y-2">
              {donutData.map((d) => (
                <div key={d.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                    <span className="text-sm text-gray-700">{d.label}</span>
                  </div>
                  <div className="text-sm font-medium text-gray-600">
                    {d.value} ({totalCustomers > 0 ? ((d.value / totalCustomers) * 100).toFixed(0) : 0}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Top customers table ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-gray-800 flex-1">Top Customers</h3>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40 w-40"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No customer data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-2.5 font-medium text-gray-500">Customer</th>
                  <th
                    className="text-right pb-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                    onClick={() => handleSort('order_count')}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      Visits <SortIcon col="order_count" />
                    </span>
                  </th>
                  <th
                    className="text-right pb-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                    onClick={() => handleSort('total_spend')}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      Total Spent <SortIcon col="total_spend" />
                    </span>
                  </th>
                  <th className="text-left pb-2.5 font-medium text-gray-500">Tier</th>
                  <th
                    className="text-right pb-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                    onClick={() => handleSort('loyalty_points')}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      Points <SortIcon col="loyalty_points" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.customer_id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5">
                      <div className="font-medium text-gray-800">{c.customer_name}</div>
                      {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                    </td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{c.order_count}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(c.total_spend)}</td>
                    <td className="py-2.5">
                      <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium capitalize', TIER_BADGE[c.loyalty_tier])}>
                        {c.loyalty_tier}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{c.loyalty_points.toLocaleString()}</td>
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
