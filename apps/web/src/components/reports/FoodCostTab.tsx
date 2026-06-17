/**
 * FoodCostTab — ingredient-system food cost, modifier attach rates, and omission
 * insights (Session 6). COGS comes from stock_movements × ingredient cost, so it
 * only has data once products run in recipe mode and recipe orders are placed.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import { ingredientsApi } from '../../lib/api';
import { fmtCurrency } from '../../lib/dateRanges';

function statusColor(status: string): string {
  if (status === 'excellent' || status === 'good') return 'text-green-600';
  if (status === 'high') return 'text-amber-600';
  return 'text-red-600';
}

function StatCard({ label, value, valueCls, sub }: { label: string; value: string; valueCls?: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={clsx('text-2xl font-bold mt-1', valueCls ?? 'text-gray-900')}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const BENCH_SEGMENTS = [
  { label: 'Excellent', range: '<25%',  cls: 'bg-green-500' },
  { label: 'Good',      range: '25-35%', cls: 'bg-emerald-400' },
  { label: 'High',      range: '35-45%', cls: 'bg-amber-400' },
  { label: 'Critical',  range: '>45%',   cls: 'bg-red-500' },
];

export function FoodCostTab() {
  const { data: fc, isLoading } = useQuery({ queryKey: ['analytics', 'food-cost', 7], queryFn: () => ingredientsApi.foodCost(7) });
  const { data: attach } = useQuery({ queryKey: ['analytics', 'modifier-attach', 30], queryFn: () => ingredientsApi.modifierAttach(30) });
  const { data: omissions } = useQuery({ queryKey: ['analytics', 'omissions', 30], queryFn: () => ingredientsApi.omissions(30) });

  if (isLoading || !fc) {
    return <div className="space-y-3"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-shimmer" />)}</div><div className="h-56 bg-gray-100 rounded-lg animate-shimmer" /></div>;
  }

  // No recipe-mode data yet → guidance.
  if (fc.recipeCoverage === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center max-w-xl mx-auto">
        <h3 className="text-base font-bold text-gray-900">Food cost tracking</h3>
        <p className="text-sm text-gray-500 mt-2">
          Food cost activates automatically once you enable recipe mode on your menu items —
          Taproot then deducts ingredients as orders complete and computes your COGS.
        </p>
        <Link to="/settings/products" className="inline-block mt-4 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">
          Set up recipes →
        </Link>
      </div>
    );
  }

  // Marker position on the benchmark bar (clamp 0–60% across 4 equal segments).
  const markerPct = Math.min(Math.max(fc.foodCostPercent, 0), 60) / 60 * 100;
  const chartData = fc.byDay.map((d) => ({ date: d.date.slice(5), pct: d.foodCostPercent }));

  return (
    <div className="space-y-6">
      {/* ── Food cost ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Food Cost</h2>
        <p className="text-xs text-gray-400 mb-3">Based on recipe-mode orders · last {fc.periodDays} day{fc.periodDays !== 1 ? 's' : ''}</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Food Cost %" value={`${fc.foodCostPercent}%`} valueCls={statusColor(fc.benchmark.status)} sub={fc.benchmark.status} />
          <StatCard label="Total COGS" value={fmtCurrency(fc.totalCOGS)} />
          <StatCard label="Gross Margin" value={fmtCurrency(fc.grossMargin)} valueCls="text-green-600" />
          <StatCard label="Recipe Coverage" value={`${fc.recipeCoverage}%`} sub={`${fc.recipeOrderCount}/${fc.totalOrderCount} orders`} />
        </div>

        {/* Benchmark indicator */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-700">Industry benchmark</p>
            <p className="text-xs text-gray-400">avg {fc.benchmark.industryAvg}% · you {fc.foodCostPercent}%</p>
          </div>
          <div className="relative">
            <div className="flex h-3 rounded-full overflow-hidden">
              {BENCH_SEGMENTS.map((s) => <div key={s.label} className={clsx('flex-1', s.cls)} />)}
            </div>
            <div className="absolute -top-1 w-0.5 h-5 bg-gray-900" style={{ left: `${markerPct}%` }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
            {BENCH_SEGMENTS.map((s) => <span key={s.label}>{s.label} {s.range}</span>)}
          </div>
        </div>

        {/* 7-day trend */}
        {chartData.length > 1 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mt-3">
            <p className="text-sm font-semibold text-gray-700 mb-3">Food cost % trend</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit="%" />
                <Tooltip formatter={(value) => [`${value}%`, 'Food cost']} />
                <ReferenceLine y={fc.benchmark.industryAvg} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: `avg ${fc.benchmark.industryAvg}%`, fontSize: 10, fill: '#f59e0b', position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="pct" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Modifier attach rates ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-bold text-gray-900">Add-on performance</h2>
        <p className="text-xs text-gray-400 mb-3">Last 30 days</p>
        {!attach || attach.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No modifier data yet. Add-on tracking starts once recipe-mode orders are placed.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-1.5 font-semibold">Ingredient</th>
                <th className="py-1.5 font-semibold">Type</th>
                <th className="py-1.5 font-semibold text-right">Attach rate</th>
                <th className="py-1.5 font-semibold text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {attach.map((a) => (
                <tr key={`${a.ingredientId}:${a.modifierType}`} className="border-b border-gray-50 last:border-0">
                  <td className="py-1.5 text-gray-700">{a.ingredientName}</td>
                  <td className="py-1.5 text-gray-500 capitalize">{a.modifierType.replace('_', '-')}</td>
                  <td className="py-1.5 text-right font-semibold text-gray-900">{a.attachRate}%</td>
                  <td className="py-1.5 text-right text-green-600">{fmtCurrency(a.revenueFromModifier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Omission insights ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-base font-bold text-gray-900">What customers skip</h2>
        <p className="text-xs text-gray-400 mb-3">Last 30 days</p>
        {!omissions || omissions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No omission data yet.</p>
        ) : (
          <div className="space-y-2">
            {omissions.map((o, i) => (
              <div key={i} className={clsx('rounded-md px-3 py-2 text-sm',
                o.omissionRate >= 40 ? 'bg-amber-50 text-amber-800'
                  : o.omissionRate >= 20 ? 'bg-yellow-50 text-yellow-800'
                  : 'bg-gray-50 text-gray-600')}>
                <p className="font-medium">{o.ingredientName} in {o.productName} · {o.omissionRate}%</p>
                <p className="text-xs mt-0.5 opacity-90">{o.insight}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
