/**
 * Admin Dashboard — /admin/dashboard
 *
 * Executive platform overview: 4 KPI cards, recent organizations table, and a
 * live service-health panel (polls /api/health directly).
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  CreditCard,
  DollarSign,
  Users,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { fmtCurrency } from '../../lib/dateRanges';
import { StatCard, StatusBadge, PlanBadge, fmtFullDate, fmtRelative } from './adminUi';

const HEALTH_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/health`;

interface HealthResponse {
  status: string;
  version?: string;
  timestamp?: string;
  checks?: Record<string, string>;
}

export function AdminDashboardPage() {
  const metricsQ = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => adminApi.metrics.get(),
  });

  const orgsQ = useQuery({
    queryKey: ['admin', 'orgs', 'recent'],
    queryFn: () => adminApi.organizations.list({ page: 1 }),
  });

  const healthQ = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async (): Promise<HealthResponse> => {
      const r = await fetch(HEALTH_URL);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const m = metricsQ.data;
  const recentOrgs = (orgsQ.data?.organizations ?? []).slice(0, 10);

  const conversionPct =
    m && m.organizations.total > 0
      ? Math.round((m.organizations.active / m.organizations.total) * 100)
      : 0;

  const refreshAll = () => {
    void metricsQ.refetch();
    void orgsQ.refetch();
    void healthQ.refetch();
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Taproot POS — Platform Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Last updated {healthQ.dataUpdatedAt ? fmtRelative(new Date(healthQ.dataUpdatedAt).toISOString()) : '—'}
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 bg-white transition-colors"
        >
          <RefreshCw size={14} className={metricsQ.isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Metrics row */}
      {metricsQ.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : metricsQ.isError ? (
        <div className="mb-8 text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-4 py-3">
          Failed to load metrics: {(metricsQ.error as Error).message}
        </div>
      ) : m ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Organizations"
            value={m.organizations.total}
            sub={`${m.organizations.new30d} new this month`}
            icon={<Building2 size={18} />}
          />
          <StatCard
            label="Active Subscriptions"
            value={m.organizations.active}
            sub={`${conversionPct}% of all orgs active`}
            icon={<CreditCard size={18} />}
          />
          <StatCard
            label="Revenue (30d GMV)"
            value={fmtCurrency(m.revenue.mrrProxy)}
            sub={`${m.revenue.orders30d} orders processed`}
            icon={<DollarSign size={18} />}
          />
          <StatCard
            label="Platform Users"
            value={m.users.total}
            sub="employees across all orgs"
            icon={<Users size={18} />}
          />
        </div>
      ) : null}

      {m && (
        <div className="text-[11px] text-gray-400 -mt-5 mb-8">
          Breakdown: {m.organizations.active} active · {m.organizations.trialing} trialing ·{' '}
          {m.organizations.churned} churned · Revenue is customer order volume (GMV), not Taproot revenue.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent organizations */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Recent Organizations</h2>
            <Link
              to="/admin/organizations"
              className="text-xs font-medium text-primary hover:text-primary-dark flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium text-right">Rev 30d</th>
                  <th className="px-5 py-2 font-medium text-right" />
                </tr>
              </thead>
              <tbody>
                {orgsQ.isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-400">Loading…</td>
                  </tr>
                ) : recentOrgs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-400">No organizations yet</td>
                  </tr>
                ) : (
                  recentOrgs.map((o) => (
                    <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                      <td className="px-5 py-2.5">
                        <Link to={`/admin/organizations/${o.id}`} className="font-medium text-gray-900 hover:text-primary">
                          {o.name}
                        </Link>
                        <div className="text-[11px] text-gray-400">{o.slug}</div>
                      </td>
                      <td className="px-3 py-2.5"><PlanBadge plan={o.plan} /></td>
                      <td className="px-3 py-2.5"><StatusBadge status={o.subscriptionStatus} /></td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{fmtFullDate(o.createdAt)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(o.revenue30d)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <Link to={`/admin/organizations/${o.id}`} className="text-primary hover:text-primary-dark text-xs font-medium">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Health status */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Service Health</h2>
          </div>
          <div className="p-5 space-y-3">
            <HealthRow label="API" ok={healthQ.data?.status === 'ok'} loading={healthQ.isLoading} />
            <HealthRow label="Database" ok={healthQ.data?.checks?.database === 'ok'} loading={healthQ.isLoading} />
            <HealthRow label="Redis" ok={healthQ.data?.checks?.redis === 'ok'} loading={healthQ.isLoading} />
            <HealthRow label="Stripe" ok={healthQ.data?.checks?.stripe === 'ok'} loading={healthQ.isLoading} />
            <div className="pt-2 border-t border-gray-50 text-[11px] text-gray-400">
              {healthQ.data?.version && <div>Version {healthQ.data.version}</div>}
              <div>
                Last checked{' '}
                {healthQ.dataUpdatedAt
                  ? new Date(healthQ.dataUpdatedAt).toLocaleTimeString('en-US')
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthRow({ label, ok, loading }: { label: string; ok: boolean; loading: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">{label}</span>
      {loading ? (
        <span className="text-xs text-gray-400">checking…</span>
      ) : (
        <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-green-600' : 'text-danger'}`}>
          <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-danger'}`} />
          {ok ? 'Operational' : 'Down'}
        </span>
      )}
    </div>
  );
}
