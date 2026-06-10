/**
 * Admin Organization detail — /admin/organizations/:id
 *
 * Full customer profile across five tabs (Overview / Employees / Orders /
 * Audit Log / Settings). Edit + Settings require super_admin or support;
 * Impersonate requires super_admin.
 *
 * Impersonation: calls the backend for a short-lived (1h) ORG owner token, then
 * applies it to localStorage (the org app's auth keys) and opens the POS in a
 * new tab. We do NOT modify any org page — the app reads the token on load.
 */
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  KeyRound,
  Pencil,
  AlertTriangle,
  ExternalLink,
  X,
  Loader2,
} from 'lucide-react';
import { adminApi, type AdminOrgDetail } from '../../lib/adminApi';
import { useAdminAuthStore } from '../../store/adminAuth.store';
import { fmtCurrency } from '../../lib/dateRanges';
import { showToast } from '../../components/ui/Toast';
import { TOKEN_KEY, USER_KEY } from '../../lib/api';
import {
  StatusBadge,
  PlanBadge,
  fmtFullDate,
  fmtDateTime,
  fmtRelative,
} from './adminUi';

const INPUT_CLS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary';

type Tab = 'overview' | 'employees' | 'orders' | 'audit' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'employees', label: 'Employees' },
  { id: 'orders', label: 'Orders' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'settings', label: 'Settings' },
];

