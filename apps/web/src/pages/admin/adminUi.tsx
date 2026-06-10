/**
 * Shared presentational helpers for the admin portal (badges, date/value
 * formatting). Kept inside pages/admin/* per the session scope.
 */
import type { ReactNode } from 'react';

// ── Status badge (subscription_status) ──────────────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  trialing: 'bg-blue-100 text-blue-700',
  past_due: 'bg-amber-100 text-amber-700',
  unpaid: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
  canceled: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${cls}`}>
      {status ? status.replace(/_/g, ' ') : '—'}
    </span>
  );
}

// ── Plan badge ──────────────────────────────────────────────────────────────
const PLAN_STYLE: Record<string, string> = {
  trial: 'bg-gray-100 text-gray-600',
  starter: 'bg-sky-100 text-sky-700',
  growth: 'bg-violet-100 text-violet-700',
  enterprise: 'bg-indigo-100 text-indigo-700',
};

export function PlanBadge({ plan }: { plan: string }) {
  const cls = PLAN_STYLE[plan] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${cls}`}>
      {plan || '—'}
    </span>
  );
}

// ── Date formatting ─────────────────────────────────────────────────────────
export function fmtFullDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtFullDate(iso);
}

// ── Stat card ───────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
        {icon && <div className="text-gray-300">{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </div>
  );
}
