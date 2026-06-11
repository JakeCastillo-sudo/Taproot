/**
 * Admin / Executive portal API client — Taproot internal team only.
 *
 * This client is DELIBERATELY separate from the org-scoped `api.ts`:
 *   - its own bearer token (`taproot_admin_token`, NOT `taproot_token`)
 *   - its own 401 handler → bounces to /admin/login (never the org /login)
 *   - no shared state with the org auth flow
 *
 * Base URL mirrors the app convention (`api.ts`): in dev `VITE_API_URL` is an
 * empty string → relative URL → Vite proxy → localhost:3001; in production
 * `.env.production` sets it to the live Railway host. (See SESSION_GUIDELINES.)
 *
 * ── Shape normalization ───────────────────────────────────────────────────
 * The backend admin endpoints return RAW Postgres rows (snake_case) and pg
 * serializes COUNT/SUM/AVG as strings. The UI consumes clean camelCase numbers,
 * so every read method below normalizes its payload. Money values stay in CENTS
 * (the whole app stores order totals in cents — format with `fmtCurrency`).
 */

const ADMIN_API_BASE = import.meta.env.VITE_API_URL ?? '';

export const ADMIN_TOKEN_KEY = 'taproot_admin_token';
export const ADMIN_USER_KEY = 'taproot_admin_user';
/** zustand persist key for the admin auth store (see store/adminAuth.store.ts). */
export const ADMIN_PERSIST_KEY = 'taproot-admin-auth';

function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // A 401 from the login endpoint means "wrong credentials", NOT "session
  // expired" — let it fall through so the real server message surfaces on the
  // login form. Only treat 401s on AUTHENTICATED routes as an expired session.
  const isLoginCall = path.includes('/admin/auth/login');
  if (response.status === 401 && !isLoginCall) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
    // Also clear the zustand-persisted blob so a full reload rehydrates to a
    // logged-out state — otherwise the store keeps `isAdminAuthenticated: true`
    // with a dead token and bounces through "session expired" on every visit.
    localStorage.removeItem(ADMIN_PERSIST_KEY);
    // Hard redirect to the SEPARATE admin login — never the org /login.
    if (!window.location.pathname.startsWith('/admin/login')) {
      window.location.href = '/admin/login';
    }
    throw new Error('Admin session expired');
  }

  // 204 / empty body guard.
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? 'Admin API error');
  }

  return data as T;
}

// ── Numeric coercion helpers (pg returns COUNT/SUM/AVG as strings) ──────────
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'support' | 'read_only';
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  trialEndsAt: string | null;
  billingEmail: string | null;
  stripeConnectStatus: string;
  createdAt: string;
  employeeCount: number;
  orderCount30d: number;
  /** cents */
  revenue30d: number;
  lastOrderAt: string | null;
}

export interface AdminOrgEmployee {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string | null;
  deletedAt: string | null;
}

export interface AdminOrgOrder {
  id: string;
  orderNumber: string;
  status: string;
  /** cents */
  total: number;
  createdAt: string;
}

export interface AdminAuditEntry {
  action: string;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminOrgDetail extends AdminOrg {
  /** cents */
  totalRevenue: number;
  totalOrders: number;
  productCount: number;
  customerCount: number;
  employees: AdminOrgEmployee[];
  recentOrders: AdminOrgOrder[];
  auditLog: AdminAuditEntry[];
}

export interface PlatformMetrics {
  organizations: {
    total: number;
    active: number;
    trialing: number;
    churned: number;
    new30d: number;
  };
  revenue: {
    /** cents — completed-order volume last 30d (a GMV proxy, NOT Taproot revenue) */
    mrrProxy: number;
    /** cents */
    revenue7d: number;
    orders30d: number;
  };
  orders: {
    totalOrders: number;
    /** cents */
    avgOrderValue: number;
    activeOrgs: number;
  };
  users: {
    total: number;
  };
}

export interface HelpdeskResponse {
  answer: string;
  escalationTier?: 1 | 2 | 3;
  suggestedActions?: string[];
  relatedDocs?: string[];
}

export interface HelpdeskMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface HelpdeskTicket {
  id: string;
  organization_id: string | null;
  org_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  channel: string | null;
  message_count: string | number;
  created_at: string;
  updated_at: string;
}

// ── Normalizers ───────────────────────────────────────────────────────────

function normalizeOrg(r: Record<string, unknown>): AdminOrg {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    plan: String(r.plan ?? ''),
    subscriptionStatus: str(r.subscription_status) ?? 'trialing',
    subscriptionPlan: str(r.subscription_plan) ?? '',
    trialEndsAt: str(r.trial_ends_at),
    billingEmail: str(r.billing_email),
    stripeConnectStatus: str(r.stripe_connect_status) ?? 'not_connected',
    createdAt: String(r.created_at),
    employeeCount: num(r.employee_count),
    orderCount30d: num(r.order_count_30d),
    revenue30d: num(r.revenue_30d),
    lastOrderAt: str(r.last_order_at),
  };
}

