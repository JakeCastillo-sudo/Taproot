/**
 * DashboardTab — KPI cards, revenue line chart, category donut, heatmap,
 * top products table.
 */

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, ShoppingBag, Users, CreditCard, DollarSign } from 'lucide-react';
import { clsx } from 'clsx';
import { reports, type ReportDateParams } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { RevenueLineChart } from '../charts/RevenueLineChart';
import { DonutChart } from '../charts/DonutChart';
import { HeatmapChart } from '../charts/HeatmapChart';
import { SparklineChart } from '../charts/SparklineChart';
import { fmtCurrency, fmtShortCurrency, fmtDate } from '../../lib/dateRanges';
import type { SalesSummaryRow, TopProductRow } from '@taproot/shared';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DashboardTabProps {
  params:     ReportDateParams;
  locationId?: string;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KPICardProps {
  title:      string;
  value:      string;
  sub?:       string;
  change?:    number;   // percentage change, positive = up
  sparkData?: number[];
  icon:       React.FC<{ size?: number; className?: string }>;
  color:      string;
}

function KPICard({ title, value, sub, change, sparkData, icon: Icon, color }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', color)}>
          <Icon size={16} className="text-white" />
        </div>
        {sparkData && <SparklineChart data={sparkData} width={72} height={28} color="#16a34a" />}
      </div>
      <p className="text-2xl font-bold text-gray-900 mb-0.5">{value}</p>
      {sub && <p className="text-xs text-gray-500 mb-1">{sub}</p>}
      <p className="text-xs text-gray-500">{title}</p>
      {change !== undefined && (
        <div className={clsx(
          'flex items-center gap-1 mt-1.5 text-xs font-medium',
          change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-400',
        )}>
          {change > 0
            ? <TrendingUp size={11} />
            : change < 0
              ? <TrendingDown size={11} />
              : <Minus size={11} />}
          {change > 0 ? '+' : ''}{change.toFixed(1)}% vs prev period
        </div>
      )}
    </div>
  );
}

// ─── Donut palette ────────────────────────────────────────────────────────────

const CAT_COLORS = ['#16a34a','#0ea5e9','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];

// ─── Component ────────────────────────────────────────────────────────────────

export function DashboardTab({ params, locationId }: DashboardTabProps) {

  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: QK.reportDashboard({ locationId }),
    queryFn:  () => reports.getDashboardMetrics(locationId),
    staleTime: 60_000,
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: QK.reportSales({ ...params, granularity: 'day' }),
    queryFn:  () => reports.getSalesSummary(params, 'day'),
    staleTime: 30_000,
  });

  const { data: topProducts, isLoading: topLoading } = useQuery({
    queryKey: QK.reportTopProducts({ ...params, limit: 5 }),
    queryFn:  () => reports.getTopProducts(params, 5),
    staleTime: 30_000,
  });

  const { data: heatmapData } = useQuery({
    queryKey: QK.reportHeatmap(params),
    queryFn:  () => reports.getHourlyHeatmap(params),
    staleTime: 60_000,
  });

  const salesRows: SalesSummaryRow[] = salesData?.rows ?? [];
  const products:  TopProductRow[]   = topProducts ?? [];

  // Revenue chart data
  const revChartData = salesRows.map((r) => ({
    date:    fmtDate(r.period),
    revenue: r.gross_sales,
    orders:  r.order_count,
  }));

  // Sparkline from sales rows (last 7 points of gross_sales)
  const sparkData = salesRows.slice(-7).map((r) => r.gross_sales);

  // Category breakdown from top-products (by category — approximate from product data)
  // We don't have a dedicated category breakdown endpoint, so build from top products
  const catMap = new Map<string, number>();
  for (const p of products) {
    const cat = 'Product'; // top-products doesn't have category, show product breakdown
    catMap.set(p.product_name, (catMap.get(p.product_name) ?? 0) + p.gross_sales);
  }
  const donutData = Array.from(catMap.entries()).map(([label, value], i) => ({
    label, value, color: CAT_COLORS[i % CAT_COLORS.length],
  }));

  const today     = dashData?.today;
  const yesterday = dashData?.yesterday;

  function pctChange(curr?: number, prev?: number): number | undefined {
    if (!curr || !prev || prev === 0) return undefined;
    return ((curr - prev) / prev) * 100;
  }

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Revenue"
          value={fmtShortCurrency(today?.gross_sales ?? 0)}
          sub={`${today?.order_count ?? 0} orders`}
          change={pctChange(today?.gross_sales, yesterday?.gross_sales)}
          sparkData={sparkData.length > 1 ? sparkData : undefined}
          icon={DollarSign}
          color="bg-green-500"
        />
        <KPICard
          title="Orders"
          value={String(today?.order_count ?? 0)}
          sub={`AOV ${fmtCurrency(today?.avg_order ?? 0)}`}
          change={pctChange(today?.order_count, yesterday?.order_count)}
          icon={ShoppingBag}
          color="bg-blue-500"
        />
        <KPICard
          title="New Customers"
          value={String(today?.new_customers ?? 0)}
          change={pctChange(today?.new_customers, yesterday?.new_customers)}
          icon={Users}
          color="bg-purple-500"
        />
        <KPICard
          title="Avg Order Value"
          value={fmtCurrency(today?.avg_order ?? 0)}
          change={pctChange(today?.avg_order, yesterday?.avg_order)}
          icon={CreditCard}
          color="bg-amber-500"
        />
      </div>

      {/* ── Revenue Chart ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Revenue over period</h3>
        {salesLoading ? (
          <div className="h-64 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <RevenueLineChart
            data={revChartData}
            xKey="date"
            lines={[
              { key: 'revenue', color: '#16a34a', label: 'Revenue' },
            ]}
            height={264}
            yFormatter={fmtShortCurrency}
          />
        )}
      </div>

      {/* ── Second row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category/Product breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Products by Revenue</h3>
          {topLoading ? (
            <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
          ) : (
            <DonutChart
              data={donutData}
              height={220}
              valueFormatter={fmtShortCurrency}
            />
          )}
        </div>

        {/* Heatmap */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Hourly Revenue Heatmap</h3>
          <HeatmapChart data={heatmapData ?? []} height={180} />
        </div>
      </div>

      {/* ── Top Products mini table ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Top 5 Products</h3>
        {topLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No sales data for this period</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 font-medium text-gray-500">#</th>
                <th className="text-left pb-2 font-medium text-gray-500">Product</th>
                <th className="text-right pb-2 font-medium text-gray-500">Units</th>
                <th className="text-right pb-2 font-medium text-gray-500">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr key={p.product_id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <td className="py-2.5 pr-3 text-gray-400 font-medium">{i + 1}</td>
                  <td className="py-2.5">
                    <div className="font-medium text-gray-800">{p.product_name}</div>
                    {p.variant_name && <div className="text-xs text-gray-400">{p.variant_name}</div>}
                  </td>
                  <td className="py-2.5 text-right font-mono text-gray-600">{p.qty_sold}</td>
                  <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(p.gross_sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
