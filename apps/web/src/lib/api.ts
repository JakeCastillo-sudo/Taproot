/**
 * Taproot API Client
 *
 * - Base URL from VITE_API_URL env (empty = use Vite proxy)
 * - Auto-attaches JWT access token from localStorage
 * - Auto-refreshes on 401, retries once
 * - All responses typed with @taproot/shared types
 */

import type {
  Product, ProductVariant, Category,
  Order, OrderStatus,
  Customer,
} from '@taproot/shared';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

// ─── Token management ─────────────────────────────────────────────────────────

export const TOKEN_KEY         = 'taproot_token';
export const REFRESH_TOKEN_KEY = 'taproot_refresh_token';
export const USER_KEY          = 'taproot_user';

export function getToken(): string | null         { return localStorage.getItem(TOKEN_KEY); }
export function getRefreshToken(): string | null  { return localStorage.getItem(REFRESH_TOKEN_KEY); }

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ─── Token refresh (deduplicated) ─────────────────────────────────────────────

let _refreshPromise: Promise<string | null> | null = null;

async function _doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) { clearTokens(); return null; }
    const data = await res.json() as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

function refreshTokens(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = _doRefresh().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Public routes that should never be hard-redirected away from on auth failure
const PUBLIC_PATHS = new Set(['/login', '/register', '/accept-invite', '/privacy', '/terms']);

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  _retry = true,
  options: { noRedirect?: boolean } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    // Only send Content-Type when there's a body. Fastify's JSON parser rejects an
    // empty body when Content-Type is application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
    // which broke body-less DELETE/POST requests. BUG-ING-001.
    ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    'X-Taproot-Client':  'web',  // CSRF indicator — signals request originated from the SPA
    ...(init.headers as Record<string, string> | undefined),
  };
  // Never log tokens to console — attach silently
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    // Network error — retry once
    if (_retry) return apiFetch<T>(path, init, false, options);
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }

  if (res.status === 401 && _retry) {
    const newToken = await refreshTokens();
    if (newToken) return apiFetch<T>(path, init, false, options);
    clearTokens();
    // Guard: don't redirect to /login from public pages or optional callers (e.g. TrialBanner)
    if (!options.noRedirect && !PUBLIC_PATHS.has(window.location.pathname)) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }

  if (!res.ok) {
    let body: { code?: string; message?: string; details?: unknown } = {};
    try { body = await res.json(); } catch { /* empty */ }
    throw new ApiError(
      res.status,
      body.code ?? 'API_ERROR',
      body.message ?? `HTTP ${res.status}`,
      body.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  requiresMfa?: boolean;
  employee: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    orgId: string;
    locationIds: string[];
    permissions: string[];
  };
}

/** A single modifier option as returned by the products API. */
export interface ModifierOptionData {
  id:         string;
  name:       string;
  priceDelta: number;  // cents, may be negative
  isDefault:  boolean;
  sortOrder:  number;
}

/** A modifier group attached to a product. */
export interface ModifierGroupData {
  id:            string;
  name:          string;
  selectionType: 'single' | 'multiple' | 'required_single' | 'required_multiple';
  minSelections: number;
  maxSelections: number | null;
  sortOrder:     number;
  modifiers:     ModifierOptionData[];
}

/** Product as returned by GET /api/v1/products — includes modifier groups. */
export type ProductWithModifiers = Product & {
  variants?:       ProductVariant[];
  defaultPrice?:   number;
  day_parts?:      string[] | null;
  /** Ingredient-system feature flag (migration 028). Default false / undefined. */
  recipe_mode?:    boolean;
  modifierGroups:  ModifierGroupData[];
};

/** Body for creating a product via the Products settings page. */
export interface CreateProductBody {
  name:            string;
  description?:    string;
  categoryId?:     string | null;
  price:           number;        // cents
  sku?:            string;
  barcode?:        string;
  trackInventory?: boolean;
  isActive?:       boolean;
  dayParts?:       string[] | null;
  locationId:      string;
}

export interface ProductListResponse {
  products: ProductWithModifiers[];
  total: number;
  page: number;
  perPage: number;
}

/** Category enriched with active product count (from GET /categories). */
export interface CategoryWithCount {
  id:            string;
  name:          string;
  color:         string | null;
  icon:          string | null;
  sort_order:    number;
  product_count: number;
}

export interface CategoryListResponse {
  categories: CategoryWithCount[];
}

export interface OrderCreateBody {
  locationId: string;
  customerId?: string | null;
  tableId?: string | null;
  orderType?: string;
  items: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitPrice: number;
    notes?: string;
    modifiers?: Array<{ modifierId: string; name?: string; priceDelta: number }>;
  }>;
  discountIds?: string[];
  discountCodes?: string[];
  notes?: string;
}

export interface PaymentBody {
  paymentMethod: string;
  amount: number;
  tipAmount?: number;
  giftCardCode?: string;
  cashTendered?: number;
}

export interface CustomerSearchResponse {
  customers: Customer[];
}

export interface ActiveDiscount {
  id: string;
  name: string;
  code: string | null;
  discountType: string;
  discountValue: number;
  minimumOrderAmount: number | null;
  maximumDiscountAmount: number | null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      // No x-organization-slug — backend resolves org from email
      body: JSON.stringify({ email, password }),
    }),

  logout: () => {
    clearTokens();
    window.location.href = '/login';
  },

  refresh: () =>
    apiFetch<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: getRefreshToken() }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ success: boolean }>('/auth/password/change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /** Switch the active employee on this device via PIN (device already authenticated). */
  pinLogin: (employeeId: string, pin: string, locationId?: string) =>
    apiFetch<LoginResponse>('/auth/pin-login', {
      method: 'POST',
      body: JSON.stringify({ employeeId, pin, locationId }),
    }),
};

// ─── Employees & locations ────────────────────────────────────────────────────

export interface EmployeeListRow {
  id:            string;
  first_name:    string;
  last_name:     string;
  email:         string;
  role:          string;
  location_ids:  string[] | null;
  hourly_rate:   number | null;
  has_pin:       boolean;
  last_login_at: string | null;
  created_at:    string;
}

export interface EmployeeInput {
  firstName:    string;
  lastName:     string;
  email:        string;
  role:         string;
  pin?:         string;
  locationIds?: string[];
  hourlyRate?:  number | null;
}

export interface SelectableEmployee {
  id:         string;
  first_name: string;
  last_name:  string;
  role:       string;
}

export const employees = {
  list: () => apiFetch<{ employees: EmployeeListRow[] }>('/employees').then((r) => r.employees),

  /** Minimal list for the PIN lock screen (PIN-enabled staff only). */
  selectable: () => apiFetch<{ employees: SelectableEmployee[] }>('/employees/selectable').then((r) => r.employees),

  create: (body: EmployeeInput) =>
    apiFetch<{ id: string }>('/employees', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<EmployeeInput>) =>
    apiFetch<{ success: boolean }>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) =>
    apiFetch<void>(`/employees/${id}`, { method: 'DELETE' }),

  resetPin: (id: string, newPin: string) =>
    apiFetch<{ success: boolean }>(`/employees/${id}/reset-pin`, {
      method: 'POST', body: JSON.stringify({ newPin }),
    }),
};

export interface CashDrop { id: string; amount: number; reason: string | null; created_at: string }

export interface CashDrawerSession {
  id: string; location_id: string; employee_id: string; employee_name: string;
  opened_at: string; closed_at: string | null;
  opening_amount: number; expected_amount: number | null;
  actual_amount: number | null; discrepancy: number | null; notes: string | null;
  cash_sales: number; cash_refunds: number; drops_total: number;
  drops: CashDrop[];
}

export const cashDrawer = {
  current: () => apiFetch<{ session: CashDrawerSession | null }>('/cash-drawer/current').then((r) => r.session),
  history: () => apiFetch<{ sessions: CashDrawerSession[] }>('/cash-drawer/history').then((r) => r.sessions),
  open: (openingAmount: number) =>
    apiFetch<{ id: string }>('/cash-drawer/open', { method: 'POST', body: JSON.stringify({ openingAmount }) }),
  drop: (amount: number, reason?: string) =>
    apiFetch<{ id: string }>('/cash-drawer/drop', { method: 'POST', body: JSON.stringify({ amount, reason }) }),
  close: (actualAmount: number, notes?: string) =>
    apiFetch<{ session: CashDrawerSession }>('/cash-drawer/close', { method: 'POST', body: JSON.stringify({ actualAmount, notes }) }),
};

export interface LocationRow {
  id:       string;
  name:     string;
  timezone: string;
  currency: string;
  address?: Record<string, unknown>;
  phone?:   string | null;
  is_active?: boolean;
}

export interface LocationInput {
  name: string; address?: Record<string, unknown>; phone?: string;
  timezone?: string; currency?: string;
}

