/**
 * InsightsPage — /insights  (AI Intelligence layer, Sprint 5)
 *
 * Tabbed AI dashboard. Each tab computes deterministic numbers and layers a
 * Claude narrative on top (badged "AI" when the model was used). Tabs are added
 * across S5-01…S5-06.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, TrendingUp } from 'lucide-react';
import { clsx } from 'clsx';
import { intelligence } from '../lib/api';
import { SalesBarChart } from '../components/charts/SalesBarChart';
import { fmtShortCurrency } from '../lib/dateRanges';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

type TabId = 'forecast';
const TABS: Array<{ id: TabId; label: string; icon: React.FC<{ size?: number; className?: string }> }> = [
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
];

function AiBadge({ used }: { used: boolean }) {
  return used ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
      <Sparkles size={10} /> AI
    </span>
  ) : (
    <span className="text-[10px] text-gray-400">computed</span>
  );
}

export function InsightsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('forecast');

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={14} /> POS</button>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-purple-100 flex items-center justify-center"><Sparkles size={15} className="text-purple-600" /></div>
            <h1 className="text-base font-bold text-gray-900">Insights</h1>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-0 border-t border-gray-50 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={clsx('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  tab === t.id ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
          {tab === 'forecast' && <ForecastTab />}
        </div>
      </main>
    </div>
  );
}

function fmt(c: number): string { return `$${(c / 100).toFixed(2)}`; }

function ForecastTab() {
  const { data, isLoading } = useQuery({ queryKey: ['intel', 'forecast'], queryFn: () => intelligence.forecast(TZ), staleTime: 60_000 });

  const chart = (data?.forecast ?? []).map((f) => ({ name: f.dow, sales: f.predictedSales }));
  const total = (data?.forecast ?? []).reduce((s, f) => s + f.predictedSales, 0);

  if (isLoading) return <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />;
  if (!data) return <p className="text-sm text-gray-400">No forecast available.</p>;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">7-day demand forecast</h3>
          <AiBadge used={data.aiUsed} />
        </div>
        <p className="text-sm text-gray-600">{data.narrative}</p>
        <p className="text-xs text-gray-400 mt-1">Projected total: <strong className="text-gray-700">{fmt(total)}</strong></p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Predicted daily sales</h3>
        {chart.length === 0 ? <p className="text-sm text-gray-400">Not enough history.</p> : (
          <SalesBarChart data={chart} xKey="name" bars={[{ key: 'sales', color: '#8B5CF6', label: 'Sales' }]} height={200} showLegend={false} yFormatter={fmtShortCurrency} />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Forecast detail</h3>
        <table className="w-full text-sm">
          <tbody>
            {data.forecast.map((f) => (
              <tr key={f.date} className="border-b border-gray-50 last:border-0">
                <td className="py-2 text-gray-700">{f.dow} <span className="text-gray-400 text-xs">{f.date.slice(5)}</span></td>
                <td className="py-2 text-right text-gray-500">{f.predictedOrders} orders</td>
                <td className="py-2 text-right font-semibold text-gray-800">{fmt(f.predictedSales)}</td>
                <td className="py-2 text-right">
                  <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full',
                    f.confidence === 'high' ? 'bg-green-50 text-green-600' : f.confidence === 'medium' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400')}>{f.confidence}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
