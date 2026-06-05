/**
 * TipsTab — tip totals by day, by employee, and by payment method.
 */

import { useQuery } from '@tanstack/react-query';
import { reports, type ReportDateParams } from '../../lib/api';
import { SalesBarChart } from '../charts/SalesBarChart';
import { fmtCurrency, fmtShortCurrency } from '../../lib/dateRanges';

export function TipsTab({ params }: { params: ReportDateParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report', 'tips', params],
    queryFn:  () => reports.getTips(params),
    staleTime: 30_000,
  });

  const byDay = (data?.byDay ?? []).map((d) => ({ name: d.day.slice(5), tips: d.tips }));

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total Tips', value: fmtCurrency(data?.totalTips ?? 0) },
          { label: 'Avg Tip %', value: `${(data?.avgTipPct ?? 0).toFixed(1)}%` },
          { label: 'Tipped Sales', value: fmtCurrency(data?.totalSales ?? 0) },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{isLoading ? '—' : c.value}</p>
          </div>
        ))}
      </div>

      {/* Tips by day */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Tips by Day</h3>
        {isLoading ? <div className="h-48 bg-gray-100 rounded-lg animate-pulse" /> : byDay.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No tips in this period</p>
        ) : (
          <SalesBarChart data={byDay} xKey="name" bars={[{ key: 'tips', color: '#16a34a', label: 'Tips' }]}
            height={192} showLegend={false} yFormatter={fmtShortCurrency} />
        )}
      </div>

      {/* By employee + by method */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Tips by Employee</h3>
          {(data?.byEmployee ?? []).length === 0 ? <p className="text-sm text-gray-400 py-4">No data</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data!.byEmployee.map((e) => (
                  <tr key={e.employee_id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-700">{e.employee_name}</td>
                    <td className="py-2 text-right text-gray-400 text-xs">{e.order_count} order{e.order_count !== 1 ? 's' : ''}</td>
                    <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(e.tips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Tips by Payment Method</h3>
          {(data?.byPaymentMethod ?? []).length === 0 ? <p className="text-sm text-gray-400 py-4">No data</p> : (
            <table className="w-full text-sm">
              <tbody>
                {data!.byPaymentMethod.map((m) => (
                  <tr key={m.method} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-700 capitalize">{m.method.replace(/_/g, ' ')}</td>
                    <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(m.tips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