function normalizeOrgDetail(r: Record<string, unknown>): AdminOrgDetail {
  const base = normalizeOrg(r);
  return {
    ...base,
    totalRevenue: num(r.total_revenue),
    totalOrders: num(r.total_orders),
    productCount: num(r.product_count),
    customerCount: num(r.customer_count),
    employees: ((r.employees as Record<string, unknown>[]) ?? []).map((e) => ({
      id: String(e.id),
      email: String(e.email ?? ''),
      firstName: String(e.first_name ?? ''),
      lastName: String(e.last_name ?? ''),
      role: String(e.role ?? ''),
      lastLoginAt: str(e.last_login_at),
      createdAt: str(e.created_at),
      deletedAt: str(e.deleted_at),
    })),
    recentOrders: ((r.recentOrders as Record<string, unknown>[]) ?? []).map((o) => ({
      id: String(o.id),
      orderNumber: String(o.order_number ?? ''),
      status: String(o.status ?? ''),
      total: num(o.total),
      createdAt: String(o.created_at),
    })),
    auditLog: ((r.auditLog as Record<string, unknown>[]) ?? []).map((a) => ({
      action: String(a.action ?? ''),
      actorId: str(a.actor_id),
      resourceType: str(a.resource_type),
      resourceId: str(a.resource_id),
      createdAt: String(a.created_at),
      metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    })),
  };
}

function normalizeMetrics(r: {
  organizations: Record<string, unknown>;
  revenue: Record<string, unknown>;
  orders: Record<string, unknown>;
  users: Record<string, unknown>;
}): PlatformMetrics {
  return {
    organizations: {
      total: num(r.organizations?.total),
      active: num(r.organizations?.active),
      trialing: num(r.organizations?.trialing),
      churned: num(r.organizations?.churned),
      new30d: num(r.organizations?.new_30d),
    },
    revenue: {
      mrrProxy: num(r.revenue?.mrr_proxy),
      revenue7d: num(r.revenue?.revenue_7d),
      orders30d: num(r.revenue?.orders_30d),
    },
    orders: {
      totalOrders: num(r.orders?.total_orders),
      avgOrderValue: num(r.orders?.avg_order_value),
      activeOrgs: num(r.orders?.active_orgs),
    },
    users: {
      total: num(r.users?.total),
    },
  };
}

// ── API methods ───────────────────────────────────────────────────────────

export const adminApi = {
  auth: {
    login: (email: string, password: string) =>
      adminFetch<{ accessToken: string; admin: AdminUser }>(
        '/api/v1/admin/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
      ),
    logout: () =>
      adminFetch<{ success: boolean }>('/api/v1/admin/auth/logout', {
        method: 'POST',
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      adminFetch<{ success: boolean; message?: string }>(
        '/api/v1/admin/auth/change-password',
        { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
      ),
  },

  organizations: {
    list: async (params?: {
      search?: string;
      status?: string;
      plan?: string;
      page?: number;
    }): Promise<{ organizations: AdminOrg[]; total: number; page: number; limit: number }> => {
      const q = new URLSearchParams();
      if (params?.search) q.set('search', params.search);
      if (params?.status) q.set('status', params.status);
      if (params?.plan) q.set('plan', params.plan);
      if (params?.page) q.set('page', String(params.page));
      const raw = await adminFetch<{
        organizations: Record<string, unknown>[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/v1/admin/organizations?${q.toString()}`);
      return {
        organizations: (raw.organizations ?? []).map(normalizeOrg),
        total: num(raw.total),
        page: num(raw.page) || 1,
        limit: num(raw.limit) || 50,
      };
    },

    get: async (id: string): Promise<AdminOrgDetail> => {
      const raw = await adminFetch<Record<string, unknown>>(
        `/api/v1/admin/organizations/${id}`,
      );
      return normalizeOrgDetail(raw);
    },

    update: (
      id: string,
      updates: {
        name?: string;
        plan?: string;
        subscriptionStatus?: string;
        billingEmail?: string;
        notes?: string;
      },
    ) =>
      adminFetch<{ success: boolean }>(`/api/v1/admin/organizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }),

    impersonate: (id: string, reason: string) =>
      adminFetch<{ impersonationToken: string; expiresIn: number; warning: string }>(
        `/api/v1/admin/organizations/${id}/impersonate`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
  },

  metrics: {
    get: async (): Promise<PlatformMetrics> => {
      const raw = await adminFetch<{
        organizations: Record<string, unknown>;
        revenue: Record<string, unknown>;
        orders: Record<string, unknown>;
        users: Record<string, unknown>;
      }>('/api/v1/admin/metrics');
      return normalizeMetrics(raw);
    },
  },

  helpdesk: {
    query: (params: {
      query: string;
      orgId?: string;
      history?: HelpdeskMessage[];
    }) =>
      adminFetch<HelpdeskResponse>('/api/v1/admin/helpdesk/query', {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    getTickets: (status?: string) => {
      const q = status ? `?status=${encodeURIComponent(status)}` : '';
      return adminFetch<HelpdeskTicket[]>(`/api/v1/admin/helpdesk/tickets${q}`);
    },
  },
};
