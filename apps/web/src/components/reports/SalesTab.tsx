/**
 * SalesTab — revenue breakdown chart, summary stats, payment method breakdown.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { reports, type ReportDateParams } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { SalesBarChart } from '../charts/SalesBarChart';
import { DonutChart } from '../charts/DonutChart';
import { fmtCurrency, fmtDate } from '../../lib/dateRanges';
import type { ReportGranularity } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SalesTabProps {
  params: ReportDateParams;
}

// ─── Payment method colors ────────────────────────────────────────────────────

const PM_COLORS: Record<string, string> = {
  cash:           '#16a34a',
  credit_card:    '#0ea5e9',
  debit_card:     '#6366f1',
  gift_card:      '#f59e0b',
  account_credit: '#8b5cf6',
  apple_pay:      '#374151',
  google_pay:     '#0f9d58',
  other:          '#94a3b8',
};

function pmColor(method: string): string {
  return PM_COLORS[method] ?? '#94a3b8';
}
function pmLabel(method: string): string {
  return method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

type Metric = 'revenue' | 'orders' | 'avg_order';

export function SalesTab({ params }: SalesTabProps) {
  const [granularity, setGranularity] = useState<ReportGranularity>('day');
  const [metric,      setMetric]      = useState<Metric>('revenue');

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: QK.reportSales({ ...params, granularity }),
    queryFn:  () => reports.getSalesSummary(params, granularity),
    staleTime: 30_000,
  });

  const { data: pmData, isLoading: pmLoading } = useQuery({
    queryKey: QK.reportPayments(params),
    queryFn:  () => reports.getPaymentBreakdown(params),
    staleTime: 30_000,
  });

  const rows    = salesData?.rows ?? [];
  const pmRows  = pmData ?? [];

  // Aggregate totals
  const totalRevenue   = rows.reduce((s, r) => s + r.gross_sales, 0);
  const totalOrders    = rows.reduce((s, r) => s + r.order_count, 0);
  const totalDiscounts = rows.reduce((s, r) => s + r.discounts, 0);
  const totalTax       = rows.reduce((s, r) => s + r.tax, 0);
  const totalTips      = rows.reduce((s, r) => s + r.tips, 0);
  const totalRefunds   = rows.reduce((s, r) => s + r.refunds, 0);
  const avgOrder       = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Chart data
  const chartData = rows.map((r) => ({
    date:      fmtDate(r.period),
    revenue:   r.gross_sales,
    orders:    r.order_count * 100,  // ×100 so Y axis stays same scale
    avg_order: totalOrders > 0 ? Math.round(r.gross_sales / Math.max(r.order_count, 1)) : 0,
  }));

  // Donut data for payment methods
  const donutData = pmRows.map((r) => ({
    label: pmLabel(r.payment_method),
    value: r.total_amount,
    color: pmColor(r.payment_method),
  }));

  return (
    <div className="space-y-6">
      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Revenue"  value={fmtCurrency(totalRevenue)} />
        <StatCard label="Orders"         value={String(totalOrders)} sub={`AOV ${fmtCurrency(avgOrder)}`} />
        <StatCard label="Avg Order"      value={fmtCurrency(avgOrder)} />
        <StatCard label="Discounts"      value={fmtCurrency(totalDiscounts)} />
        <StatCard label="Tax Collected"  value={fmtCurrency(totalTax)} />
        <StatCard label="Tips"           value={fmtCurrency(totalTips)} />
      </div>

      {/* ── Revenue chart ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Revenue breakdown</h3>
          <div className="flex items-center gap-2">
            {/* Metric toggle */}
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              {(['revenue', 'orders', 'avg_order'] as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    metric === m ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {m === 'avg_order' ? 'AOV' : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            {/* Granularity toggle */}
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              {(['day', 'week', 'month'] as ReportGranularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium transition-colors capitalize',
                    granularity === g ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>

        {salesLoading ? (
          <div className="h-56 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <SalesBarChart
            data={chartData}
            xKey="date"
            bars={[{ key: metric, color: '#16a34a', label: metric === 'avg_order' ? 'AOV' : metric }]}
            height={224}
            yFormatter={metric === 'orders' ? (v) => String(Math.round(v / 100)) : fmtCurrency}
          />
        )}
      </div>

      {/* ── Payment methods ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Payment methods</h3>
          {pmLoading ? (
            <div className="h-52 bg-gray-100 rounded-lg animate-pulse" />
          ) : (
            <DonutChart
              data={donutData}
              height={220}
              valueFormatter={fmtCurrency}
            />
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Payment breakdown</h3>
          {pmLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : pmRows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No payment data</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left pb-2 font-medium text-gray-500">Method</th>
                  <th className="text-right pb-2 font-medium text-gray-500">Transactions</th>
                  <th className="text-right pb-2 font-medium text-gray-500">Total</th>
                  <th className="text-right pb-2 font-medium text-gray-500">%</th>
                </tr>
              </thead>
              <tbody>
                {pmRows.map((r) => (
                  <tr key={r.payment_method} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: pmColor(r.payment_method) }}
                        />
                        {pmLabel(r.payment_method)}
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-mono text-gray-600">{r.transaction_count}</td>
                    <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(r.total_amount)}</td>
                    <td className="py-2.5 text-right text-gray-500">{r.percentage.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-semibold text-gray-800">Total</td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {pmRows.reduce((s, r) => s + r.transaction_count, 0)}
                  </td>
                  <td className="py-2 text-right font-semibold text-gray-800">
                    {fmtCurrency(pmRows.reduce((s, r) => s + r.total_amount, 0))}
                  </td>
                  <td className="py-2 text-right font-semibold text-gray-800">100%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ── Refunds ── */}
      {totalRefunds > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3">
          <div className="text-red-600">
            <p className="text-sm font-semibold">Refunds: {fmtCurrency(totalRefunds)}</p>
            <p className="text-xs text-red-500 mt-0.5">
              {((totalRefunds / totalRevenue) * 100).toFixed(1)}% of gross revenue
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
