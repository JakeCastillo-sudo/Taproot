/**
 * Typed endpoint wrappers — a focused subset of apps/web/src/lib/api.ts covering
 * the mobile foundation: auth, employees (PIN), products/categories, orders,
 * payments, and the kitchen display. Endpoint shapes match the web client exactly.
 */
import { apiFetch } from './client';

// ─── Shared response types ──────────────────────────────────────────────────────

export interface AuthEmployee {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  orgId: string;
  locationIds: string[];
  permissions: string[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  requiresMfa?: boolean;
  employee: AuthEmployee;
}

export interface SelectableEmployee {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

/** Product as returned by GET /products, normalized with a defaultPrice (cents). */
export interface ApiProduct {
  id: string;
  name: string;
  category_id: string | null;
  day_parts: string[] | null;
  defaultPrice: number;
  hasModifiers: boolean;
}

export interface ApiCategory {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  product_count: number;
}

/** Subset of the shared Order shape (snake_case) returned by order create. */
export interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  tax_total: number;
  tip_total: number;
  total: number;
  amount_paid: number;
  change_due: number;
}

export interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  modifiers: Array<{ name: string }>;
  specialInstructions: string | null;
  ready: boolean;
  station: string;
}

export interface KitchenTicket {
  id: string;
  orderNumber: string;
  tableId: string | null;
  tableName: string | null;
  orderType: string;
  createdAt: string;
  minutesOpen: number;
  items: KitchenItem[];
}

// ─── Request bodies ─────────────────────────────────────────────────────────────

export interface OrderLineItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface PaymentBody {
  paymentMethod: string;
  amount: number;
  tipAmount?: number;
  cashTendered?: number;
}

// ─── Auth ───────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /** Switch the active employee on this device via PIN (device already authed). */
  pinLogin: (employeeId: string, pin: string, locationId?: string) =>
    apiFetch<LoginResponse>('/auth/pin-login', {
      method: 'POST',
      body: JSON.stringify({ employeeId, pin, locationId }),
    }),
};

export const employeesApi = {
  /** Minimal roster for the PIN lock screen. */
  selectable: () =>
    apiFetch<{ employees: SelectableEmployee[] }>('/employees/selectable').then(
      (r) => r.employees,
    ),
};

// ─── Catalog ────────────────────────────────────────────────────────────────────

export const catalogApi = {
  categories: () =>
    apiFetch<{ categories: ApiCategory[] }>('/categories').then((r) => r.categories),

  products: async (params?: { categoryId?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.categoryId) q.set('categoryId', params.categoryId);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();

    const raw = await apiFetch<{
      products: Array<{
        id: string;
        name: string;
        category_id: string | null;
        day_parts: string[] | null;
        prices?: Array<{ price: number }>;
        modifierGroups?: Array<unknown>;
      }>;
    }>(`/products${qs ? `?${qs}` : ''}`);

    return raw.products.map<ApiProduct>((p) => ({
      id: p.id,
      name: p.name,
      category_id: p.category_id,
      day_parts: p.day_parts ?? null,
      defaultPrice: p.prices?.length
        ? Math.min(...p.prices.map((pp) => Number(pp.price)))
        : 0,
      hasModifiers: (p.modifierGroups?.length ?? 0) > 0,
    }));
  },
};

// ─── Orders & payments ──────────────────────────────────────────────────────────

export const ordersApi = {
  /**
   * Create an order. Mirrors the web translation (BUG-ORD-001): the backend
   * expects lineItems[] with unitPriceOverride, not the cart-shaped items[].
   */
  create: (
    locationId: string,
    body: { items: OrderLineItem[]; orderType?: string; notes?: string },
  ) =>
    apiFetch<OrderRow>(`/locations/${locationId}/orders`, {
      method: 'POST',
      body: JSON.stringify({
        orderType: body.orderType ?? 'in_store',
        notes: body.notes,
        lineItems: body.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId ?? null,
          quantity: i.quantity,
          unitPriceOverride: i.unitPrice,
          notes: i.notes,
        })),
      }),
    }),
};

export const paymentsApi = {
  process: (locationId: string, orderId: string, body: PaymentBody) =>
    apiFetch<{ payment: unknown; order: OrderRow }>(
      `/locations/${locationId}/orders/${orderId}/payments`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

// ─── Kitchen ────────────────────────────────────────────────────────────────────

export const kitchenApi = {
  tickets: (locationId?: string) => {
    const q = locationId ? `?locationId=${locationId}` : '';
    return apiFetch<{ orders: KitchenTicket[] }>(`/kitchen/tickets${q}`).then(
      (r) => r.orders,
    );
  },
  itemReady: (itemId: string) =>
    apiFetch<{ success: boolean }>(`/kitchen/items/${itemId}/ready`, {
      method: 'PATCH',
    }),
  bump: (orderId: string) =>
    apiFetch<{ success: boolean }>(`/kitchen/orders/${orderId}/bump`, {
      method: 'PATCH',
    }),
};
