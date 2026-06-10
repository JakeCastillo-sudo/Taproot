/**
 * Admin Organizations — /admin/organizations
 *
 * Customer-account management: searchable / filterable / paginated table of all
 * organizations. Search is debounced; status + plan filters and page reset
 * together via query keys.
 */
import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { fmtCurrency } from '../../lib/dateRanges';
import { StatusBadge, PlanBadge, fmtFullDate, fmtRelative } from './adminUi';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PLAN_OPTIONS = [
  { value: '', label: 'All plans' },
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'enterprise', label: 'Enterprise' },
];

export function AdminOrganizationsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [page, setPage] = useState(1);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin', 'orgs', { search, status, plan, page }],
    queryFn: () =>
      adminApi.organizations.list({
        search: search || undefined,
        status: status || undefined,
        plan: plan || undefined,
        page,
      }),
    placeholderData: keepPreviousData,
  });

  const orgs = data?.organizations ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-bold text-gray-900">Organizations</h1>
        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
          {total.toLocaleString()}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, slug, or email…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={plan}
          onChange={(e) => { setPlan(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {PLAN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left bg-gray-50/60">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Plan</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Trial Ends</th>
                <th className="px-3 py-3 font-medium text-right">Emp</th>
                <th className="px-3 py-3 font-medium text-right">Orders 30d</th>
                <th className="px-3 py-3 font-medium text-right">Rev 30d</th>
                <th className="px-3 py-3 font-medium">Last Order</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400">Loading organizations…</td></tr>
              ) : isError ? (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-danger">{(error as Error).message}</td></tr>
              ) : orgs.length === 0 ? (
                <tr><td colSpan={10} className="px-5 py-10 text-center text-gray-400">No organizations match your filters.</td></tr>
              ) : (
                orgs.map((o) => (
                  <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <Link to={`/admin/organizations/${o.id}`} className="font-medium text-gray-900 hover:text-primary">
                        {o.name}
                      </Link>
                      <div className="text-[11px] text-gray-400">{o.slug}</div>
                    </td>
                    <td className="px-3 py-3"><PlanBadge plan={o.plan} /></td>
                    <td className="px-3 py-3"><StatusBadge status={o.subscriptionStatus} /></td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {o.subscriptionStatus === 'trialing' ? fmtFullDate(o.trialEndsAt) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{o.employeeCount}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{o.orderCount30d}</td>
                    <td className="px-3 py-3 text-right font-semibold text-gray-800">{fmtCurrency(o.revenue30d)}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{fmtRelative(o.lastOrderAt)}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{fmtFullDate(o.createdAt)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Link to={`/admin/organizations/${o.id}`} className="text-primary hover:text-primary-dark text-xs font-medium">
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
          <span>
            Page {page} of {totalPages} · {total.toLocaleString()} total
            {isFetching && <span className="ml-2 text-gray-400">updating…</span>}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              <ChevronLeft size={13} /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