// Decode a JWT payload (base64url) without verifying — used only to seed the
// impersonated org session's role/locationIds for the org app's UI.
function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function AdminOrgDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const adminUser = useAdminAuthStore((s) => s.adminUser);
  const role = adminUser?.role;
  const canEdit = role === 'super_admin' || role === 'support';
  const canImpersonate = role === 'super_admin';

  const [tab, setTab] = useState<Tab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [impersonateOpen, setImpersonateOpen] = useState(false);

  const { data: org, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'org', id],
    queryFn: () => adminApi.organizations.get(id),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="p-8 text-gray-400">Loading organization…</div>;
  }
  if (isError || !org) {
    return (
      <div className="p-8">
        <Link to="/admin/organizations" className="text-sm text-primary flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Back to organizations
        </Link>
        <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-4 py-3">
          {(error as Error)?.message ?? 'Organization not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link to="/admin/organizations" className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> Back to organizations
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <PlanBadge plan={org.plan} />
            <StatusBadge status={org.subscriptionStatus} />
            <span className="text-xs text-gray-400">/{org.slug}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 border border-gray-200 hover:border-gray-300 bg-white rounded-lg px-3 py-2"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          {canImpersonate && (
            <button
              onClick={() => setImpersonateOpen(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-danger hover:opacity-90 rounded-lg px-3 py-2"
            >
              <KeyRound size={14} /> Impersonate
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-1">
          {TABS.map((t) => {
            if (t.id === 'settings' && !canEdit) return null;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === 'overview' && <OverviewTab org={org} />}
      {tab === 'employees' && <EmployeesTab org={org} />}
      {tab === 'orders' && <OrdersTab org={org} />}
      {tab === 'audit' && <AuditTab org={org} />}
      {tab === 'settings' && canEdit && (
        <SettingsTab org={org} onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'org', id] })} />
      )}

      {editOpen && (
        <EditModal
          org={org}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            void qc.invalidateQueries({ queryKey: ['admin', 'org', id] });
          }}
        />
      )}
      {impersonateOpen && (
        <ImpersonateModal org={org} onClose={() => setImpersonateOpen(false)} />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
function OverviewTab({ org }: { org: AdminOrgDetail }) {
  const avgTicket = org.totalOrders > 0 ? org.totalRevenue / org.totalOrders : 0;
  const lastLogin = org.employees
    .map((e) => e.lastLoginAt)
    .filter(Boolean)
    .sort()
    .pop() as string | undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Org details */}
        <Card title="Organization Details">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Name" value={org.name} />
            <Field label="Slug" value={org.slug} />
            <Field label="Billing Email" value={org.billingEmail ?? '—'} />
            <Field label="Plan" value={<PlanBadge plan={org.plan} />} />
            <Field label="Created" value={fmtFullDate(org.createdAt)} />
            <Field label="Subscription" value={<StatusBadge status={org.subscriptionStatus} />} />
            <Field
              label="Trial Ends"
              value={org.subscriptionStatus === 'trialing' ? fmtFullDate(org.trialEndsAt) : '—'}
            />
            <Field label="Stripe Connect" value={<span className="capitalize">{org.stripeConnectStatus.replace(/_/g, ' ')}</span>} />
          </dl>
        </Card>

        {/* Billing */}
        <Card title="Billing">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label="Subscription Plan" value={org.subscriptionPlan || org.plan} />
            <Field label="Status" value={<StatusBadge status={org.subscriptionStatus} />} />
          </dl>
          <a
            href="https://dashboard.stripe.com/customers"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-dark"
          >
            Manage in Stripe <ExternalLink size={12} />
          </a>
        </Card>

        {/* Recent orders */}
        <Card title="Recent Orders">
          {org.recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400">No orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
                  <th className="py-1.5 font-medium">Order #</th>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 font-medium text-right">Total</th>
                  <th className="py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {org.recentOrders.slice(0, 5).map((o) => (
                  <tr key={o.id} className="border-t border-gray-50">
                    <td className="py-2 font-medium text-gray-800">{o.orderNumber || o.id.slice(0, 8)}</td>
                    <td className="py-2 text-gray-500 text-xs">{fmtFullDate(o.createdAt)}</td>
                    <td className="py-2 text-right font-semibold text-gray-800">{fmtCurrency(o.total)}</td>
                    <td className="py-2 capitalize text-gray-600 text-xs">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Quick stats */}
      <div>
        <Card title="Quick Stats">
          <dl className="space-y-3 text-sm">
            <StatRow label="Total Orders" value={org.totalOrders.toLocaleString()} />
            <StatRow label="Total Revenue" value={fmtCurrency(org.totalRevenue)} />
            <StatRow label="Avg Ticket" value={fmtCurrency(avgTicket)} />
            <StatRow label="Customers" value={org.customerCount.toLocaleString()} />
            <StatRow label="Products" value={org.productCount.toLocaleString()} />
            <StatRow label="Employees" value={org.employees.filter((e) => !e.deletedAt).length.toLocaleString()} />
            <StatRow label="Last Order" value={fmtRelative(org.lastOrderAt)} />
            <StatRow label="Last Login" value={fmtRelative(lastLogin)} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

// ── Employees ───────────────────────────────────────────────────────────────
function EmployeesTab({ org }: { org: AdminOrgDetail }) {
  return (
    <Card title={`Employees (${org.employees.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Last Login</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {org.employees.map((e) => (
              <tr key={e.id} className="border-t border-gray-50">
                <td className="py-2.5 font-medium text-gray-800">
                  {`${e.firstName} ${e.lastName}`.trim() || '—'}
                </td>
                <td className="py-2.5 text-gray-600">{e.email}</td>
                <td className="py-2.5 capitalize text-gray-600">{e.role}</td>
                <td className="py-2.5 text-gray-500 text-xs">{fmtRelative(e.lastLoginAt)}</td>
                <td className="py-2.5">
                  {e.deletedAt ? (
                    <span className="text-xs font-medium text-red-600">Deactivated</span>
                  ) : (
                    <span className="text-xs font-medium text-green-600">Active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3">
        Password reset and deactivate actions are not yet exposed by the admin API — manage these from
        the customer’s own Employees settings or escalate to engineering.
      </p>
    </Card>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────
function OrdersTab({ org }: { org: AdminOrgDetail }) {
  const [q, setQ] = useState('');
  const filtered = org.recentOrders.filter(
    (o) =>
      !q ||
      o.orderNumber.toLowerCase().includes(q.toLowerCase()) ||
      o.status.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Card title="Orders">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search order # or status…"
        className="mb-4 w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">No matching orders.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left">
              <th className="py-2 font-medium">Order #</th>
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium text-right">Total</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id} className="border-t border-gray-50">
                <td className="py-2.5 font-medium text-gray-800">{o.orderNumber || o.id.slice(0, 8)}</td>
                <td className="py-2.5 text-gray-500 text-xs">{fmtDateTime(o.createdAt)}</td>
                <td className="py-2.5 text-right font-semibold text-gray-800">{fmtCurrency(o.total)}</td>
                <td className="py-2.5 capitalize text-gray-600 text-xs">{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-gray-400 mt-3">
        Showing the {org.recentOrders.length} most recent orders returned by the admin API.
      </p>
    </Card>
  );
}

// ── Audit log ───────────────────────────────────────────────────────────────
function AuditTab({ org }: { org: AdminOrgDetail }) {
  return (
    <Card title="Audit Log">
      {org.auditLog.length === 0 ? (
        <p className="text-sm text-gray-400">No audit events recorded.</p>
      ) : (
        <div className="space-y-2">
          {org.auditLog.map((a, i) => (
            <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="mt-1 w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 font-medium">{a.action}</div>
                <div className="text-[11px] text-gray-400">
                  {a.resourceType ?? 'system'}
                  {a.actorId ? ` · actor ${a.actorId.slice(0, 8)}` : ''}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDateTime(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3">Showing the 50 most recent events.</p>
    </Card>
  );
}

// ── Settings tab (inline edit form) ─────────────────────────────────────────
function SettingsTab({ org, onSaved }: { org: AdminOrgDetail; onSaved: () => void }) {
  return (
    <div className="max-w-xl">
      <Card title="Organization Settings">
        <OrgEditForm org={org} onSaved={onSaved} layout="stacked" />
      </Card>
    </div>
  );
}

// ── Edit modal ──────────────────────────────────────────────────────────────
function EditModal({
  org,
  onClose,
  onSaved,
}: {
  org: AdminOrgDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit Organization</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <OrgEditForm org={org} onSaved={onSaved} layout="stacked" />
      </div>
    </div>
  );
}

const PLAN_VALUES = ['trial', 'starter', 'growth', 'enterprise'];
const STATUS_VALUES = ['trialing', 'active', 'past_due', 'cancelled', 'unpaid'];

function OrgEditForm({
  org,
  onSaved,
  layout,
}: {
  org: AdminOrgDetail;
  onSaved: () => void;
  layout: 'stacked';
}) {
  const [name, setName] = useState(org.name);
  const [billingEmail, setBillingEmail] = useState(org.billingEmail ?? '');
  const [plan, setPlan] = useState(org.plan);
  const [subscriptionStatus, setSubscriptionStatus] = useState(org.subscriptionStatus);
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.organizations.update(org.id, {
        name,
        billingEmail: billingEmail || undefined,
        plan,
        subscriptionStatus,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      showToast.success('Organization updated');
      onSaved();
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Update failed'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className={layout === 'stacked' ? 'space-y-4' : ''}
    >
      <FormField label="Organization name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT_CLS}
        />
      </FormField>
      <FormField label="Billing email">
        <input
          type="email"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
          className={INPUT_CLS}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Plan">
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className={INPUT_CLS}>
            {PLAN_VALUES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </FormField>
        <FormField label="Subscription status">
          <select
            value={subscriptionStatus}
            onChange={(e) => setSubscriptionStatus(e.target.value)}
            className={INPUT_CLS}
          >
            {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Internal notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Recorded to the org audit log…"
          className={`${INPUT_CLS} resize-none`}
        />
      </FormField>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg"
      >
        {mutation.isPending && <Loader2 size={15} className="animate-spin" />}
        Save changes
      </button>
    </form>
  );
}

// ── Impersonation modal ─────────────────────────────────────────────────────
function ImpersonateModal({ org, onClose }: { org: AdminOrgDetail; onClose: () => void }) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => adminApi.organizations.impersonate(org.id, reason.trim()),
    onSuccess: ({ impersonationToken }) => {
      const claims = decodeJwt(impersonationToken);
      // Apply the org token to the org app's auth keys, then open the POS.
      localStorage.setItem(TOKEN_KEY, impersonationToken);
      localStorage.setItem(
        USER_KEY,
        JSON.stringify({
          firstName: 'Impersonated',
          lastName: `(${org.name})`,
          role: (claims.role as string) ?? 'owner',
          locationIds: (claims.locationIds as string[]) ?? [],
        }),
      );
      showToast.success('Impersonation session started');
      window.open('/', '_blank', 'noopener');
      onClose();
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Impersonation failed'),
  });

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full bg-danger/10 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-danger" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Impersonate {org.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              You are about to access this customer’s account with owner-level
              permissions. This action is logged and audited.
            </p>
          </div>
        </div>

        <FormField label="Reason (required)">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Investigating import failure ticket #1234"
            className={INPUT_CLS}
            autoFocus
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!reason.trim() || mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-danger hover:opacity-90 disabled:opacity-50 rounded-lg"
          >
            {mutation.isPending && <Loader2 size={15} className="animate-spin" />}
            I understand — Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small presentational bits ───────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-gray-800 mt-0.5">{value}</dd>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-semibold text-gray-800">{value}</dd>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
