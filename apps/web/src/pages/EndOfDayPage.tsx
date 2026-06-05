/**
 * EndOfDayPage — /reports/end-of-day
 *
 * One-day close-out: summary cards, sales by payment method, hourly breakdown,
 * top items, employee breakdown, and cash reconciliation. Print / CSV / email.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Printer, Download, Mail } from 'lucide-react';
import { clsx } from 'clsx';
import { reports } from '../lib/api';
import { getLocationId, getStoredUser } from '../lib/session';
import { SalesBarChart } from '../components/charts/SalesBarChart';
import { fmtCurrency, fmtShortCurrency } from '../lib/dateRanges';
import { showToast } from '../components/ui/Toast';

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function EndOfDayPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayLocal());
  const locationId = getLocationId();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['report', 'eod', date, locationId],
    queryFn:  () => reports.getEndOfDay(date, locationId, TZ),
  });

  const exportCsv = () => {
    if (!data) return;
    const lines: string[] = [
      `End of Day Report,${data.date}`,
      '',
      `Net Sales,${(data.netSales / 100).toFixed(2)}`,
      `Gross Sales,${(data.grossSales / 100).toFixed(2)}`,
      `Refunds,${(data.refunds / 100).toFixed(2)}`,
      `Orders,${data.orderCount}`,
      `Average Ticket,${(data.averageTicket / 100).toFixed(2)}`,
      `Tax Collected,${(data.taxCollected / 100).toFixed(2)}`,
      `Tips Collected,${(data.tipsCollected / 100).toFixed(2)}`,
      '',
      'Payment Method,Amount',
      ...Object.entries(data.byPaymentMethod).map(([k, v]) => `${k},${(v / 100).toFixed(2)}`),
      '',
      'Top Items,Qty,Revenue',
      ...data.topItems.map((i) => `${i.name},${i.quantity},${(i.revenue / 100).toFixed(2)}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `eod-${data.date}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const emailReport = () => {
    const owner = getStoredUser()?.email ?? '';
    showToast.info(owner ? `Email delivery is not yet wired — would send to ${owner}` : 'No owner email on file');
  };

  const hourly = (data?.hourlyBreakdown ?? []).map((h) => ({ name: `${h.hour}:00`, revenue: h.revenue }));
  const recon = data?.cashReconciliation;

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0 no-print">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/reports')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft size={14} /> Reports
          </button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center"><CalendarDays size={15} className="text-primary" /></div>
            <h1 className="text-base font-bold text-gray-900">End of Day</h1>
          </div>
          <div className="flex-1" />
          <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm" />
          <button onClick={() => refetch()} className="px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark">
            {isFetching ? 'Running…' : 'Run Report'}
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50"><Printer size={13} /> Print</button>
          <button onClick={emailReport} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50"><Mail size={13} /> Email</button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50"><Download size={13} /> CSV</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0 receipt-content">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-5">
          <h2 className="hidden print:block text-lg font-bold">End of Day — {date}</h2>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded animate-pulse" />)}</div>
          ) : !data ? (
            <p className="text-sm text-gray-400">No data.</p>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Net Sales', value: fmtCurrency(data.netSales) },
                  { label: 'Orders', value: String(data.orderCount) },
                  { label: 'Avg Ticket', value: fmtCurrency(data.averageTicket) },
                  { label: 'Tips', value: fmtCurrency(data.tipsCollected) },
                ].map((c) => (
                  <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-400">{c.label}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Payment methods */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Sales by Payment Method</h3>
                  {Object.keys(data.byPaymentMethod).length === 0 ? <p className="text-sm text-gray-400">No sales</p> : (
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(data.byPaymentMethod).map(([k, v]) => (
                          <tr key={k} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 text-gray-700 capitalize">{k.replace(/_/g, ' ')}</td>
                            <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(v)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-gray-200">
                          <td className="py-2 font-semibold">Gross / Refunds</td>
                          <td className="py-2 text-right text-xs text-gray-500">{fmtCurrency(data.grossSales)} / −{fmtCurrency(data.refunds)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Hourly */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Hourly Sales</h3>
                  {hourly.length === 0 ? <p className="text-sm text-gray-400">No sales</p> : (
                    <SalesBarChart data={hourly} xKey="name" bars={[{ key: 'revenue', color: '#16a34a', label: 'Revenue' }]}
                      height={180} showLegend={false} yFormatter={fmtShortCurrency} />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top items */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Top 5 Items</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {data.topItems.map((i) => (
                        <tr key={i.name} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 text-gray-700">{i.name}</td>
                          <td className="py-2 text-right text-gray-400 text-xs">×{i.quantity}</td>
                          <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(i.revenue)}</td>
                        </tr>
                      ))}
                      {data.topItems.length === 0 && <tr><td className="py-2 text-gray-400 text-sm">No items</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Employees */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">By Employee</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {data.byEmployee.map((e) => (
                        <tr key={e.name} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 text-gray-700">{e.name}</td>
                          <td className="py-2 text-right text-gray-400 text-xs">{e.orderCount} orders</td>
                          <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(e.revenue)}</td>
                        </tr>
                      ))}
                      {data.byEmployee.length === 0 && <tr><td className="py-2 text-gray-400 text-sm">No data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cash reconciliation */}
              {recon && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Cash Reconciliation</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <Recon label="Opening" value={fmtCurrency(recon.openingAmount)} />
                    <Recon label="Cash Sales" value={fmtCurrency(recon.cashSales)} />
                    <Recon label="Cash Drops" value={`−${fmtCurrency(recon.cashDrops)}`} />
                    <Recon label="Expected" value={fmtCurrency(recon.expectedAmount)} />
                    <Recon label="Actual" value={recon.actualAmount != null ? fmtCurrency(recon.actualAmount) : '—'} />
                    <Recon label="Discrepancy"
                      value={recon.discrepancy != null ? `${recon.discrepancy > 0 ? '+' : ''}${fmtCurrency(recon.discrepancy)}` : '—'}
                      tone={recon.discrepancy == null ? undefined : recon.discrepancy === 0 ? 'ok' : recon.discrepancy > 0 ? 'pos' : 'neg'} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Recon({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'pos' | 'neg' }) {
  return (
    <div className="bg-gray-50 rounded-md p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={clsx('text-base font-bold mt-0.5',
        tone === 'pos' ? 'text-green-600' : tone === 'neg' ? 'text-red-600' : 'text-gray-900')}>{value}</p>
    </div>
  );
}
