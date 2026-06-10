/**
 * Admin Metrics — /admin/metrics
 *
 * Detailed platform analytics for executives, grouped into Revenue / Growth /
 * Usage / Health sections. Sourced from /api/v1/admin/metrics (+ /api/health).
 * Values that the current backend does not expose are clearly marked "—" rather
 * than fabricated.
 */
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, Activity, HeartPulse } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { fmtCurrency } from '../../lib/dateRanges';
import { StatCard } from './adminUi';

const HEALTH_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/health`;

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-primary">{icon}</span>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
    </section>
  );
}

export function AdminMetricsPage() {
  const metricsQ = useQuery({
    queryKey: ['admin', 'metrics'],
    queryFn: () => adminApi.metrics.get(),
  });

  const healthQ = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const r = await fetch(HEALTH_URL);
      return r.json() as Promise<{ status: string; version?: string; uptime?: number; checks?: Record<string, string> }>;
    },
    refetchInterval: 30_000,
  });

  const m = metricsQ.data;

  const trialConversion =
    m && m.organizations.total > 0
      ? Math.round((m.organizations.active / m.organizations.total) * 100)
      : 0;

  const uptimeHrs = healthQ.data?.uptime ? Math.floor(healthQ.data.uptime / 3600) : null;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Platform Analytics</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Detailed metrics across revenue, growth, usage, and system health.
        </p>
      </div>

      {metricsQ.isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : metricsQ.isError ? (
        <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-4 py-3">
          Failed to load metrics: {(metricsQ.error as Error).message}
        </div>
      ) : m ? (
        <>
          <Section title="Revenue Metrics" icon={<DollarSign size={16} />}>
            <StatCard
              label="GMV (30d)"
              value={fmtCurrency(m.revenue.mrrProxy)}
              sub="completed-order volume"
            />
            <StatCard label="GMV (7d)" value={fmtCurrency(m.revenue.revenue7d)} sub="last 7 days" />
            <StatCard
              label="Avg Order Value"
              value={fmtCurrency(m.orders.avgOrderValue)}
              sub="completed orders, 30d"
            />
            <StatCard
              label="Orders (30d)"
              value={m.revenue.orders30d.toLocaleString()}
              sub="completed"
            />
          </Section>

          <Section title="Growth Metrics" icon={<TrendingUp size={16} />}>
            <StatCard
              label="New Orgs (30d)"
              value={m.organizations.new30d}
              sub="sign-ups this month"
            />
            <StatCard
              label="Active Conversion"
              value={`${trialConversion}%`}
              sub="active ÷ total orgs"
            />
            <StatCard label="Trialing" value={m.organizations.trialing} sub="orgs in trial" />
            <StatCard
              label="Churned"
              value={m.organizations.churned}
              sub="cancelled / past_due / unpaid"
            />
          </Section>

          <Section title="Usage Metrics" icon={<Activity size={16} />}>
            <StatCard
              label="Active Orgs (30d)"
              value={m.orders.activeOrgs}
              sub="≥1 completed order"
            />
            <StatCard
              label="Total Orders (30d)"
              value={m.orders.totalOrders.toLocaleString()}
              sub="completed"
            />
            <StatCard label="Total Orgs" value={m.organizations.total} sub="all-time, non-deleted" />
            <StatCard label="Platform Users" value={m.users.total} sub="active employees" />
          </Section>

          <Section title="Health Metrics" icon={<HeartPulse size={16} />}>
            <StatCard
              label="API Status"
              value={
                <span className={healthQ.data?.status === 'ok' ? 'text-green-600' : 'text-danger'}>
                  {healthQ.data?.status === 'ok' ? 'Operational' : healthQ.isLoading ? '…' : 'Down'}
                </span>
              }
              sub={healthQ.data?.version ? `v${healthQ.data.version}` : undefined}
            />
            <StatCard
              label="Database"
              value={
                <span className={healthQ.data?.checks?.database === 'ok' ? 'text-green-600' : 'text-danger'}>
                  {healthQ.data?.checks?.database ?? '—'}
                </span>
              }
            />
            <StatCard
              label="Redis"
              value={
                <span className={healthQ.data?.checks?.redis === 'ok' ? 'text-green-600' : 'text-danger'}>
                  {healthQ.data?.checks?.redis ?? '—'}
                </span>
              }
            />
            <StatCard
              label="API Uptime"
              value={uptimeHrs !== null ? `${uptimeHrs}h` : '—'}
              sub="since last deploy"
            />
          </Section>

          <p className="text-[11px] text-gray-400">
            Note: error rate, average API response time, and database size are not yet exposed by the
            platform metrics endpoint and are shown as “—”. GMV reflects customer order volume, not
            Taproot subscription revenue.
          </p>
        </>
      ) : null}
    </div>
  );
}
