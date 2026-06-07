/**
 * AnalyticsPage — /analytics (S8-03)
 *
 * Advanced analytics beyond /reports: Overview | Menu Engineering | Staff |
 * Customers | Peak Hours. Data from /api/v1/analytics/* (+ existing /reports
 * for the Overview KPIs/trend). Deterministic "quick insights" derived from
 * peak-hours + menu-engineering results (AI narratives live in /insights).
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, BarChart3, TrendingUp, Users, Clock, UtensilsCrossed,
  Archive, Mail, Trophy, AlertTriangle, Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ScatterChart, Scatter, BarChart, Bar, PieChart, Pie, Cell, ZAxis,
} from 'recharts';
import {
  analytics, reports, products as productsApi,
  type MenuItemInsight, type MenuQuadrant, type ReportDateParams,
} from '../lib/api';
import { getLocationId } from '../lib/session';
import { showToast } from '../components/ui/Toast';

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fmtShort = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

type Tab = 'overview' | 'menu' | 'staff' | 'customers' | 'peak';

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'overview',  label: 'Overview',         icon: <BarChart3 size={14} /> },
  { id: 'menu',      label: 'Menu Engineering', icon: <UtensilsCrossed size={14} /> },
  { id: 'staff',     label: 'Staff',            icon: <Users size={14} /> },
  { id: 'customers', label: 'Customers',        icon: <TrendingUp size={14} /> },
  { id: 'peak',      label: 'Peak Hours',       icon: <Clock size={14} /> },
];

const RANGES = [30, 60, 90] as const;

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);

  const params: ReportDateParams = useMemo(() => ({
    from: new Date(Date.now() - days * 24 * 3600 * 1000).toISOString(),
    to: new Date().toISOString(),
    locationId: getLocationId(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }), [days]);

  return (
    <div className="h-screen bg-surface-2 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronLeft size={14} /> Register
          </button>
          <BarChart3 size={18} className="text-primary ml-2" />
          <h1 className="text-base font-bold text-gray-900">Analytics</h1>
          <div className="ml-auto flex rounded-md border border-gray-200 overflow-hidden">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setDays(r)}
                className={clsx('px-3 py-1.5 text-xs font-medium transition-colors',
                  days === r ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50')}>
                {r}d
              </button>
            ))}
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={clsx('flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {tab === 'overview'  && <OverviewTab params={params} days={days} />}
          {tab === 'menu'      && <MenuTab params={params} />}
          {tab === 'staff'     && <StaffTab params={params} />}
          {tab === 'customers' && <CustomersTab params={params} />}
          {tab === 'peak'      && <PeakHoursTab params={params} />}
        </div>
      </main>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewTab({ params, days }: { params: ReportDateParams; days: number }) {
  const { data: sales } = useQuery({
    queryKey: ['analytics', 'sales', params],
    queryFn: () => reports.getSalesSummary(params, 'day'),
  });
  const { data: top } = useQuery({
    queryKey: ['analytics', 'top', params],
    queryFn: () => reports.getTopProducts(params, 5),
  });
  const { data: cust } = useQuery({
    queryKey: ['analytics', 'customer-insights', params],
    queryFn: () => analytics.customerInsights(params),
  });
  const { data: peak } = useQuery({
    queryKey: ['analytics', 'peak', params],
    queryFn: () => analytics.peakHours(params),
  });
  const { data: menu } = useQuery({
    queryKey: ['analytics', 'menu', params],
    queryFn: () => analytics.menuEngineering(params),
  });

  const rows = sales?.rows ?? [];
  const revenue = rows.reduce((s, r) => s + Number(r.gross_sales), 0);
  const orders = rows.reduce((s, r) => s + Number(r.order_count), 0);
  const avgTicket = orders > 0 ? Math.round(revenue / orders) : 0;
  const repeatRate = cust && (cust.newCustomers + cust.returningCustomers) > 0
    ? Math.round((cust.returningCustomers / (cust.newCustomers + cust.returningCustomers)) * 100)
    : 0;

  const trend = rows.map((r) => ({
    day: new Date(r.period).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    revenue: Number(r.gross_sales) / 100,
  }));

  // Deterministic quick insights
  const insights: string[] = [];
  if (peak && peak.peakDay !== '—') insights.push(`Your busiest period is ${peak.peakDay} around ${peak.peakHour}.`);
  if (peak && peak.slowestDay !== '—') insights.push(`${peak.slowestDay} ${peak.slowestHour} is your slowest active period — a promo could fill it.`);
  const star = menu?.items.find((i) => i.quadrant === 'star');
  if (star) insights.push(`${star.name} is a star — high volume AND high margin. Keep it front and center.`);
  const dogs = menu?.items.filter((i) => i.quadrant === 'dog').length ?? 0;
  if (dogs > 0) insights.push(`${dogs} menu item${dogs === 1 ? '' : 's'} are in the "dog" quadrant — review them in Menu Engineering.`);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label={`Revenue (${days}d)`} value={fmtShort(revenue)} />
        <Kpi label="Orders" value={orders.toLocaleString()} />
        <Kpi label="Avg ticket" value={fmt(avgTicket)} />
        <Kpi label="New customers" value={String(cust?.newCustomers ?? '—')} />
        <Kpi label="Repeat rate" value={`${repeatRate}%`} />
      </div>

      {/* Revenue trend */}
      <section className="bg-white rounded-xl border border-gray-100 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Revenue trend</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
              <Tooltip formatter={(v) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Revenue']} />
              <Line type="monotone" dataKey="revenue" stroke="#1D9E75" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top items */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Top 5 items</h2>
          {(top ?? []).length === 0 ? <Empty /> : (
            <div className="space-y-2">
              {(top ?? []).map((p, i) => (
                <div key={`${p.product_id}-${i}`} className="flex items-center gap-3 text-sm">
                  <span className="w-5 text-gray-300 font-bold">{i + 1}</span>
                  <span className="flex-1 text-gray-700 truncate">{p.product_name}</span>
                  <span className="text-gray-400 text-xs">{Number(p.qty_sold)} sold</span>
                  <span className="font-semibold text-gray-800 tabular-nums">{fmt(Number(p.gross_sales))}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quick insights */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-3">
            <Sparkles size={14} className="text-primary" /> Quick insights
          </h2>
          {insights.length === 0 ? <Empty /> : (
            <ul className="space-y-2">
              {insights.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-600 leading-snug">
                  <span className="text-primary shrink-0">•</span> {s}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Menu Engineering ─────────────────────────────────────────────────────────

const QUADRANT_META: Record<MenuQuadrant, { label: string; color: string }> = {
  star:       { label: 'Stars',       color: '#1D9E75' },
  plow_horse: { label: 'Plowhorses',  color: '#F59E0B' },
  puzzle:     { label: 'Puzzles',     color: '#6366F1' },
  dog:        { label: 'Dogs',        color: '#E24B4A' },
};

function MenuTab({ params }: { params: ReportDateParams }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MenuItemInsight | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'menu-insights', params],
    queryFn: () => analytics.menuInsights(params),
    retry: 1,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'menu-insights'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'menu'] });
  };

  const archive = useMutation({
    mutationFn: (productId: string) => productsApi.archive(productId, 'Menu engineering: AI recommendation'),
    onSuccess: () => { showToast.success('Item archived'); invalidate(); setSelected(null); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Archive failed'),
  });

  const reprice = useMutation({
    mutationFn: ({ productId, price }: { productId: string; price: number }) =>
      productsApi.update(productId, { price }),
    onSuccess: (_r, v) => { showToast.success(`Price updated to $${(v.price / 100).toFixed(2)}`); invalidate(); setSelected(null); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Price update failed'),
  });

  const runAction = (item: MenuItemInsight) => {
    switch (item.suggestedAction) {
      case 'archive':
        if (window.confirm(`Archive "${item.name}"? It will disappear from the register until restored.`)) {
          archive.mutate(item.productId);
        }
        break;
      case 'reprice': {
        const suggested = item.suggestedPrice ?? Math.round(item.avgPrice * 1.1);
        const input = window.prompt(`New price for ${item.name} (current avg $${(item.avgPrice / 100).toFixed(2)}):`,
          (suggested / 100).toFixed(2));
        if (!input) return;
        const cents = Math.round(parseFloat(input) * 100);
        if (!isFinite(cents) || cents <= 0) { showToast.error('Enter a valid price'); return; }
        reprice.mutate({ productId: item.productId, price: cents });
        break;
      }
      case 'promote':
        showToast.info(`Feature ${item.name} on your menu and register tiles — "featured" flag coming soon.`);
        break;
      case 'reposition':
        showToast.info(`Try moving ${item.name} higher on the menu or bundling it with a star item.`);
        break;
      default:
        break;
    }
  };

  const items = data?.items ?? [];
  const scatterData = items.map((i) => ({
    ...i,
    x: i.salesCount,
    y: i.revenue > 0 ? Math.round((i.margin / i.revenue) * 100) : 0,
  }));

  if (isLoading) return <Skeleton />;
  if (!items.length) return <Empty big />;

  return (
    <div className="space-y-6">
      {/* AI narrative (S9-03) */}
      <section className="bg-primary/5 border border-primary/20 rounded-xl p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-primary-dark mb-1.5">
          <Sparkles size={13} /> AI menu assessment{data?.aiUsed === false ? ' (statistical)' : ''}
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">{data?.aiNarrative}</p>
      </section>

      {/* Quick wins (S9-03) */}
      {(data?.quickWins?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(data?.quickWins ?? []).map((w, i) => {
            // Match the quick win to an item so the button can act on it
            const target = items.find((it) => w.toLowerCase().includes(it.name.toLowerCase()));
            return (
              <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col">
                <p className="text-sm text-gray-700 leading-snug flex-1">
                  {['🌟', '💰', '🗑️'][i] ?? '✨'} {w}
                </p>
                {target && target.suggestedAction !== 'none' && (
                  <button onClick={() => runAction(target)}
                    className="mt-3 self-start px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-dark">
                    {target.suggestedAction === 'archive' ? 'Archive'
                      : target.suggestedAction === 'reprice'
                        ? (target.suggestedPrice ? `Raise to $${(target.suggestedPrice / 100).toFixed(2)}` : 'Update price')
                        : target.suggestedAction === 'promote' ? 'Mark as featured' : 'Reposition'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Scatter */}
      <section className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">Popularity × Profitability</h2>
          <div className="flex gap-3 text-xs">
            {(Object.keys(QUADRANT_META) as MenuQuadrant[]).map((q) => (
              <span key={q} className="flex items-center gap-1 text-gray-500">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: QUADRANT_META[q].color }} />
                {QUADRANT_META[q].label}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-3">X: units sold · Y: margin % · click a dot for the recommendation</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis type="number" dataKey="x" name="Units sold" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis type="number" dataKey="y" name="Margin %" tick={{ fontSize: 11 }} stroke="#94A3B8" tickFormatter={(v: number) => `${v}%`} />
              <ZAxis range={[60, 60]} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as (typeof scatterData)[number] | undefined;
                  if (!p) return null;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
                      <p className="font-semibold text-gray-800">{p.name}</p>
                      <p className="text-gray-500">{p.salesCount} sold · {p.y}% margin · {fmt(p.revenue)}</p>
                    </div>
                  );
                }}
              />
              {(Object.keys(QUADRANT_META) as MenuQuadrant[]).map((q) => (
                <Scatter key={q} data={scatterData.filter((i) => i.quadrant === q)}
                  fill={QUADRANT_META[q].color}
                  onClick={(p: unknown) => setSelected(p as MenuItemInsight)} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Selected item detail */}
      {selected && (
        <section className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-bold text-gray-900">
              {selected.name}
              <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase text-white"
                style={{ background: QUADRANT_META[selected.quadrant].color }}>
                {QUADRANT_META[selected.quadrant].label.replace(/s$/, '')}
              </span>
            </p>
            <p className="text-xs text-gray-600 mt-1">{selected.aiRecommendation}</p>
          </div>
          {selected.suggestedAction !== 'none' && (
            <button onClick={() => runAction(selected)} disabled={archive.isPending || reprice.isPending}
              className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 text-white',
                selected.suggestedAction === 'archive' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark')}>
              {selected.suggestedAction === 'archive' && <Archive size={13} />}
              {selected.suggestedAction === 'archive' ? 'Archive item'
                : selected.suggestedAction === 'reprice'
                  ? (selected.suggestedPrice ? `Raise to $${(selected.suggestedPrice / 100).toFixed(2)}` : 'Update price')
                  : selected.suggestedAction === 'promote' ? 'Feature it' : 'Reposition'}
            </button>
          )}
          <button onClick={() => setSelected(null)} className="text-xs text-gray-400 hover:text-gray-600">Dismiss</button>
        </section>
      )}

      {/* Table */}
      <section className="bg-white rounded-lg border border-gray-100 overflow-clip">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
            <tr>
              <th className="text-left font-medium px-4 py-2">Item</th>
              <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Category</th>
              <th className="text-right font-medium px-3 py-2">Sold</th>
              <th className="text-right font-medium px-3 py-2">Revenue</th>
              <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Food cost</th>
              <th className="text-left font-medium px-3 py-2">Quadrant</th>
              <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">AI recommendation</th>
              <th className="text-right font-medium px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {[...items].sort((a, b) => a.quadrant.localeCompare(b.quadrant)).map((i) => (
              <tr key={i.productId} onClick={() => setSelected(i)}
                className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer">
                <td className="px-4 py-2.5 font-medium text-gray-800">{i.name}</td>
                <td className="px-3 py-2.5 text-gray-500 hidden md:table-cell">{i.category}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{i.salesCount}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmt(i.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{i.foodCostPct > 0 ? `${i.foodCostPct}%` : '—'}</td>
                <td className="px-3 py-2.5">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase text-white"
                    style={{ background: QUADRANT_META[i.quadrant].color }}>
                    {QUADRANT_META[i.quadrant].label.replace(/s$/, '')}
                  </span>
                </td>
                <td className="px-3 py-2.5 hidden lg:table-cell max-w-[280px]">
                  <span className={clsx('text-xs leading-snug line-clamp-2',
                    i.suggestedAction === 'promote' ? 'text-green-700'
                      : i.suggestedAction === 'reprice' ? 'text-amber-700'
                      : i.suggestedAction === 'reposition' ? 'text-blue-700'
                      : i.suggestedAction === 'archive' ? 'text-red-700' : 'text-gray-500')}>
                    {i.aiRecommendation}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {i.suggestedAction !== 'none' && (
                    <button onClick={(e) => { e.stopPropagation(); runAction(i); }}
                      className={clsx('px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap',
                        i.suggestedAction === 'archive' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-primary/10 text-primary hover:bg-primary/20')}>
                      {i.suggestedAction === 'archive' ? 'Archive'
                        : i.suggestedAction === 'reprice'
                          ? (i.suggestedPrice ? `→ $${(i.suggestedPrice / 100).toFixed(2)}` : 'Reprice')
                          : i.suggestedAction === 'promote' ? 'Feature' : 'Reposition'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── Staff ────────────────────────────────────────────────────────────────────

function StaffTab({ params }: { params: ReportDateParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'staff', params],
    queryFn: () => analytics.staffPerformance(params),
  });

  const emps = data?.employees ?? [];
  if (isLoading) return <Skeleton />;
  if (!emps.length) return <Empty big />;

  const topPerformer = emps[0];
  const barData = emps.slice(0, 10).map((e) => ({ name: e.name.split(' ')[0], revenue: e.revenue / 100 }));

  return (
    <div className="space-y-6">
      {topPerformer && topPerformer.revenue > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <Trophy size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-900">
            <strong>{topPerformer.name}</strong> is your top performer this period —{' '}
            {fmt(topPerformer.revenue)} across {topPerformer.ordersProcessed} orders.
          </p>
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-100 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Revenue per employee</h2>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
              <Tooltip formatter={(v) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#1D9E75" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="bg-white rounded-lg border border-gray-100 overflow-clip">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2 border-b border-gray-100 text-xs text-gray-400">
            <tr>
              <th className="text-left font-medium px-4 py-2">Employee</th>
              <th className="text-right font-medium px-3 py-2">Orders</th>
              <th className="text-right font-medium px-3 py-2">Revenue</th>
              <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">Avg ticket</th>
              <th className="text-right font-medium px-3 py-2 hidden md:table-cell">Tips</th>
              <th className="text-right font-medium px-4 py-2">Void rate</th>
            </tr>
          </thead>
          <tbody>
            {emps.map((e) => (
              <tr key={e.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 font-medium text-gray-800">{e.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{e.ordersProcessed}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmt(e.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell">{fmt(e.avgTicket)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums hidden md:table-cell">{fmt(e.tipsEarned)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={clsx('inline-flex items-center gap-1 tabular-nums',
                    e.voidRate > 3 ? 'text-red-600 font-semibold' : 'text-gray-600')}>
                    {e.voidRate > 3 && <AlertTriangle size={12} />}
                    {e.voidRate}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-50">
          Hours worked / revenue-per-hour will appear once time-clock tracking ships.
        </p>
      </section>
    </div>
  );
}

// ─── Customers ────────────────────────────────────────────────────────────────

function CustomersTab({ params }: { params: ReportDateParams }) {
  const { data: cohort } = useQuery({
    queryKey: ['analytics', 'cohort', params.locationId],
    queryFn: () => analytics.cohort(6, params.locationId),
  });
  const { data: ins, isLoading } = useQuery({
    queryKey: ['analytics', 'customer-insights', params],
    queryFn: () => analytics.customerInsights(params),
  });

  if (isLoading) return <Skeleton />;

  const pieData = [
    { name: 'New', value: ins?.newCustomers ?? 0, color: '#1D9E75' },
    { name: 'Returning', value: ins?.returningCustomers ?? 0, color: '#6366F1' },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total customers" value={String(ins?.totalCustomers ?? 0)} />
        <Kpi label="New this period" value={String(ins?.newCustomers ?? 0)} />
        <Kpi label="Avg visits" value={String(ins?.avgVisitsPerCustomer ?? 0)} />
        <Kpi label="Avg lifetime value" value={fmt(ins?.avgLifetimeValue ?? 0)} />
      </div>

      {/* Cohort grid */}
      <section className="bg-white rounded-xl border border-gray-100 p-4 overflow-x-auto">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Cohort retention</h2>
        <p className="text-xs text-gray-400 mb-3">% of each signup month&apos;s customers who ordered again N months later</p>
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left font-medium py-1.5 pr-3">Cohort</th>
              <th className="text-right font-medium py-1.5 px-2">New</th>
              {['M1', 'M2', 'M3', 'M6'].map((m) => <th key={m} className="text-center font-medium py-1.5 px-2">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {(cohort?.cohorts ?? []).map((c) => (
              <tr key={c.month} className="border-t border-gray-50">
                <td className="py-2 pr-3 font-medium text-gray-700">{c.month}</td>
                <td className="py-2 px-2 text-right tabular-nums text-gray-600">{c.newCustomers}</td>
                {([c.retention.month1, c.retention.month2, c.retention.month3, c.retention.month6]).map((v, i) => (
                  <td key={i} className="py-2 px-2 text-center">
                    <span className="inline-block min-w-[42px] py-1 rounded tabular-nums font-medium"
                      style={{ background: `rgba(29,158,117,${Math.min(0.85, v / 100 + 0.04)})`, color: v > 35 ? '#fff' : '#334155' }}>
                      {v}%
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {(cohort?.cohorts ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-gray-400">No cohort data yet</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Churn risk */}
        <section className="bg-white rounded-xl border border-gray-100 p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Churn risk — no visit in 30+ days</h2>
          {(ins?.churnRisk ?? []).length === 0 ? <Empty /> : (
            <div className="space-y-2">
              {(ins?.churnRisk ?? []).map((c) => (
                <div key={c.customerId} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 text-gray-700 truncate">{c.name}</span>
                  <span className="text-xs text-gray-400">last {new Date(c.lastVisit).toLocaleDateString()}</span>
                  <span className="font-semibold text-gray-800 tabular-nums">{fmt(c.lifetimeValue)}</span>
                  <a href={`mailto:?subject=${encodeURIComponent('We miss you!')}`}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-xs text-gray-500 hover:bg-gray-50">
                    <Mail size={11} /> Reach out
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* New vs returning */}
        <section className="bg-white rounded-xl border border-gray-100 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">New vs returning</h2>
          {pieData.length === 0 ? <Empty /> : (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={64} paddingAngle={3}>
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex justify-center gap-4 text-xs text-gray-500">
            {pieData.map((d) => (
              <span key={d.name} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} /> {d.name} ({d.value})
              </span>
            ))}
          </div>
        </section>
      </div>

      {/* Top customers */}
      <section className="bg-white rounded-lg border border-gray-100 overflow-clip">
        <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">Top customers</h2></div>
        <table className="w-full text-sm">
          <tbody>
            {(ins?.topCustomers ?? []).map((c, i) => (
              <tr key={c.customerId} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 w-8 text-gray-300 font-bold">{i + 1}</td>
                <td className="py-2.5 font-medium text-gray-800">{c.name}</td>
                <td className="px-3 py-2.5 text-right text-gray-500 text-xs">{c.visits} visit{c.visits === 1 ? '' : 's'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell text-gray-500">{fmt(c.avgTicket)} avg</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{fmt(c.totalSpent)}</td>
              </tr>
            ))}
            {(ins?.topCustomers ?? []).length === 0 && (
              <tr><td className="py-6 text-center text-gray-400" colSpan={5}>No customer orders in this period</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ─── Peak hours ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PeakHoursTab({ params }: { params: ReportDateParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', 'peak', params],
    queryFn: () => analytics.peakHours(params),
  });

  if (isLoading) return <Skeleton />;
  if (!data || data.heatmap.every((c) => c.orderCount === 0)) return <Empty big />;

  const cell = (d: number, h: number) => data.heatmap.find((c) => c.dayOfWeek === d && c.hour === h);

  const staffing = data.peakDay !== '—'
    ? `Based on your patterns, consider adding staff on ${data.peakDay} around ${data.peakHour} — it's consistently your busiest window.`
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-xl">
        <Kpi label="Busiest" value={`${data.peakDay} ${data.peakHour}`} />
        <Kpi label="Slowest (active)" value={`${data.slowestDay} ${data.slowestHour}`} />
      </div>

      <section className="bg-white rounded-xl border border-gray-100 p-4 overflow-x-auto">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Revenue heatmap — day × hour</h2>
        <div className="min-w-[700px]">
          {/* Hour header */}
          <div className="grid gap-px mb-px" style={{ gridTemplateColumns: '44px repeat(24, 1fr)' }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[9px] text-gray-400 text-center">{h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : ''}</div>
            ))}
          </div>
          {DAY_LABELS.map((label, d) => (
            <div key={d} className="grid gap-px mb-px" style={{ gridTemplateColumns: '44px repeat(24, 1fr)' }}>
              <div className="text-[10px] text-gray-500 font-medium flex items-center">{label}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const c = cell(d, h);
                const a = c?.intensity ?? 0;
                return (
                  <div key={h}
                    title={c && c.orderCount > 0 ? `${label} ${h}:00 — ${c.orderCount} orders · ${fmt(c.revenue)}` : undefined}
                    className="h-6 rounded-[2px]"
                    style={{ background: a > 0 ? `rgba(29,158,117,${0.12 + a * 0.88})` : '#F8FAFC' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {staffing && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
          <Users size={18} className="text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700">{staffing}</p>
        </div>
      )}
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function Empty({ big }: { big?: boolean }) {
  return (
    <div className={clsx('text-center text-sm text-gray-400', big ? 'py-16' : 'py-6')}>
      No data for this period yet
    </div>
  );
}

function Skeleton() {
  return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>;
}