export const integrations = {
  /** Fetch an accounting CSV (auth header) as text for client-side download. */
  exportCsv: async (provider: 'quickbooks' | 'xero', from: string, to: string): Promise<string> => {
    const token = getToken();
    const q = new URLSearchParams({ from, to, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const res = await fetch(`${BASE}/integrations/export/${provider}?${q.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'EXPORT_ERROR', `Export failed (HTTP ${res.status})`);
    return res.text();
  },
};

export const locations = {
  list: () => apiFetch<{ locations: LocationRow[] }>('/locations').then((r) => r.locations),
  create: (body: LocationInput) => apiFetch<LocationRow>('/locations', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<LocationInput> & { isActive?: boolean }) =>
    apiFetch<LocationRow>(`/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => apiFetch<void>(`/locations/${id}`, { method: 'DELETE' }),
};

// ─── Franchise (S8-01) ────────────────────────────────────────────────────────

export type OrgType = 'independent' | 'franchisor' | 'franchisee';

export interface FranchiseInfo {
  ready: boolean;
  orgType: OrgType;
  franchiseCode: string | null;
  parentOrg: { id: string; name: string } | null;
}

export interface NetworkLocation {
  id: string; name: string; slug: string;
  location_count: number;
  revenue_30d: number;        // cents
  order_count_30d: number;
  joined_at: string;
  status: 'active' | 'inactive';
}

export interface CorporateMenuItem {
  id: string; name: string; description: string | null;
  price: number | null;       // cents
  category_name: string | null;
  corporate_source_id: string | null;
  is_corporate: boolean;
}

export interface MenuPushResult {
  franchisees: number; created: number; updated: number; errors: string[];
}

export const franchise = {
  info: () => apiFetch<FranchiseInfo>('/franchise/info'),
  enable: () => apiFetch<{ franchiseCode: string }>('/franchise/enable', { method: 'POST' }),
  network: () => apiFetch<{ locations: NetworkLocation[] }>('/franchise/network'),
  invite: (email: string, locationName: string) =>
    apiFetch<{ sent: boolean; franchiseCode: string }>('/franchise/invite', {
      method: 'POST', body: JSON.stringify({ email, locationName }),
    }),
  join: (franchiseCode: string) =>
    apiFetch<FranchiseInfo>('/franchise/join', {
      method: 'POST', body: JSON.stringify({ franchiseCode }),
    }),
  menu: () => apiFetch<{ orgType: OrgType; items: CorporateMenuItem[] }>('/franchise/menu'),
  pushMenu: (productIds: string[]) =>
    apiFetch<MenuPushResult>('/franchise/menu/push', {
      method: 'PATCH', body: JSON.stringify({ productIds }),
    }),
};

// ─── Gift cards ───────────────────────────────────────────────────────────────

export interface GiftCardRow {
  id: string; code: string; initial_balance: number; current_balance: number;
  currency: string; issued_to_customer_id: string | null; expires_at: string | null;
  is_active: boolean; created_at: string;
}

export const giftCards = {
  list: (params?: { isActive?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.isActive !== undefined) q.set('is_active', String(params.isActive));
    if (params?.page) q.set('page', String(params.page));
    const qs = q.toString();
    return apiFetch<{ cards: GiftCardRow[]; total: number }>(`/gift-cards${qs ? `?${qs}` : ''}`);
  },
  lookup: (code: string) => apiFetch<GiftCardRow>(`/gift-cards/lookup?code=${encodeURIComponent(code)}`),
  issue: (body: { initialBalance: number; issuedToCustomerId?: string; expiresAt?: string; notes?: string }) =>
    apiFetch<GiftCardRow>('/gift-cards', { method: 'POST', body: JSON.stringify(body) }),
  reload: (id: string, amount: number) =>
    apiFetch<GiftCardRow>(`/gift-cards/${id}/reload`, { method: 'POST', body: JSON.stringify({ amount }) }),
  deactivate: (id: string, reason?: string) =>
    apiFetch<{ success?: boolean }>(`/gift-cards/${id}/deactivate`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

// ─── Reservations / waitlist ──────────────────────────────────────────────────

export type ReservationType = 'reservation' | 'waitlist';

export interface ReservationRow {
  id: string; customer_name: string; party_size: number;
  phone: string | null; email: string | null; type: ReservationType;
  reserved_for: string | null; table_id: string | null; table_name: string | null;
  status: string; notes: string | null; notified_at: string | null; created_at: string;
}

export interface ReservationInput {
  customerName: string; partySize?: number; phone?: string; email?: string;
  type?: ReservationType; reservedFor?: string | null; notes?: string;
}

export const reservations = {
  list: (params?: { date?: string; type?: ReservationType }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    if (params?.type) q.set('type', params.type);
    const qs = q.toString();
    return apiFetch<{ reservations: ReservationRow[] }>(`/reservations${qs ? `?${qs}` : ''}`).then((r) => r.reservations);
  },
  create: (body: ReservationInput) => apiFetch<ReservationRow>('/reservations', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<ReservationInput> & { status?: string; tableId?: string | null }) =>
    apiFetch<ReservationRow>(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => apiFetch<void>(`/reservations/${id}`, { method: 'DELETE' }),
  notify: (id: string) => apiFetch<{ sent: boolean; channel: string }>(`/reservations/${id}/notify`, { method: 'POST' }),
  seat: (id: string, tableId: string | null) =>
    apiFetch<ReservationRow>(`/reservations/${id}/seat`, { method: 'POST', body: JSON.stringify({ tableId }) }),
};

// ─── Tables / floor plan ──────────────────────────────────────────────────────

export type TableShape = 'rectangle' | 'circle' | 'square';

export interface TableRow {
  id: string; location_id: string; name: string; section: string | null;
  seats: number; position_x: number; position_y: number;
  shape: TableShape; width: number; height: number; is_active: boolean;
}

export interface TableInput {
  name: string; section?: string | null; seats?: number;
  positionX?: number; positionY?: number; shape?: TableShape;
  width?: number; height?: number; isActive?: boolean;
}

export const tables = {
  list: (locationId?: string) => {
    const q = locationId ? `?locationId=${locationId}` : '';
    return apiFetch<{ tables: TableRow[] }>(`/tables${q}`).then((r) => r.tables);
  },
  create: (body: TableInput & { locationId?: string }) =>
    apiFetch<TableRow>('/tables', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<TableInput>) =>
    apiFetch<TableRow>(`/tables/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) =>
    apiFetch<void>(`/tables/${id}`, { method: 'DELETE' }),
  bulkPositions: (positions: Array<{ id: string; positionX: number; positionY: number; width?: number; height?: number }>) =>
    apiFetch<{ success: boolean }>('/tables/bulk-positions', { method: 'PATCH', body: JSON.stringify({ positions }) }),

  status: (locationId?: string) => {
    const q = locationId ? `?locationId=${locationId}` : '';
    return apiFetch<{ tables: TableStatus[] }>(`/tables/status${q}`).then((r) => r.tables);
  },
  assignOrder: (orderId: string, tableId: string | null) =>
    apiFetch<{ success: boolean }>(`/orders/${orderId}/table`, { method: 'PATCH', body: JSON.stringify({ tableId }) }),
};

export interface KitchenItem {
  id: string; name: string; quantity: number;
  modifiers: Array<{ name: string }>; specialInstructions: string | null;
  ready: boolean; station: string;
}
export interface KitchenTicket {
  id: string; orderNumber: string; tableId: string | null; tableName: string | null;
  orderType: string; createdAt: string; minutesOpen: number; items: KitchenItem[];
}

export const kitchen = {
  tickets: (locationId?: string) => {
    const q = locationId ? `?locationId=${locationId}` : '';
    return apiFetch<{ orders: KitchenTicket[] }>(`/kitchen/tickets${q}`).then((r) => r.orders);
  },
  itemReady: (itemId: string) =>
    apiFetch<{ success: boolean }>(`/kitchen/items/${itemId}/ready`, { method: 'PATCH' }),
  bump: (orderId: string) =>
    apiFetch<{ success: boolean }>(`/kitchen/orders/${orderId}/bump`, { method: 'PATCH' }),
};

// ─── Wait time (FEAT-WAIT-001) ──────────────────────────────────────────────────

export interface WaitTimeResult {
  estimatedMinutes: number;
  estimatedMinutesRaw: number;
  confidence: 'high' | 'medium' | 'low';
  queueDepth: number;
  queueItemCount: number;
  avgItemMinutes: number;
  rushMode: boolean;
  rushExtraMinutes: number;
  dataPoints: number;
  displayText: string;
  lastUpdated: string;
}

export interface WaitTimeConfig {
  enabled: boolean;
  basePrepMinutes: number;
  minutesPerItem: number;
  rushMode: boolean;
  rushExtraMinutes: number;
  rushModeExpiresAt: string | null;
  maxWaitMinutes: number;
  showOnPublicMenu: boolean;
  autoPauseEnabled: boolean;
  autoPauseThreshold: number;
}

export interface WaitAccuracyDay { date: string; actualAvgMinutes: number; orders: number }

export const waitTime = {
  get: (locationId: string) =>
    apiFetch<WaitTimeResult>(`/locations/${locationId}/wait-time`),
  getConfig: (locationId: string) =>
    apiFetch<WaitTimeConfig>(`/locations/${locationId}/wait-time/config`),
  saveConfig: (locationId: string, cfg: Partial<WaitTimeConfig>) =>
    apiFetch<{ success: boolean }>(`/locations/${locationId}/wait-time/config`, { method: 'PUT', body: JSON.stringify(cfg) }),
  setRush: (locationId: string, body: { enabled: boolean; extraMinutes?: number; durationMinutes?: number }) =>
    apiFetch<{ success: boolean; rushMode: boolean }>(`/locations/${locationId}/wait-time/rush`, { method: 'POST', body: JSON.stringify(body) }),
  accuracy: (locationId: string) =>
    apiFetch<{ history: WaitAccuracyDay[] }>(`/locations/${locationId}/wait-time/accuracy`).then((r) => r.history),
};

export interface TableStatus extends TableRow {
  currentOrder: {
    id: string; orderNumber: string; status: string;
    itemCount: number; total: number; openedAt: string; minutesOpen: number;
  } | null;
}

// ─── Recipe-aware POS modifiers (FEAT ingredients, recipe_mode products) ───────

export interface POSModifierOptionData {
  id:           string;
  name:         string;       // already prefixed: "No X" / "Extra X" / "Add X"
  priceDelta:   number;       // cents
  isDefault:    boolean;
  sortOrder:    number;
  modifierType?: string;      // 'omission' | 'extra' | 'add_on' | 'custom'
  ingredientId?: string | null;
  ingredientQty?: number | null;
}

export interface POSModifierGroupData {
  id:            string;
  name:          string;
  selectionType: 'single' | 'multiple' | 'required_single' | 'required_multiple';
  minSelections: number;
  maxSelections: number | null;
  sortOrder:     number;
  groupType:     string;      // 'omissions' | 'extras' | 'add_ons' | 'custom'
  isAutoGenerated: boolean;
  modifiers:     POSModifierOptionData[];
}

export interface POSModifierResponse {
  recipeMode: boolean;
  groups:     POSModifierGroupData[];
}

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = {
  list: async (params?: {
    categoryId?: string;
    search?: string;
    isActive?: boolean;
    page?: number;
    perPage?: number;
    /** Additive day-part filter. Omit or 'all' to show everything. */
    dayPart?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set('categoryId', params.categoryId);
    if (params?.search)     q.set('search', params.search);
    if (params?.isActive !== undefined) q.set('isActive', String(params.isActive));
    if (params?.page)    q.set('page',    String(params.page));
    if (params?.perPage) q.set('perPage', String(params.perPage));
    if (params?.dayPart && params.dayPart !== 'all') q.set('dayPart', params.dayPart);
    const qs = q.toString();

    // API returns prices[] per product; extract the lowest as defaultPrice (cents)
    const raw = await apiFetch<{
      products: (Product & {
        variants?:      ProductVariant[];
        prices?:        Array<{ price: number }>;
        recipe_mode?:   boolean;
        modifierGroups: ModifierGroupData[];
      })[];
      total: number;
      page: number;
    }>(`/products${qs ? `?${qs}` : ''}`);

    return {
      products: raw.products.map((p) => ({
        ...p,
        defaultPrice:   p.prices?.length
          ? Math.min(...p.prices.map((pp) => Number(pp.price)))
          : 0,
        modifierGroups: p.modifierGroups ?? [],
      })),
      total:   raw.total,
      page:    raw.page,
      perPage: params?.perPage ?? 50,
    } satisfies ProductListResponse;
  },

  searchByBarcode: (barcode: string) =>
    apiFetch<Product & { variants?: ProductVariant[]; defaultPrice?: number }>(
      `/products/barcode/${encodeURIComponent(barcode)}`,
    ),

  get: (id: string) =>
    apiFetch<Product & { variants?: ProductVariant[]; day_parts?: string[] | null }>(`/products/${id}`),

  /**
   * Recipe-aware modifier data for the POS (recipe_mode products). Returns
   * auto-generated omissions/extras + universal add-ons + custom groups. Only
   * called when product.recipe_mode === true; recipe_mode=false products use the
   * modifierGroups already on the product list response.
   */
  posModifiers: (id: string) =>
    apiFetch<POSModifierResponse>(`/products/${id}/modifiers/pos`),

  /** Create a product (Products settings page). Also creates a default variant + price. */
  create: (body: CreateProductBody) =>
    apiFetch<ProductWithModifiers>('/products', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  /** Update a product's day-part assignment (and optionally other fields). */
  update: (id: string, body: { dayParts?: string[] | null; price?: number; [key: string]: unknown }) =>
    apiFetch<Product>(`/products/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    }),

  /** Soft-delete a product. */
  remove: (id: string) =>
    apiFetch<void>(`/products/${id}`, { method: 'DELETE' }),

  /** Archive a product (hidden from POS until restored). */
  archive: (productId: string, reason?: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/archive`, {
      method: 'POST',
      body:   JSON.stringify({ reason }),
    }),

  /** Restore an archived product back to active. */
  restore: (productId: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/restore`, {
      method: 'POST',
    }),

  /** List archived products (admin Archived tab). */
  listArchived: () =>
    apiFetch<{ products: ArchivedProductRow[] }>('/products/archived')
      .then((r) => r.products),
};

/** Archived product row returned by GET /api/v1/products/archived. */
export interface ArchivedProductRow {
  id:             string;
  name:           string;
  sku:            string | null;
  category_name:  string | null;
  last_price:     number;
  archived_at:    string;  // ISO timestamp
  archive_reason: string | null;
}

// ─── Dashboard layout types ───────────────────────────────────────────────────

/** Per-category layout config stored in the dashboard layout. */
export interface CategoryLayoutConfig {
  categoryId:   string;
  displayOrder: number;       // 0-based sort position
  color:        string | null; // hex color — null = auto (hash-based)
  icon:         string | null; // emoji or 2-char string — null = use initials
  isPinned:     boolean;       // pinned categories appear first
  isHidden:     boolean;       // hide from POS without deleting
}

/** Full dashboard layout saved in organizations.settings.dashboardLayout */
export interface DashboardLayout {
  categoryConfigs:   CategoryLayoutConfig[];
  showAllItemsTile:  boolean;
  allItemsTileColor: string;
  gridColumns:       2 | 3 | 4;
}

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  categoryConfigs:   [],
  showAllItemsTile:  true,
  allItemsTileColor: '#1D9E75',
  gridColumns:       3,
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface LocationAddress {
  line1?:   string;
  city?:    string;
  state?:   string;
  zip?:     string;
  country?: string;
}

export interface BusinessSettings {
  orgName:  string;
  orgSlug:  string;
  website:  string;
  logoUrl:  string;
  location: {
    id:       string;
    name:     string;
    address:  LocationAddress;
    phone:    string | null;
    timezone: string;
    currency: string;
  } | null;
}

export interface TaxRateConfig {
  name:      string;
  rate:      number;  // decimal, e.g. 0.0825
  appliesTo: 'all' | 'food' | 'alcohol' | 'merchandise';
}

export interface TaxSettings {
  locationId:   string | null;
  taxRates:     TaxRateConfig[];
  taxInclusive: boolean;
}

export interface ReceiptConfig {
  message?:     string;
  footerText?:  string;
  showLogo?:    boolean;
  showAddress?: boolean;
  showPhone?:   boolean;
  showWebsite?: boolean;
}

export interface OnlineOrderingConfig {
  enabled:             boolean;
  pickupEnabled:       boolean;
  deliveryEnabled:     boolean;
  pickupPrepMinutes:   number;
  deliveryRadiusMiles: number;
  deliveryFeeCents:    number;
  minOrderCents:       number;
  textEnabled?:        boolean;
}

export interface LoyaltyConfig {
  enabled:           boolean;
  pointsPerDollar:   number;
  redeemRate:        number;   // dollars per point
  minimumRedemption: number;
  tiers:             { none: number; bronze: number; silver: number; gold: number; platinum: number };
}

export interface DeliveryProviderConfig {
  id: string;
  provider: string;
  is_enabled: boolean;
  store_id: string | null;
  has_secret: boolean;
  settings: Record<string, unknown> | null;
  created_at: string;
}

export const delivery = {
  list: () =>
    apiFetch<{ providers: DeliveryProviderConfig[] }>('/delivery/providers').then((r) => r.providers),
  save: (
    provider: string,
    cfg: { isEnabled: boolean; webhookSecret?: string; storeId?: string },
  ) =>
    apiFetch<{ success: boolean }>(`/delivery/providers/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(cfg),
    }),
};

export const settings = {
  getDashboardLayout: () =>
    apiFetch<{ dashboardLayout: DashboardLayout | null }>(
      '/settings/dashboard-layout',
    ).then((r) => r.dashboardLayout),

  saveDashboardLayout: (layout: DashboardLayout) =>
    apiFetch<{ success: boolean }>('/settings/dashboard-layout', {
      method: 'PATCH',
      body:   JSON.stringify(layout),
    }),

  getBusiness: () => apiFetch<BusinessSettings>('/settings/business'),

  saveBusiness: (body: {
    name?: string; website?: string; logoUrl?: string;
    locationName?: string; address?: LocationAddress;
    phone?: string; timezone?: string; currency?: string;
  }) =>
    apiFetch<{ success: boolean }>('/settings/business', {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  getTax: () => apiFetch<TaxSettings>('/settings/tax'),

  saveTax: (body: { taxRates: TaxRateConfig[]; taxInclusive: boolean }) =>
    apiFetch<{ success: boolean }>('/settings/tax', {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  getReceipt: () =>
    apiFetch<{ locationId: string | null; receiptConfig: ReceiptConfig }>('/settings/receipt'),

  saveReceipt: (receiptConfig: ReceiptConfig) =>
    apiFetch<{ success: boolean }>('/settings/receipt', {
      method: 'PATCH', body: JSON.stringify({ receiptConfig }),
    }),

  getOnlineOrdering: () =>
    apiFetch<{ onlineOrdering: OnlineOrderingConfig }>('/settings/online-ordering').then((r) => r.onlineOrdering),

  saveOnlineOrdering: (cfg: Partial<OnlineOrderingConfig>) =>
    apiFetch<{ success: boolean }>('/settings/online-ordering', { method: 'PATCH', body: JSON.stringify(cfg) }),

  getLoyalty: () => apiFetch<{ loyalty: LoyaltyConfig }>('/settings/loyalty').then((r) => r.loyalty),

  saveLoyalty: (cfg: Partial<LoyaltyConfig>) =>
    apiFetch<{ success: boolean }>('/settings/loyalty', { method: 'PATCH', body: JSON.stringify(cfg) }),

  getPayments: () =>
    apiFetch<{ paymentMethods: Record<string, boolean>; stripeEnabled: boolean }>('/settings/payments'),

  savePayments: (paymentMethods: Record<string, boolean>) =>
    apiFetch<{ success: boolean }>('/settings/payments', {
      method: 'PATCH', body: JSON.stringify({ paymentMethods }),
    }),
};

export interface ConnectAccountStatus {
  accountId:           string;
  chargesEnabled:      boolean;
  payoutsEnabled:      boolean;
  requiresInformation: boolean;
  requirementsDue:     string[];
}

export const stripeConnect = {
  /** Returns null when no Stripe account is connected (endpoint 400s in that case). */
  status: () =>
    apiFetch<ConnectAccountStatus>('/payments/connect/status', {}, true, { noRedirect: true })
      .catch(() => null),

  start: (input: { businessType: 'individual' | 'company'; email: string; country: string; businessName?: string }) =>
    apiFetch<{ accountId: string; onboardingUrl: string }>('/payments/connect/account', {
      method: 'POST', body: JSON.stringify(input),
    }),

  refreshLink: () =>
    apiFetch<{ onboardingUrl: string }>('/payments/connect/refresh-link', { method: 'POST' }),
};

// ─── Categories ───────────────────────────────────────────────────────────────

export interface CategoryInput {
  name:       string;
  color?:     string | null;
  icon?:      string | null;
  sortOrder?: number;
  parentId?:  string | null;
}

export interface CategoryRow {
  id:              string;
  organization_id: string;
  parent_id:       string | null;
  name:            string;
  color:           string | null;
  icon:            string | null;
  sort_order:      number;
  is_active:       boolean;
}

export const categories = {
  list: () => apiFetch<CategoryListResponse>('/categories'),

  create: (body: CategoryInput) =>
    apiFetch<CategoryRow>('/categories', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<CategoryInput> & { isActive?: boolean }) =>
    apiFetch<CategoryRow>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) =>
    apiFetch<void>(`/categories/${id}`, { method: 'DELETE' }),

  /** Bulk-update sort order after drag-to-reorder. */
  reorder: (positions: Array<{ id: string; sortOrder: number }>) =>
    apiFetch<{ success: boolean }>('/categories/reorder', {
      method: 'PATCH',
      body:   JSON.stringify({ positions }),
    }),
};

// ─── Modifiers ────────────────────────────────────────────────────────────────

export type ModifierSelectionType = 'single' | 'multiple' | 'required_single' | 'required_multiple';

export interface ModifierItem {
  id:         string;
  name:       string;
  priceDelta: number; // cents
  isDefault:  boolean;
  sortOrder:  number;
}

export interface ModifierGroupFull {
  id:            string;
  name:          string;
  selectionType: ModifierSelectionType;
  minSelections: number;
  maxSelections: number | null;
  sortOrder:     number;
  modifiers:     ModifierItem[];
  productIds:    string[];
}

export const modifiers = {
  listGroups: () =>
    apiFetch<{ groups: ModifierGroupFull[] }>('/modifier-groups').then((r) => r.groups),

  createGroup: (body: { name: string; selectionType?: ModifierSelectionType; minSelections?: number; maxSelections?: number | null }) =>
    apiFetch<{ id: string }>('/modifier-groups', { method: 'POST', body: JSON.stringify(body) }),

  updateGroup: (id: string, body: { name?: string; selectionType?: ModifierSelectionType; minSelections?: number; maxSelections?: number | null }) =>
    apiFetch<{ success: boolean }>(`/modifier-groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteGroup: (id: string) =>
    apiFetch<void>(`/modifier-groups/${id}`, { method: 'DELETE' }),

  addModifier: (groupId: string, body: { name: string; priceDelta?: number; isDefault?: boolean; sortOrder?: number }) =>
    apiFetch<{ id: string }>(`/modifier-groups/${groupId}/modifiers`, { method: 'POST', body: JSON.stringify(body) }),

  updateModifier: (id: string, body: { name?: string; priceDelta?: number; isDefault?: boolean; sortOrder?: number }) =>
    apiFetch<{ success: boolean }>(`/modifiers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteModifier: (id: string) =>
    apiFetch<void>(`/modifiers/${id}`, { method: 'DELETE' }),

  setGroupProducts: (groupId: string, productIds: string[]) =>
    apiFetch<{ success: boolean }>(`/modifier-groups/${groupId}/products`, {
      method: 'POST', body: JSON.stringify({ productIds }),
    }),

  /** Replace ALL modifier-group assignments for a product (product-centric — fixes BUG-MOD-001). */
  setProductGroups: (productId: string, groupIds: string[]) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/modifier-groups`, {
      method: 'POST', body: JSON.stringify({ groupIds }),
    }),
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface ReceiptLineItemData {
  name:           string;
  sku:            string | null;
  quantity:       number;
  unitPrice:      number;
  modifiers:      Array<{ name: string; priceDelta: number }>;
  discountAmount: number;
  taxAmount:      number;
  total:          number;
  voided:         boolean;
}

export interface ReceiptPaymentData {
  method:    string;
  amount:    number;
  tipAmount: number;
  last4:     string | null;
  brand:     string | null;
}

/** Structured receipt returned by GET /api/v1/orders/:orderId/receipt */
export interface ReceiptData {
  receiptNumber:    string;
  orderId:          string;
  orderNumber:      string;
  orderType:        string;
  locationName:     string;
  locationAddress:  string | null;
  locationPhone:    string | null;
  orgName:          string;
  orgCurrency:      string;
  employeeName:     string;
  customerName:     string | null;
  lineItems:        ReceiptLineItemData[];
  payments:         ReceiptPaymentData[];
  subtotal:         number;
  discountTotal:    number;
  taxTotal:         number;
  tipTotal:         number;
  total:            number;
  amountPaid:       number;
  changeDue:        number;
  notes:            string | null;
  printedAt:        string;
  createdAt:        string;
  footerText:       string | null;
  headerText:       string | null;
  showTaxBreakdown: boolean;
}

export const orders = {
  // BUG-ORD-001: the backend expects { orderType, lineItems[] } with unitPriceOverride —
  // translate the cart-shaped body (items[] + unitPrice) here so the POS payment flow works.
  create: (locationId: string, body: Omit<OrderCreateBody, 'locationId'>) =>
    apiFetch<Order>(`/locations/${locationId}/orders`, {
      method: 'POST',
      body: JSON.stringify({
        orderType:  body.orderType ?? (body.tableId ? 'table_service' : 'in_store'),
        customerId: body.customerId ?? null,
        tableId:    body.tableId ?? null,
        notes:      body.notes,
        discountIds: body.discountIds,
        discountCodes: body.discountCodes,
        lineItems:  body.items.map((i) => ({
          productId:         i.productId,
          variantId:         i.variantId ?? null,
          quantity:          i.quantity,
          unitPriceOverride: i.unitPrice,
          notes:             i.notes,
          modifiers:         (i.modifiers ?? []).map((m) => ({
            modifierId: m.modifierId, name: m.name ?? '', priceDelta: m.priceDelta,
          })),
        })),
      }),
    }),

  getById: (locationId: string, orderId: string) =>
    apiFetch<Order>(`/locations/${locationId}/orders/${orderId}`),

  list: (locationId: string, params?: { status?: OrderStatus; page?: number; perPage?: number }) => {
    const q = new URLSearchParams();
    if (params?.status)  q.set('status',  params.status);
    if (params?.page)    q.set('page',    String(params.page));
    if (params?.perPage) q.set('perPage', String(params.perPage));
    return apiFetch<{ orders: Order[]; total: number }>(`/locations/${locationId}/orders?${q.toString()}`);
  },

  update: (locationId: string, orderId: string, body: Partial<OrderCreateBody>) =>
    apiFetch<Order>(`/locations/${locationId}/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  void: (locationId: string, orderId: string, reason?: string) =>
    apiFetch<Order>(`/locations/${locationId}/orders/${orderId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  park: (locationId: string, orderId: string) =>
    apiFetch<Order>(`/locations/${locationId}/orders/${orderId}/park`, {
      method: 'POST',
    }),

  resume: (locationId: string, orderId: string) =>
    apiFetch<Order>(`/locations/${locationId}/orders/${orderId}/resume`, {
      method: 'POST',
    }),

  /** Structured receipt data — includes org/location name from DB. */
  getReceipt: (orderId: string) =>
    apiFetch<ReceiptData>(`/orders/${orderId}/receipt`),

  /** Void an order (refunds completed payments). */
  voidOrder: (orderId: string, reason: string) =>
    apiFetch<{ success: boolean; refundedAmount: number }>(`/orders/${orderId}/void`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),

  /** Refund an order — full / partial / by-item. */
  refund: (orderId: string, body: { type: 'full' | 'partial'; amount?: number; lineItemIds?: string[]; reason: string }) =>
    apiFetch<{ success: boolean; refundedAmount: number }>(`/orders/${orderId}/refund`, {
      method: 'POST', body: JSON.stringify(body),
    }),

  /** Line items with ids for the by-item refund picker. */
  lineItems: (orderId: string) =>
    apiFetch<{ lineItems: Array<{ id: string; name: string; quantity: number; total: number; voided: boolean }> }>(
      `/orders/${orderId}/line-items`,
    ).then((r) => r.lineItems),

  /** Org-wide enriched order history (Order History screen). */
  history: (params?: {
    status?: string; employeeId?: string; paymentMethod?: string;
    from?: string; to?: string; search?: string; page?: number; limit?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== '' && v !== 'all') q.set(k, String(v)); });
    const qs = q.toString();
    return apiFetch<{ orders: OrderHistoryRow[]; total: number }>(`/orders${qs ? `?${qs}` : ''}`);
  },
};

export interface OrderHistoryRow {
  id:              string;
  order_number:    string;
  status:          string;
  order_type:      string;
  total:           number;
  amount_paid:     number;
  tip_total:       number;
  created_at:      string;
  employee_name:   string;
  customer_name:   string | null;
  item_count:      number;
  payment_methods: string | null;
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export const payments = {
  process: (locationId: string, orderId: string, body: PaymentBody) =>
    apiFetch<{ payment: unknown; order: Order }>(
      `/locations/${locationId}/orders/${orderId}/payments`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  refund: (paymentId: string, amount: number, reason?: string) =>
    apiFetch<unknown>(`/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }),

  createTerminalIntent: (locationId: string, orderId: string, readerId: string) =>
    apiFetch<{ clientSecret: string; paymentIntentId: string }>(
      '/terminal/payment-intent',
      { method: 'POST', body: JSON.stringify({ locationId, orderId, readerId }) },
    ),
};

// ─── Customers ────────────────────────────────────────────────────────────────

export const customers = {
  search: (query: string) => {
    if (query.length < 2) return Promise.resolve({ customers: [] as Customer[] });
    return apiFetch<{ customers: Customer[] }>(
      `/customers/search?q=${encodeURIComponent(query)}&limit=8`,
    );
  },

  get: (id: string) => apiFetch<Customer>(`/customers/${id}`),

  create: (body: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    notes?: string;
  }) =>
    apiFetch<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: (params?: { search?: string; loyaltyTier?: string; page?: number; perPage?: number; orderBy?: string; orderDir?: 'asc' | 'desc' }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.loyaltyTier) q.set('loyalty_tier', params.loyaltyTier);
    if (params?.page) q.set('page', String(params.page));
    if (params?.perPage) q.set('per_page', String(params.perPage));
    if (params?.orderBy) q.set('order_by', params.orderBy);
    if (params?.orderDir) q.set('order_dir', params.orderDir);
    const qs = q.toString();
    return apiFetch<{ customers: Customer[]; total: number }>(`/customers${qs ? `?${qs}` : ''}`);
  },

  update: (id: string, body: { firstName?: string; lastName?: string; email?: string; phone?: string; tags?: string[]; notes?: string; allergens?: string[] | null }) =>
    apiFetch<Customer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) => apiFetch<void>(`/customers/${id}`, { method: 'DELETE' }),

  orders: (id: string) => apiFetch<{ orders: Array<Record<string, unknown>>; total: number }>(`/customers/${id}/orders`),

  adjustLoyalty: (id: string, delta: number, notes?: string) =>
    apiFetch<unknown>(`/customers/${id}/loyalty/adjust`, { method: 'POST', body: JSON.stringify({ delta, notes }) }),
};

// ─── Inventory ────────────────────────────────────────────────────────────────

export const inventory = {
  getLevels: (locationId: string, params?: { productIds?: string[] }) => {
    const q = new URLSearchParams();
    if (params?.productIds?.length) q.set('productIds', params.productIds.join(','));
    return apiFetch<{
      levels: Array<{ product_id: string; variant_id: string | null; quantity: number; reorder_point: number | null }>
    }>(`/locations/${locationId}/inventory?${q.toString()}`);
  },

  getForecast: (locationId: string) =>
    apiFetch<{ items: Array<{ product_id: string; days_until_stockout: number | null }> }>(
      `/locations/${locationId}/forecast`,
    ),
};

// ─── Discounts ────────────────────────────────────────────────────────────────

export type DiscountType = 'percentage' | 'fixed_amount' | 'bogo' | 'free_item';

export interface DiscountRow {
  id: string; name: string; code: string | null; discount_type: DiscountType;
  value: number; minimum_order_amount: number | null; maximum_discount_amount: number | null;
  usage_limit: number | null; usage_count: number; stackable: boolean;
  active_from: string; active_until: string | null; is_active: boolean;
}

export interface DiscountInput {
  name: string; code?: string | null; discountType: DiscountType; value: number;
  minimumOrderAmount?: number | null; maximumDiscountAmount?: number | null;
  usageLimit?: number | null; stackable?: boolean; activeFrom?: string | null; activeUntil?: string | null;
}

export interface ValidatedDiscount {
  id: string; code: string; name: string; discountType: DiscountType; value: number; amount: number;
}

export const discounts = {
  /** Placeholder kept for existing callers — returns no active promos list. */
  listActive: (): Promise<ActiveDiscount[]> => Promise.resolve([]),

  list: () => apiFetch<{ discounts: DiscountRow[] }>('/discounts').then((r) => r.discounts),
  report: () => apiFetch<{ report: Array<{ id: string; name: string; code: string | null; usage_count: number; total_saved: number }> }>('/discounts/report').then((r) => r.report),
  create: (body: DiscountInput) => apiFetch<DiscountRow>('/discounts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<DiscountInput> & { isActive?: boolean }) =>
    apiFetch<DiscountRow>(`/discounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string) => apiFetch<void>(`/discounts/${id}`, { method: 'DELETE' }),
  validate: (code: string, subtotal: number) =>
    apiFetch<ValidatedDiscount>('/discounts/validate', { method: 'POST', body: JSON.stringify({ code, subtotal }) }),
};

// ─── Inventory (extended) ─────────────────────────────────────────────────────

export interface InventoryLevelRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity_on_hand: number;
  quantity_on_order: number;
  reorder_point: number | null;
  reorder_quantity: number | null;
  max_stock_level: number | null;
  last_counted_at: string | null;
  // joined fields from API (now populated by query)
  product_name: string;
  product_sku: string | null;
  variant_name: string | null;
  unit_of_measure: string;
  cost_price: number;
  category_name: string | null;
}

export interface InventoryMovementRow {
  id: string;
  movement_type: string;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  employee_name: string | null;
  created_at: string;
}

export interface ForecastItem {
  productId: string;
  productName: string;
  sku: string | null;
  currentOnHand: number;
  unit: string;
  burnRatePerHour: number;
  hoursUntilStockout: number | null;
  estimatedStockoutAt: string | null;
  reorderPointReached: boolean;
  urgency: 'critical' | 'warning' | 'ok';
  confidence: 'high' | 'medium' | 'low';
  dataPoints: number;
}

export interface InventoryAdjustBody {
  productId: string;
  variantId?: string | null;
  quantityDelta: number;
  reason: string;
  notes?: string;
}

export interface StockCountLine {
  productId: string;
  variantId?: string | null;
  countedQuantity: number;
}

export const inventoryApi = {
  levels: (locationId: string, params?: { search?: string; belowReorderPoint?: boolean; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.belowReorderPoint) q.set('belowReorderPoint', 'true');
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    return apiFetch<{ levels: InventoryLevelRow[]; total: number }>(
      `/locations/${locationId}/inventory?${q.toString()}`,
    );
  },

  movements: (locationId: string, productId: string, variantId?: string | null, limit = 50) => {
    const q = new URLSearchParams();
    if (variantId) q.set('variantId', variantId);
    q.set('limit', String(limit));
    return apiFetch<{ movements: InventoryMovementRow[] }>(
      `/locations/${locationId}/inventory/${productId}/movements?${q.toString()}`,
    );
  },

  adjust: (locationId: string, body: InventoryAdjustBody) =>
    apiFetch<{ level: InventoryLevelRow }>(`/locations/${locationId}/inventory/adjust`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  stockCount: (locationId: string, counts: StockCountLine[], isOpeningCount = false) =>
    apiFetch<{ deltas: unknown[] }>(`/locations/${locationId}/inventory/count`, {
      method: 'POST',
      body: JSON.stringify({ counts, isOpeningCount }),
    }),

  forecast: (locationId: string, windowHours?: number) => {
    const q = new URLSearchParams();
    if (windowHours) q.set('windowHours', String(windowHours));
    return apiFetch<{ items: ForecastItem[] }>(`/locations/${locationId}/forecast?${q.toString()}`);
  },
};

// ─── Recipes ──────────────────────────────────────────────────────────────────

export interface RecipeLineInput {
  ingredientProductId: string;
  ingredientVariantId?: string | null;
  quantity: number;
  unit: string;
  wasteFactor?: number;
  notes?: string;
}

export interface RecipeInput {
  name: string;
  yieldFactor?: number;
  notes?: string;
  lines: RecipeLineInput[];
}

export interface RecipeDetail {
  id: string;
  product_id: string;
  name: string;
  yield_factor: number;
  notes: string | null;
  version: number;
  is_active: boolean;
  lines: Array<{
    id: string;
    ingredient_product_id: string;
    ingredient_variant_id: string | null;
    quantity: number;
    unit: string;
    waste_factor: number;
    notes: string | null;
    // joined
    ingredient_name: string;
    ingredient_sku: string | null;
  }>;
}

export const recipesApi = {
  get: (productId: string) =>
    apiFetch<RecipeDetail | null>(`/products/${productId}/recipe`),

  save: (productId: string, body: RecipeInput) =>
    apiFetch<RecipeDetail>(`/products/${productId}/recipe`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

// ─── Variance Reports ─────────────────────────────────────────────────────────

export interface VarianceReportSummary {
  id: string;
  location_id: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'finalized';
  flagged_count: number;
  created_at: string;
}

export interface VarianceReportDetail extends VarianceReportSummary {
  lines: Array<{
    id: string;
    product_id: string;
    product_name: string;
    variant_name: string | null;
    opening_quantity: number;
    closing_quantity: number;
    received_quantity: number;
    theoretical_usage: number;
    actual_usage: number;
    variance_delta: number;
    variance_pct: number;
    is_flagged: boolean;
  }>;
}

export const varianceApi = {
  list: (locationId?: string, status?: 'draft' | 'finalized', limit = 20) => {
    const q = new URLSearchParams();
    if (locationId) q.set('locationId', locationId);
    if (status) q.set('status', status);
    q.set('limit', String(limit));
    return apiFetch<{ reports: VarianceReportSummary[]; total: number }>(
      `/variance-reports?${q.toString()}`,
    );
  },

  get: (id: string) =>
    apiFetch<VarianceReportDetail>(`/variance-reports/${id}`),

  generate: (locationId: string, periodStart: string, periodEnd: string, flagThresholdPct?: number) =>
    apiFetch<VarianceReportDetail>('/variance-reports', {
      method: 'POST',
      body: JSON.stringify({ locationId, periodStart, periodEnd, flagThresholdPct }),
    }),

  finalize: (id: string) =>
    apiFetch<VarianceReportDetail>(`/variance-reports/${id}/finalize`, { method: 'POST' }),
};

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export interface POLine {
  productId: string;
  variantId?: string | null;
  quantityOrdered: number;
  unitCost: number;
}

export interface POCreateBody {
  locationId: string;
  supplierId?: string | null;
  expectedDeliveryDate?: string | null;
  notes?: string;
  lines: POLine[];
}

export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  supplier_name: string | null;
  status: string;
  total: number;
  expected_delivery_date: string | null;
  created_at: string;
  line_count: number;
}

export const purchaseOrdersApi = {
  list: (locationId: string, status?: string) => {
    const q = new URLSearchParams();
    q.set('locationId', locationId);
    if (status) q.set('status', status);
    return apiFetch<{ purchaseOrders: PurchaseOrderRow[]; total: number }>(
      `/locations/${locationId}/purchase-orders?${q.toString()}`,
    );
  },

  get: (locationId: string, id: string) =>
    apiFetch<PurchaseOrderRow>(`/locations/${locationId}/purchase-orders/${id}`),

  create: (body: POCreateBody) =>
    apiFetch<PurchaseOrderRow>(`/locations/${body.locationId}/purchase-orders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportDateParams {
  from:       string;   // ISO-8601
  to:         string;   // ISO-8601
  locationId?: string;
  timezone?:  string;
}

import type {
  DashboardMetrics, SalesSummaryRow, TopProductRow,
  TopCustomerRow, PaymentMethodRow, EmployeePerformanceRow,
  HourlyHeatmapRow, ReportGranularity,
} from '@taproot/shared';

export type { DashboardMetrics, SalesSummaryRow, TopProductRow, TopCustomerRow,
              PaymentMethodRow, EmployeePerformanceRow, HourlyHeatmapRow, ReportGranularity };

function buildReportQS(params: ReportDateParams, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.locationId) q.set('location_id', params.locationId);
  if (params.timezone)   q.set('timezone', params.timezone);
  if (extra) Object.entries(extra).forEach(([k, v]) => q.set(k, v));
  return q.toString();
}

// ─── API keys + webhooks (S8-04) ──────────────────────────────────────────────

export const API_KEY_SCOPES = [
  'orders:read', 'orders:write',
  'products:read', 'products:write',
  'customers:read', 'customers:write',
  'reports:read',
] as const;

export interface ApiKeyRow {
  id: string; name: string; key_prefix: string; permissions: string[];
  last_used_at: string | null; expires_at: string | null;
  created_at: string; revoked_at: string | null;
}

export interface WebhookSubRow {
  id: string; url: string; events: string[]; is_active: boolean;
  last_triggered_at: string | null; failure_count: number; created_at: string;
}

export const apiKeys = {
  list: () => apiFetch<{ keys: ApiKeyRow[] }>('/api-keys').then((r) => r.keys),
  create: (body: { name: string; permissions: string[]; expiresAt?: string | null }) =>
    apiFetch<{ id: string; key: string; prefix: string; name: string }>('/api-keys', {
      method: 'POST', body: JSON.stringify(body),
    }),
  revoke: (id: string) => apiFetch<{ success: boolean }>(`/api-keys/${id}`, { method: 'DELETE' }),
};

export const webhooksApi = {
  list: () => apiFetch<{ webhooks: WebhookSubRow[]; availableEvents: string[] }>('/webhooks'),
  create: (body: { url: string; events: string[] }) =>
    apiFetch<WebhookSubRow & { secret: string }>('/webhooks', {
      method: 'POST', body: JSON.stringify(body),
    }),
  remove: (id: string) => apiFetch<{ success: boolean }>(`/webhooks/${id}`, { method: 'DELETE' }),
  test: (id: string) => apiFetch<{ delivered: boolean }>(`/webhooks/${id}/test`, { method: 'POST' }),
};

// ─── Advanced analytics (S8-03) ───────────────────────────────────────────────

export interface CohortRow {
  month: string;
  newCustomers: number;
  retention: { month1: number; month2: number; month3: number; month6: number };
}

export type MenuQuadrant = 'star' | 'plow_horse' | 'puzzle' | 'dog';

export interface MenuItemAnalytics {
  productId: string; name: string; category: string;
  salesCount: number; revenue: number; foodCostPct: number; margin: number;
  quadrant: MenuQuadrant; recommendation: string;
}

export interface StaffPerformanceRow2 {
  id: string; name: string;
  ordersProcessed: number; revenue: number; avgTicket: number; tipsEarned: number;
  voidCount: number; voidRate: number;
  hoursWorked: number | null; revenuePerHour: number | null;
}

export interface PeakHourCell {
  dayOfWeek: number; hour: number; orderCount: number; revenue: number; intensity: number;
}

export interface PeakHoursResult {
  heatmap: PeakHourCell[];
  peakDay: string; peakHour: string; slowestDay: string; slowestHour: string;
}

export interface CustomerInsights {
  totalCustomers: number; newCustomers: number; returningCustomers: number;
  avgVisitsPerCustomer: number; avgLifetimeValue: number;
  churnRisk: Array<{ customerId: string; name: string; lastVisit: string; lifetimeValue: number }>;
  topCustomers: Array<{ customerId: string; name: string; visits: number; totalSpent: number; avgTicket: number }>;
}

export type MenuSuggestedAction = 'promote' | 'reprice' | 'reposition' | 'archive' | 'none';

export interface MenuItemInsight extends MenuItemAnalytics {
  aiRecommendation: string;
  suggestedAction: MenuSuggestedAction;
  suggestedPrice: number | null;  // cents
  avgPrice: number;               // cents
}

export interface MenuInsights {
  items: MenuItemInsight[];
  aiNarrative: string;
  topRecommendation: string;
  quickWins: string[];
  aiUsed: boolean;
  generatedAt: string;
}

export interface FoodCostAnalysisRow {
  productId: string; name: string;
  salePrice: number; recipeCost: number; hasRecipe: boolean;
  foodCostPct: number; targetFoodCostPct: number;
  margin: number; marginPct: number;
  status: 'healthy' | 'warning' | 'critical';
  aiSuggestion: string | null;
}

export interface FoodCostSummary {
  blendedFoodCostPct: number;
  targetFoodCostPct: number;
  variance: number;
  itemsOverTarget: number;
  itemsAnalyzed: number;
  potentialMonthlySavings: number;
  topOffenders: FoodCostAnalysisRow[];
  trend: Array<{ day: string; foodCostPct: number }>;
  aiUsed: boolean;
  generatedAt: string;
}

export const analytics = {
  menuInsights: (params: ReportDateParams) =>
    apiFetch<MenuInsights>(`/analytics/menu-insights?${buildReportQS(params)}`),

  foodCost: (locationId?: string) => {
    const q = new URLSearchParams();
    if (locationId) q.set('location_id', locationId);
    const qs = q.toString();
    return apiFetch<{ items: FoodCostAnalysisRow[] }>(`/analytics/food-cost${qs ? `?${qs}` : ''}`).then((r) => r.items);
  },

  foodCostSummary: (locationId?: string) => {
    const q = new URLSearchParams();
    if (locationId) q.set('location_id', locationId);
    const qs = q.toString();
    return apiFetch<FoodCostSummary>(`/analytics/food-cost/summary${qs ? `?${qs}` : ''}`);
  },

  cohort: (months = 6, locationId?: string) => {
    const q = new URLSearchParams({ months: String(months) });
    if (locationId) q.set('location_id', locationId);
    return apiFetch<{ cohorts: CohortRow[] }>(`/analytics/cohort?${q.toString()}`);
  },
  menuEngineering: (params: ReportDateParams) =>
    apiFetch<{ items: MenuItemAnalytics[]; averagePopularity: number; averageMargin: number }>(
      `/analytics/menu-engineering?${buildReportQS(params)}`),
  staffPerformance: (params: ReportDateParams) =>
    apiFetch<{ employees: StaffPerformanceRow2[] }>(
      `/analytics/staff-performance?${buildReportQS(params)}`),
  peakHours: (params: ReportDateParams) =>
    apiFetch<PeakHoursResult>(`/analytics/peak-hours?${buildReportQS(params)}`),
  customerInsights: (params: ReportDateParams) =>
    apiFetch<CustomerInsights>(`/analytics/customer-insights?${buildReportQS(params)}`),
};

export const reports = {
  getDashboardMetrics: (locationId?: string, timezone = 'UTC') => {
    const q = new URLSearchParams({ timezone });
    if (locationId) q.set('location_id', locationId);
    return apiFetch<DashboardMetrics>(`/reports/dashboard?${q.toString()}`);
  },

  getSalesSummary: (params: ReportDateParams, granularity: ReportGranularity = 'day') =>
    apiFetch<{ rows: SalesSummaryRow[] }>(
      `/reports/sales?${buildReportQS(params, { granularity })}`,
    ),

  // All routes below return { rows: T[] } — unwrap here so callers receive plain arrays.

  getTopProducts: (params: ReportDateParams, limit = 20) =>
    apiFetch<{ rows: TopProductRow[] }>(
      `/reports/top-products?${buildReportQS(params, { limit: String(limit) })}`,
    ).then((r) => r.rows),

  getTopCustomers: (params: ReportDateParams, limit = 20) =>
    apiFetch<{ rows: TopCustomerRow[] }>(
      `/reports/top-customers?${buildReportQS(params, { limit: String(limit) })}`,
    ).then((r) => r.rows),

  getPaymentBreakdown: (params: ReportDateParams) =>
    apiFetch<{ rows: PaymentMethodRow[] }>(
      `/reports/payment-methods?${buildReportQS(params)}`,
    ).then((r) => r.rows),

  getEmployeePerformance: (params: ReportDateParams) =>
    apiFetch<{ rows: EmployeePerformanceRow[] }>(
      `/reports/employee-performance?${buildReportQS(params)}`,
    ).then((r) => r.rows),

  getHourlyHeatmap: (params: ReportDateParams) =>
    apiFetch<{ rows: HourlyHeatmapRow[] }>(
      `/reports/hourly-heatmap?${buildReportQS(params)}`,
    ).then((r) => r.rows),

  getTips: (params: ReportDateParams) =>
    apiFetch<TipsReportData>(`/reports/tips?${buildReportQS(params)}`),

  getEndOfDay: (date: string, locationId?: string, timezone = 'UTC') => {
    const q = new URLSearchParams({ date, timezone });
    if (locationId) q.set('location_id', locationId);
    return apiFetch<EndOfDayReport>(`/reports/end-of-day?${q.toString()}`);
  },
};

export interface EndOfDayReport {
  date:           string;
  grossSales:     number;
  refunds:        number;
  netSales:       number;
  orderCount:     number;
  averageTicket:  number;
  taxCollected:   number;
  tipsCollected:  number;
  byPaymentMethod: Record<string, number>;
  topItems:       Array<{ name: string; quantity: number; revenue: number }>;
  byEmployee:     Array<{ name: string; orderCount: number; revenue: number }>;
  hourlyBreakdown: Array<{ hour: number; orderCount: number; revenue: number }>;
  cashReconciliation: {
    openingAmount: number; cashSales: number; cashRefunds: number;
    cashDrops: number; expectedAmount: number; actualAmount: number | null; discrepancy: number | null;
  } | null;
}

export interface TipsReportData {
  totalTips:       number;
  totalSales:      number;
  avgTipPct:       number;
  byEmployee:      Array<{ employee_id: string; employee_name: string; tips: number; order_count: number }>;
  byDay:           Array<{ day: string; tips: number }>;
  byPaymentMethod: Array<{ method: string; tips: number }>;
}

// ─── Intelligence (AI layer, Sprint 5) ────────────────────────────────────────

export interface DemandForecast {
  history: Array<{ day: string; sales: number; orders: number }>;
  forecast: Array<{ date: string; dow: string; predictedSales: number; predictedOrders: number; confidence: 'high' | 'medium' | 'low' }>;
  narrative: string;
  aiUsed: boolean;
  generatedAt: string;
}

export interface StaffingPlan {
  days: Array<{ date: string; dow: string; predictedSales: number; recommendedStaff: number; laborCostCents: number; laborPct: number; alert: boolean }>;
  avgHourlyRateCents: number; targetPct: number; narrative: string; aiUsed: boolean;
}

export const intelligence = {
  forecast: (timezone?: string) => {
    const q = new URLSearchParams();
    if (timezone) q.set('timezone', timezone);
    const qs = q.toString();
    return apiFetch<DemandForecast>(`/intelligence/forecast${qs ? `?${qs}` : ''}`);
  },
  staffing: (timezone?: string) => {
    const q = new URLSearchParams();
    if (timezone) q.set('timezone', timezone);
    const qs = q.toString();
    return apiFetch<StaffingPlan>(`/intelligence/staffing${qs ? `?${qs}` : ''}`);
  },
  menu: () => apiFetch<MenuEngineering>('/intelligence/menu'),
  foodCost: () => apiFetch<FoodCostIntelligence>('/intelligence/food-cost'),
  feed: (timezone?: string) => {
    const q = new URLSearchParams();
    if (timezone) q.set('timezone', timezone);
    const qs = q.toString();
    return apiFetch<DailyFeed>(`/intelligence/feed${qs ? `?${qs}` : ''}`);
  },
  sendFeed: (timezone?: string) => {
    const q = new URLSearchParams();
    if (timezone) q.set('timezone', timezone);
    return apiFetch<{ sent: boolean; channel: string; briefing: string }>(`/intelligence/feed/send?${q.toString()}`, { method: 'POST' });
  },
};

export interface DailyFeed {
  date: string;
  yesterday: { sales: number; orders: number; avgTicket: number; topItem: string | null };
  alerts: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; message: string }>;
  briefing: string; aiUsed: boolean;
}

export interface FoodCostIntelligence {
  foodCostPct: number; revenue: number; cogs: number; targetPct: number;
  byItem: Array<{ name: string; revenue: number; cogs: number; foodCostPct: number; flagged: boolean }>;
  reorderSuggestions: Array<{ productId: string; name: string; onHand: number; reorderPoint: number; suggestedQty: number }>;
  narrative: string; aiUsed: boolean; periodDays: number;
}

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';
export interface MenuEngineering {
  items: Array<{ id: string; name: string; units: number; revenue: number; marginPct: number; category: MenuClass; action: string }>;
  counts: Record<MenuClass, number>;
  periodDays: number; narrative: string; aiUsed: boolean;
}

// ─── AI / NL Query ────────────────────────────────────────────────────────────

export interface NLSuggestedAction {
  label:  string;
  action: 'view_orders' | 'view_employee' | 'archive_product' | 'update_price';
  params: Record<string, unknown>;
}

export interface NLQueryResponse {
  answer:    string;
  data?:     Array<Record<string, unknown>>;
  chartType?: 'bar' | 'line' | 'pie' | null;
  suggestedQuestions?: string[];
  suggestedAction?: NLSuggestedAction | null;
}

// ─── Time clock + schedules (S9-02) ───────────────────────────────────────────

export interface TimeClockEntry {
  id: string;
  employee_id: string;
  employee_name?: string;
  location_id: string;
  clocked_in_at: string;
  clocked_out_at: string | null;
  break_minutes: number;
  hours_worked: number | null;
  labor_cost_cents: number | null;
}

export interface ShiftRow {
  id: string; employee_id: string; employee_name?: string; location_id: string;
  shift_date: string; shift_start: string; shift_end: string;
  role: string | null; ai_suggested: boolean;
}

export interface ShiftInput {
  employeeId: string; locationId: string;
  shiftDate: string; shiftStart: string; shiftEnd: string;
  role?: string | null; aiSuggested?: boolean;
}

export interface SuggestedShift {
  employeeId: string; employeeName: string;
  shiftDate: string; shiftStart: string; shiftEnd: string; role: string | null;
}

export interface ScheduleSuggestion {
  weekStart: string;
  shifts: SuggestedShift[];
  projectedLaborCostCents: number;
  projectedRevenueCents: number;
  laborPct: number;
  narrative: string;
  aiUsed: boolean;
  generatedAt: string;
}

export const timeclock = {
  clockIn: (locationId?: string) =>
    apiFetch<TimeClockEntry>('/timeclock/clockin', { method: 'POST', body: JSON.stringify({ locationId }) }),
  clockOut: (breakMinutes = 0) =>
    apiFetch<TimeClockEntry>('/timeclock/clockout', { method: 'POST', body: JSON.stringify({ breakMinutes }) }),
  current: () => apiFetch<{ entry: TimeClockEntry | null }>('/timeclock/current').then((r) => r.entry),
  report: (from: string, to: string, locationId?: string) => {
    const q = new URLSearchParams({ from, to });
    if (locationId) q.set('location_id', locationId);
    return apiFetch<{ entries: TimeClockEntry[]; totalHours: number; totalLaborCostCents: number }>(`/timeclock/report?${q.toString()}`);
  },
};

export const schedules = {
  list: (week: string, locationId?: string) => {
    const q = new URLSearchParams({ week });
    if (locationId) q.set('location_id', locationId);
    return apiFetch<{ shifts: ShiftRow[] }>(`/schedules?${q.toString()}`).then((r) => r.shifts);
  },
  saveWeek: (weekStart: string, shifts: ShiftInput[]) =>
    apiFetch<{ saved: number }>('/schedules', { method: 'POST', body: JSON.stringify({ weekStart, shifts }) }),
  aiSuggestion: (week: string, locationId?: string) => {
    const q = new URLSearchParams({ week });
    if (locationId) q.set('locationId', locationId);
    q.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    return apiFetch<ScheduleSuggestion>(`/ai/schedule-suggestion?${q.toString()}`);
  },
};

export interface ForecastResult {
  date: string;
  dayOfWeek: string;
  predictedRevenue: { low: number; mid: number; high: number };  // cents
  predictedOrders: number;
  predictedTopItems: Array<{ name: string; predictedQuantity: number }>;
  prepRecommendations: string[];
  confidence: number;
  basedOnDays: number;
  aiUsed: boolean;
  note: string | null;
  generatedAt: string;
}

export interface DailyIntelligence {
  date: string;
  yesterday: {
    revenue: number; revenueVsLastWeek: number; orders: number; avgTicket: number;
    bestItem: { name: string; count: number } | null;
    worstItem: { name: string; count: number } | null;
    voids: { count: number; amount: number };
    cashDiscrepancy: number;
  };
  today: {
    forecastRevenueLow: number; forecastRevenueHigh: number; forecastOrders: number;
    staffScheduled: number; staffRecommended: number; prepChecklist: string[];
  };
  alerts: Array<{ type: 'warning' | 'info' | 'success'; message: string }>;
  reorderNeeded: Array<{ productName: string; currentStock: number; daysUntilStockout: number }>;
  aiInsight: string;
  aiUsed: boolean;
  generatedAt: string;
}

export const ai = {
  suggestedQuestions: () =>
    apiFetch<{ questions: string[] }>('/ai/suggested-questions').then((r) => r.questions),

  dailyIntelligence: (locationId?: string) => {
    const q = new URLSearchParams();
    if (locationId) q.set('locationId', locationId);
    q.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    return apiFetch<DailyIntelligence>(`/ai/daily-intelligence?${q.toString()}`);
  },

  forecast: (date?: string, locationId?: string) => {
    const q = new URLSearchParams();
    if (date) q.set('date', date);
    if (locationId) q.set('locationId', locationId);
    q.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    return apiFetch<ForecastResult>(`/ai/forecast?${q.toString()}`);
  },

  nlQuery: (
    query: string,
    locationId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<NLQueryResponse> => {
    return apiFetch<NLQueryResponse>('/ai/nl-query', {
      method: 'POST',
      body:   JSON.stringify({ query, locationId, history }),
    }).catch(() => ({
      answer:    "I couldn't process that query. The AI analytics feature isn't connected yet.",
      data:      undefined,
      chartType: null,
      suggestedQuestions: [],
    }));
  },
};

// ─── Import Jobs ──────────────────────────────────────────────────────────────

export type MigrationImportType =
  | 'migration_square'
  | 'migration_shopify'
  | 'migration_toast'
  | 'migration_lightspeed'
  | 'migration_clover';

export type ImportType =
  | MigrationImportType
  | 'document_menu'
  | 'document_invoice'
  | 'document_goods_receipt'
  | 'document_inventory'
  | 'document_recipe'
  | 'generic_csv';

export type ImportStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_confirmation'
  | 'completed'
  | 'failed'
  | 'partial';

export interface ImportJob {
  id:              string;
  organization_id: string;
  import_type:     ImportType;
  status:          ImportStatus;
  source_filename: string | null;
  source_file_url: string | null;
  mapping_config:  unknown;
  total_rows:      number | null;
  processed_rows:  number;
  succeeded_rows:  number;
  failed_rows:     number;
  error_log:       Array<{ row?: number; message: string }>;
  preview_data:    unknown;
  started_at:      string | null;
  completed_at:    string | null;
  initiated_by:    string | null;
  created_at:      string;
  updated_at:      string;
}

export interface ColumnMappingEntry {
  sourceColumn: string;
  targetField:  string;
  confidence:   number;
  transform?:   string;
}

export interface ColumnMapping {
  mappings:        ColumnMappingEntry[];
  unmappedColumns: string[];
  confidence:      number;
}

/** AI-inferred ingredient for opt-in recipe mode during menu import. */
export interface SuggestedIngredient {
  name:               string;
  quantity:           number;
  unit:               string;
  isOptional:         boolean;
  omissionPriceDelta: number; // cents
  extraPriceDelta:    number; // cents
  extraQuantity:      number;
  displayOrder:       number;
}

/** A single menu item as submitted by the user after inline editing. */
export interface ConfirmedMenuItem {
  name:         string;
  price:        number; // cents
  category?:    string;
  description?: string;
  include:      boolean;
  /** Opt-in: create ingredients + recipe + enable recipe mode for this product. */
  enableRecipeMode?: boolean;
  /** Owner-confirmed/edited ingredient list (sent only when enableRecipeMode). */
  ingredients?: SuggestedIngredient[];
}

/** Body sent to POST /imports/:jobId/confirm */
export interface ConfirmImportPayload {
  locationId:        string;
  confirmedMapping?: ColumnMapping;
  /** EDIT CHAIN: user-edited items; if present, overrides AI-parsed data */
  confirmedItems?:   ConfirmedMenuItem[];
}

export const importsApi = {
  /** Upload a file and create an import job. Returns { jobId, status }. */
  upload: (file: File): Promise<{ jobId: string; status: ImportStatus }> => {
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Note: do NOT set Content-Type — browser will set multipart boundary automatically
    return fetch(`${BASE}/imports/upload`, {
      method: 'POST',
      headers,
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new ApiError(res.status, 'UPLOAD_ERROR', body.message ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ jobId: string; status: ImportStatus }>;
    });
  },

  /** Fetch a menu from a URL → returns content the caller feeds into upload(). */
  fetchMenuUrl: (url: string) =>
    apiFetch<{
      success:     boolean;
      contentType: 'pdf' | 'image' | 'html' | 'unsupported';
      mimeType:    string;
      content:     string;       // base64 for pdf/image, text for html
      pageTitle:   string | null;
      sourceUrl:   string;
    }>('/imports/fetch-url', { method: 'POST', body: JSON.stringify({ url }) }),

  get: (jobId: string) =>
    apiFetch<{ job: ImportJob }>(`/imports/${jobId}`).then((r) => r.job),

  // EDIT CHAIN: payload.confirmedItems carries user edits to the backend
  confirm: (jobId: string, payload: ConfirmImportPayload) =>
    apiFetch<{ job: ImportJob }>(`/imports/${jobId}/confirm`, {
      method: 'POST',
      body:   JSON.stringify(payload),
    }).then((r) => r.job),

  list: (params?: { status?: string; importType?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status)     qs.set('status',     params.status);
    if (params?.importType) qs.set('importType', params.importType);
    if (params?.limit)      qs.set('limit',      String(params.limit));
    if (params?.offset)     qs.set('offset',     String(params.offset));
    return apiFetch<{ jobs: ImportJob[]; total: number }>(`/imports?${qs.toString()}`);
  },
};

// ─── Migrations ───────────────────────────────────────────────────────────────

export interface MigrationApplyOptions {
  importProducts?:      boolean;
  importCustomers?:     boolean;
  importLoyaltyPoints?: boolean;
  overwriteExisting?:   boolean;
}

export interface MigrationResult {
  categories: number;
  products:   number;
  customers:  number;
  employees:  number;
  failed:     number;
  errors:     string[];
}

export const migrationsApi = {
  /** Square — fetch catalog + customers from Square API */
  startSquare: (locationId: string, accessToken: string, squareLocationId?: string) =>
    apiFetch<{ job: ImportJob }>('/migrations/square', {
      method: 'POST',
      body:   JSON.stringify({ locationId, accessToken, squareLocationId }),
    }).then((r) => r.job),

  /** Shopify — fetch products + customers from Shopify Admin API */
  startShopify: (locationId: string, shopDomain: string, accessToken: string) =>
    apiFetch<{ job: ImportJob }>('/migrations/shopify', {
      method: 'POST',
      body:   JSON.stringify({ locationId, shopDomain, accessToken }),
    }).then((r) => r.job),

  /** Toast — fetch menus + employees from Toast API */
  startToast: (locationId: string, clientId: string, clientSecret: string, restaurantGuid: string) =>
    apiFetch<{ job: ImportJob }>('/migrations/toast', {
      method: 'POST',
      body:   JSON.stringify({ locationId, clientId, clientSecret, restaurantGuid }),
    }).then((r) => r.job),

  /** Lightspeed — fetch items from Lightspeed R-Series */
  startLightspeed: (locationId: string, apiKey: string, accountId: string) =>
    apiFetch<{ job: ImportJob }>('/migrations/lightspeed', {
      method: 'POST',
      body:   JSON.stringify({ locationId, apiKey, accountId }),
    }).then((r) => r.job),

  /** Clover — fetch items + customers from Clover API */
  startClover: (locationId: string, accessToken: string, merchantId: string) =>
    apiFetch<{ job: ImportJob }>('/migrations/clover', {
      method: 'POST',
      body:   JSON.stringify({ locationId, accessToken, merchantId }),
    }).then((r) => r.job),

  /** CSV — normalise a raw CSV file */
  startCsv: (
    locationId: string,
    fileUrl: string,
    targetSchema: 'products' | 'customers' | 'inventory',
    rawCsv: string,
  ) =>
    apiFetch<{ job: ImportJob }>('/migrations/csv', {
      method: 'POST',
      body:   JSON.stringify({ locationId, fileUrl, targetSchema, rawCsv }),
    }).then((r) => r.job),

  /** Poll a migration job by id */
  getJob: (jobId: string) =>
    apiFetch<{ job: ImportJob }>(`/imports/${jobId}`).then((r) => r.job),

  /** Apply a confirmed migration */
  apply: (jobId: string, locationId: string, options: MigrationApplyOptions = {}) =>
    apiFetch<{ result: MigrationResult }>(`/migrations/${jobId}/apply`, {
      method: 'POST',
      body:   JSON.stringify({ locationId, ...options }),
    }).then((r) => r.result),

  /** List migration jobs for this org */
  list: () =>
    apiFetch<{ jobs: ImportJob[] }>('/migrations').then((r) => r.jobs),

  /** Test Square credentials (no write) */
  testSquare: (accessToken: string) =>
    apiFetch<{ ok: boolean; locationCount: number }>('/migrations/test/square', {
      method: 'POST',
      body:   JSON.stringify({ accessToken }),
    }),

  /** Test Shopify credentials (no write) */
  testShopify: (shopDomain: string, accessToken: string) =>
    apiFetch<{ ok: boolean; shopName: string }>('/migrations/test/shopify', {
      method: 'POST',
      body:   JSON.stringify({ shopDomain, accessToken }),
    }),

  /** Test Clover credentials (no write) */
  testClover: (merchantId: string, accessToken: string) =>
    apiFetch<{ ok: boolean; merchantName: string }>('/migrations/test/clover', {
      method: 'POST',
      body:   JSON.stringify({ merchantId, accessToken }),
    }),
};

// ─── Billing ──────────────────────────────────────────────────────────────────

export interface SubscriptionInfo {
  status:             string;
  plan:               string;
  isTrialing:         boolean;
  daysRemaining:      number;
  trialEndsAt:        string | null;
  subscriptionEndsAt: string | null;
  locationCount:      number;
  stripeCustomerId:   string | null;
}

export interface Invoice {
  id:           string;
  number:       string;
  amountPaid:   number;
  currency:     string;
  status:       string;
  created:      number;
  invoicePdf:   string | null;
}

export const billingApi = {
  /** Get current subscription info */
  getSubscription: () =>
    apiFetch<SubscriptionInfo>('/billing/subscription'),

  /** Create Stripe billing portal session */
  createPortalSession: () =>
    apiFetch<{ url: string }>('/billing/portal', { method: 'POST' }),

  /** List recent paid invoices */
  getInvoices: () =>
    apiFetch<{ invoices: Invoice[] }>('/billing/invoices'),

  /** Start a new subscription with a payment method */
  subscribe: (paymentMethodId: string, locationCount?: number) =>
    apiFetch<{ status: string; stripeCustomerId: string; stripeSubscriptionId: string }>(
      '/billing/subscribe',
      {
        method: 'POST',
        body:   JSON.stringify({ paymentMethodId, locationCount }),
      },
    ),
};

// ─── Public storefront (QR ordering, no auth) ─────────────────────────────────

const PUBLIC_BASE = `${import.meta.env.VITE_API_URL ?? ''}/public`;

export interface PublicMenu {
  org: { name: string; logo: string | null; address: Record<string, unknown> | null };
  online: {
    enabled: boolean; pickupEnabled: boolean; deliveryEnabled: boolean;
    deliveryFeeCents: number; minOrderCents: number; pickupPrepMinutes: number;
    paymentAvailable: boolean;
  };
  categories: Array<{
    id: string; name: string; color: string | null; icon: string | null;
    products: Array<{ id: string; variantId: string | null; name: string; description: string | null; price: number }>;
  }>;
}

export interface PublicOrderBody {
  tableId?: string | null;
  items: Array<{ productId: string; variantId?: string | null; quantity: number; specialInstructions?: string }>;
  customerName?: string; customerPhone?: string;
  fulfillmentType?: 'pickup' | 'delivery';
  address?: string; requestedTime?: string;
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PUBLIC_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
    throw new ApiError(res.status, body.code ?? 'PUBLIC_ERROR', body.message ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const publicApi = {
  menu: (slug: string) => publicFetch<PublicMenu>(`/${encodeURIComponent(slug)}/menu`),
  createOrder: (slug: string, body: PublicOrderBody) =>
    publicFetch<{ orderId: string; orderNumber: string; estimatedMinutes: number; total: number }>(
      `/${encodeURIComponent(slug)}/order`, { method: 'POST', body: JSON.stringify(body) }),
  paymentIntent: (slug: string, body: PublicOrderBody) =>
    publicFetch<{ clientSecret: string; orderId: string; orderNumber: string; amount: number; publishableKey: string; connectedAccountId: string }>(
      `/${encodeURIComponent(slug)}/payment-intent`, { method: 'POST', body: JSON.stringify(body) }),
  confirmPayment: (slug: string, orderId: string, paymentIntentId: string) =>
    publicFetch<{ status: string }>(`/${encodeURIComponent(slug)}/order/${orderId}/confirm`, {
      method: 'POST', body: JSON.stringify({ paymentIntentId }),
    }),
  orderStatus: (slug: string, orderId: string) =>
    publicFetch<{ status: string; orderNumber: string; estimatedMinutes: number }>(`/${encodeURIComponent(slug)}/order/${orderId}/status`),
  waitTime: (slug: string) =>
    publicFetch<{ available: boolean; estimatedMinutes: number | null; displayText: string | null; confidence?: 'high' | 'medium' | 'low'; rushMode?: boolean; lastUpdated?: string }>(
      `/${encodeURIComponent(slug)}/wait-time`),
};

// ─── Registration ─────────────────────────────────────────────────────────────

export interface RegisterPayload {
  firstName:     string;
  lastName:      string;
  email:         string;
  password:      string;
  businessName:  string;
  businessType?: string;
  referralSource?: string;
}

export interface RegisterResponse {
  accessToken:  string;
  refreshToken: string;
  employee: {
    id:          string;
    email:       string;
    firstName:   string;
    lastName:    string;
    role:        string;
    orgId:       string;
    locationIds: string[];
    permissions: string[];
  };
}

export const registrationApi = {
  /** Register a new organization + owner account */
  register: (payload: RegisterPayload) =>
    apiFetch<RegisterResponse>('/register', {
      method: 'POST',
      body:   JSON.stringify(payload),
    }),

  /** Check if an email address is available */
  checkEmail: (email: string) =>
    apiFetch<{ available: boolean }>('/register/check-email', {
      method: 'POST',
      body:   JSON.stringify({ email }),
    }),
};

// ─── Onboarding ───────────────────────────────────────────────────────────────

export interface OnboardingProgress {
  [key: string]: unknown;
}

export const onboardingApi = {
  getStatus: () =>
    apiFetch<{ progress: OnboardingProgress | null }>('/onboarding/status'),

  saveStatus: (step: string, status: string, data?: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>('/onboarding/status', {
      method: 'POST',
      body:   JSON.stringify({ step, status, data }),
    }),

  complete: () =>
    apiFetch<{ ok: boolean }>('/onboarding/complete', { method: 'POST' }),

  menuFromUrl: (url: string) =>
    apiFetch<{ jobId: string; status: string }>('/onboarding/menu-from-url', {
      method: 'POST',
      body:   JSON.stringify({ url }),
    }),
};

// ─── Ingredients & recipes (FEAT ingredients — Session 1 backend, migration 028) ─
//
// NOTE: distinct from `recipesApi` (legacy recipe_lines at /products/:id/recipe).
// These hit the ingredient system at /ingredients + /products/:id/ingredient-recipe.
// POS preview reuses products.posModifiers().

/** Units supported by ingredients/recipes — mirrors api SUPPORTED_UNITS. */
export const SUPPORTED_UNITS = [
  { value: 'oz', label: 'oz', type: 'weight' }, { value: 'g', label: 'g', type: 'weight' },
  { value: 'lb', label: 'lb', type: 'weight' }, { value: 'kg', label: 'kg', type: 'weight' },
  { value: 'ml', label: 'ml', type: 'volume' }, { value: 'l', label: 'l', type: 'volume' },
  { value: 'tsp', label: 'tsp', type: 'volume' }, { value: 'tbsp', label: 'tbsp', type: 'volume' },
  { value: 'fl_oz', label: 'fl oz', type: 'volume' }, { value: 'cup', label: 'cup', type: 'volume' },
  { value: 'qty', label: 'qty', type: 'count' }, { value: 'slice', label: 'slice', type: 'count' },
  { value: 'piece', label: 'piece', type: 'count' }, { value: 'scoop', label: 'scoop', type: 'count' },
  { value: 'shot', label: 'shot', type: 'count' }, { value: 'pinch', label: 'pinch', type: 'count' },
  { value: 'dash', label: 'dash', type: 'count' }, { value: 'custom', label: 'custom', type: 'custom' },
] as const;

export interface Ingredient {
  id: string;
  organization_id: string;
  name: string;
  unit: string;
  unit_label: string | null;
  cost_per_unit: number;          // cents
  current_stock: number;
  par_level: number;
  reorder_point: number;
  is_universal_addon: boolean;
  universal_addon_price: number;  // cents
  universal_addon_label: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngredientInput {
  name: string;
  unit?: string;
  unitLabel?: string | null;
  costPerUnit?: number;           // cents
  currentStock?: number;
  parLevel?: number;
  reorderPoint?: number;
  isUniversalAddon?: boolean;
  universalAddonPrice?: number;   // cents
  universalAddonLabel?: string | null;
  category?: string | null;
}

export interface StockMovement {
  id: string;
  ingredient_id: string;
  movement_type: string;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  notes: string | null;
  created_at: string;
}

export interface RecipeIngredientRow {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  is_optional: boolean;
  omission_price_delta: number;   // cents
  extra_price_delta: number;      // cents
  extra_quantity: number;
  display_order: number;
  ingredient_name: string;
  ingredient_unit: string;
}

export interface RecipeIngredientInput {
  ingredientId: string;
  quantity: number;
  unit: string;
  isOptional: boolean;
  omissionPriceDelta: number;     // cents
  extraPriceDelta: number;        // cents
  extraQuantity: number;
  displayOrder: number;
}

export const ingredientsApi = {
  list: (params?: { category?: string; universalOnly?: boolean; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.universalOnly) q.set('universalOnly', 'true');
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return apiFetch<{ ingredients: Ingredient[] }>(`/ingredients${qs ? `?${qs}` : ''}`).then((r) => r.ingredients);
  },

  get: (id: string) => apiFetch<Ingredient>(`/ingredients/${id}`),

  create: (data: IngredientInput) =>
    apiFetch<Ingredient>('/ingredients', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<IngredientInput>) =>
    apiFetch<Ingredient>(`/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  remove: (id: string) =>
    apiFetch<{ success: boolean }>(`/ingredients/${id}`, { method: 'DELETE' }),

  adjustStock: (id: string, data: { quantityChange: number; movementType: string; notes?: string }) =>
    apiFetch<{ newStock: number; movement: StockMovement }>(`/ingredients/${id}/stock/adjust`, {
      method: 'POST', body: JSON.stringify(data),
    }),

  stockMovements: (id: string, limit = 50) =>
    apiFetch<{ movements: StockMovement[] }>(`/ingredients/${id}/stock/movements?limit=${limit}`).then((r) => r.movements),

  listUniversal: () =>
    apiFetch<{ addons: Ingredient[] }>('/ingredients/universal/list').then((r) => r.addons),

  // ── Inventory dashboard (Session 5) — added here because `inventoryApi` already
  //    exists for the legacy inventory_levels system. ──────────────────────────
  dashboard: () => apiFetch<InventoryDashboard>('/inventory/dashboard'),
  alerts:    () => apiFetch<InventoryAlertCounts>('/inventory/alerts'),
  usage:     (days = 7) => apiFetch<{ usage: IngredientUsageRow[] }>(`/inventory/usage?days=${days}`).then((r) => r.usage),

  // ── Ingredient analytics (Session 6) — namespaced under /inventory/* because
  //    /analytics/food-cost is already taken by the legacy foodCost service. ────
  foodCost:       (days = 7)  => apiFetch<FoodCostSummary>(`/inventory/food-cost?days=${days}`),
  modifierAttach: (days = 30) => apiFetch<{ attachRates: ModifierAttachRate[] }>(`/inventory/modifier-attach?days=${days}`).then((r) => r.attachRates),
  omissions:      (days = 30) => apiFetch<{ omissions: OmissionInsight[] }>(`/inventory/omissions?days=${days}`).then((r) => r.omissions),
};

// ─── Ingredient analytics types (Session 6) ─────────────────────────────────────

export interface FoodCostSummary {
  periodDays: number;
  grossRevenue: number;
  totalCOGS: number;
  grossMargin: number;
  foodCostPercent: number;
  recipeOrderCount: number;
  totalOrderCount: number;
  recipeCoverage: number;
  byDay: Array<{ date: string; revenue: number; cogs: number; margin: number; foodCostPercent: number }>;
  benchmark: { industryAvg: number; status: 'excellent' | 'good' | 'high' | 'critical' };
}

export interface ModifierAttachRate {
  ingredientId: string;
  ingredientName: string;
  modifierType: 'extra' | 'add_on' | 'omission';
  totalOrdersWithProduct: number;
  timesSelected: number;
  attachRate: number;
  revenueFromModifier: number;
  avgPriceDelta: number;
}

export interface OmissionInsight {
  ingredientName: string;
  omissionRate: number;
  productName: string;
  totalOrders: number;
  timesOmitted: number;
  wasteValueSaved: number;
  insight: string;
}

// ─── Inventory dashboard types (Session 5) ──────────────────────────────────────

export interface IngredientUsageRow {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  totalUsed: number;
  totalAdded: number;
  netChange: number;
  movementCount: number;
  avgDailyUsage: number;
  daysRemaining: number | null;
}

export interface InventoryAlertCounts {
  criticalCount: number;
  lowCount: number;
  outOfStockCount: number;
  totalAlerts: number;
}

export interface InventoryStockAlerts {
  critical: Array<{
    id: string; name: string; unit: string;
    currentStock: number; reorderPoint: number; parLevel: number;
    daysRemaining: number | null; suggestedOrderQty: number;
  }>;
  low: Array<{
    id: string; name: string; unit: string;
    currentStock: number; parLevel: number; daysRemaining: number | null;
  }>;
  outOfStock: Array<{ id: string; name: string; unit: string }>;
}

export interface InventoryDashboard {
  summary: {
    totalIngredients: number;
    outOfStock: number;
    critical: number;
    low: number;
    ok: number;
    universalAddons: number;
    totalStockValue: number; // cents
  };
  alerts: InventoryStockAlerts;
  topUsed: Array<{
    ingredientId: string; ingredientName: string; unit: string;
    totalUsed: number; avgDailyUsage: number; daysRemaining: number | null;
  }>;
  recentMovements: Array<{
    id: string; ingredientName: string; movementType: string;
    quantityChange: number; unit: string; createdAt: string; notes: string | null;
  }>;
}

export const ingredientRecipeApi = {
  getRecipe: (productId: string) =>
    apiFetch<{ recipe: RecipeIngredientRow[] }>(`/products/${productId}/ingredient-recipe`).then((r) => r.recipe),

  setRecipe: (productId: string, ingredients: RecipeIngredientInput[]) =>
    apiFetch<{ recipe: RecipeIngredientRow[] }>(`/products/${productId}/ingredient-recipe`, {
      method: 'PUT', body: JSON.stringify({ ingredients }),
    }).then((r) => r.recipe),

  enableRecipeMode: (productId: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/recipe-mode/enable`, { method: 'POST' }),

  disableRecipeMode: (productId: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/recipe-mode/disable`, { method: 'POST' }),

  addExclusion: (productId: string, ingredientId: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/ingredient-exclusions`, {
      method: 'POST', body: JSON.stringify({ ingredientId }),
    }),

  removeExclusion: (productId: string, ingredientId: string) =>
    apiFetch<{ success: boolean }>(`/products/${productId}/ingredient-exclusions/${ingredientId}`, {
      method: 'DELETE',
    }),
};
