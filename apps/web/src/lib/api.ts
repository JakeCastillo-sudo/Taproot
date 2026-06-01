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

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  _retry = true,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    // Network error — retry once
    if (_retry) return apiFetch<T>(path, init, false);
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }

  if (res.status === 401 && _retry) {
    const newToken = await refreshTokens();
    if (newToken) return apiFetch<T>(path, init, false);
    clearTokens();
    window.location.href = '/login';
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

export interface ProductListResponse {
  products: (Product & { variants?: ProductVariant[]; defaultPrice?: number })[];
  total: number;
  page: number;
  perPage: number;
}

export interface CategoryListResponse {
  categories: Category[];
}

export interface OrderCreateBody {
  locationId: string;
  customerId?: string | null;
  orderType?: string;
  items: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitPrice: number;
    notes?: string;
    modifiers?: Array<{ modifierId: string; priceDelta: number }>;
  }>;
  discountIds?: string[];
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
  login: (email: string, password: string, orgSlug = 'demo-restaurant') =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      headers: { 'x-organization-slug': orgSlug },
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
};

// ─── Products ─────────────────────────────────────────────────────────────────

export const products = {
  list: async (params?: {
    categoryId?: string;
    search?: string;
    isActive?: boolean;
    page?: number;
    perPage?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set('categoryId', params.categoryId);
    if (params?.search)     q.set('search', params.search);
    if (params?.isActive !== undefined) q.set('isActive', String(params.isActive));
    if (params?.page)    q.set('page',    String(params.page));
    if (params?.perPage) q.set('perPage', String(params.perPage));
    const qs = q.toString();

    // API returns prices[] per product; extract the lowest as defaultPrice (cents)
    const raw = await apiFetch<{
      products: (Product & {
        variants?: ProductVariant[];
        prices?: Array<{ price: number }>;
      })[];
      total: number;
      page: number;
    }>(`/products${qs ? `?${qs}` : ''}`);

    return {
      products: raw.products.map((p) => ({
        ...p,
        defaultPrice: p.prices?.length
          ? Math.min(...p.prices.map((pp) => Number(pp.price)))
          : 0,
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
    apiFetch<Product & { variants?: ProductVariant[] }>(`/products/${id}`),
};

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = {
  list: () => apiFetch<CategoryListResponse>('/categories'),
};

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = {
  create: (locationId: string, body: Omit<OrderCreateBody, 'locationId'>) =>
    apiFetch<Order>(`/locations/${locationId}/orders`, {
      method: 'POST',
      body: JSON.stringify(body),
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
};

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
  }) =>
    apiFetch<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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

export const discounts = {
  /** Placeholder — discount routes will be added in a future prompt */
  listActive: (): Promise<ActiveDiscount[]> => Promise.resolve([]),
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
  // joined fields
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
