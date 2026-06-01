/**
 * StaffTab — employee performance table with comparison chart.
 * Only shown to owner/manager (or the employee's own row for cashier).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { reports, type ReportDateParams, USER_KEY } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { SalesBarChart } from '../charts/SalesBarChart';
import { fmtCurrency, fmtShortCurrency } from '../../lib/dateRanges';
import type { EmployeePerformanceRow } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

interface StaffTabProps {
  params: ReportDateParams;
}

// ─── Role check ───────────────────────────────────────────────────────────────

function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as { role?: string; id?: string };
  } catch { /* ignore */ }
  return null;
}

type SortKey = 'employee_name' | 'order_count' | 'gross_sales' | 'avg_order_value' | 'refund_count' | 'tips_collected';
type SortDir = 'asc' | 'desc';
type Metric  = 'gross_sales' | 'order_count' | 'avg_order_value';

// ─── Component ────────────────────────────────────────────────────────────────

export function StaffTab({ params }: StaffTabProps) {
  const user = getStoredUser();
  const role = user?.role ?? 'cashier';

  const canViewAll = role === 'owner' || role === 'manager';

  const [sortKey, setSortKey] = useState<SortKey>('gross_sales');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [metric,  setMetric]  = useState<Metric>('gross_sales');

  const { data: rawRows, isLoading } = useQuery({
    queryKey: QK.reportEmployees(params),
    queryFn:  () => reports.getEmployeePerformance(params),
    staleTime: 30_000,
    enabled:  canViewAll,
  });

  const allRows: EmployeePerformanceRow[] = rawRows ?? [];

  // Cashiers only see their own row
  const rows = canViewAll
    ? allRows
    : allRows.filter((r) => r.employee_id === user?.id);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = a[sortKey] as string | number;
    const bv = b[sortKey] as string | number;
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  }), [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'employee_name' ? 'asc' : 'desc'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={11} className="text-gray-300" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary" />
      : <ChevronDown size={11} className="text-primary" />;
  }

  // Bar chart data
  const barData = rows
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, 10)
    .map((r) => ({
      name:            r.employee_name.split(' ')[0],
      gross_sales:     r.gross_sales,
      order_count:     r.order_count * 100,
      avg_order_value: r.avg_order_value,
    }));

  if (!canViewAll && rows.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lock size={28} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-500">Staff performance data</p>
        <p className="text-xs text-gray-400 mt-1">Owner and manager access required</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Comparison chart ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Staff Comparison</h3>
          <div className="flex rounded-md border border-gray-200 overflow-hidden">
            {(['gross_sales', 'order_count', 'avg_order_value'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  metric === m ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50',
                )}
              >
                {m === 'gross_sales' ? 'Revenue' : m === 'order_count' ? 'Orders' : 'AOV'}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? (
          <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <SalesBarChart
            data={barData}
            xKey="name"
            bars={[{
              key:   metric,
              color: '#16a34a',
              label: metric === 'gross_sales' ? 'Revenue' : metric === 'order_count' ? 'Orders' : 'AOV',
            }]}
            height={192}
            showLegend={false}
            yFormatter={metric === 'order_count' ? (v) => String(Math.round(v / 100)) : fmtShortCurrency}
          />
        )}
      </div>

      {/* ── Performance table ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Performance Details</h3>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No performance data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {([
                    { key: 'employee_name',   label: 'Employee'  },
                    { key: 'order_count',     label: 'Orders'    },
                    { key: 'gross_sales',     label: 'Revenue'   },
                    { key: 'avg_order_value', label: 'AOV'       },
                    { key: 'refund_count',    label: 'Refunds'   },
                    { key: 'tips_collected',  label: 'Tips'      },
                  ] as { key: SortKey; label: string }[]).map(({ key, label }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className={clsx(
                        'pb-2.5 font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none',
                        key === 'employee_name' ? 'text-left' : 'text-right',
                      )}
                    >
                      <span className={clsx('inline-flex items-center gap-1', key !== 'employee_name' && 'justify-end')}>
                        {label} <SortIcon col={key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.employee_id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 font-medium text-gray-800">{r.employee_name}</td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{r.order_count}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(r.gross_sales)}</td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{fmtCurrency(r.avg_order_value)}</td>
                    <td className="py-2.5 text-right font-mono">
                      <span className={clsx(r.refund_count > 0 ? 'text-red-600' : 'text-gray-400')}>
                        {r.refund_count}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{fmtCurrency(r.tips_collected)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-semibold text-gray-800">Total</td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {sorted.reduce((s, r) => s + r.order_count, 0)}
                  </td>
                  <td className="py-2 text-right font-semibold text-gray-800">
                    {fmtCurrency(sorted.reduce((s, r) => s + r.gross_sales, 0))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
