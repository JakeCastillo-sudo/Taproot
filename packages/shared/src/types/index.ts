// ─── Shared primitive aliases ────────────────────────────────────────────────
export type UUID = string;
export type Timestamptz = string; // ISO-8601
export type Cents = number;       // integer — amount stored in smallest currency unit

// ─── JSONB field shapes ──────────────────────────────────────────────────────
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PrinterConnection {
  type: 'network' | 'usb' | 'bluetooth';
  host?: string;
  port?: number;
  device?: string;
}

export interface VariantOptions {
  size?: string;
  color?: string;
  [key: string]: string | undefined;
}

export interface OrderMetadata {
  source?: 'pos' | 'kiosk' | 'online' | 'phone';
  notes?: string;
  covers?: number;
  [key: string]: unknown;
}

export interface PaymentMetadata {
  processor?: string;
  auth_code?: string;
  last4?: string;
  brand?: string;
  [key: string]: unknown;
}

export interface LoyaltyConfig {
  points_per_dollar?: number;
  redemption_rate?: number;
  minimum_redemption?: number;
  [key: string]: unknown;
}

export interface OnlineOrderConfig {
  enabled: boolean;
  url?: string;
  lead_time_minutes?: number;
}

export interface ReceiptConfig {
  header?: string;
  footer?: string;
  show_tax_breakdown?: boolean;
  show_logo?: boolean;
}

export interface DeviceConfig {
  [key: string]: unknown;
}

// ─── Table row types ──────────────────────────────────────────────────────────

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  currency: string;
  timezone: string;
  locale: string;
  tax_inclusive: boolean;
  loyalty_config: LoyaltyConfig | null;
  online_order_config: OnlineOrderConfig | null;
  receipt_config: ReceiptConfig | null;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Location {
  id: UUID;
  organization_id: UUID;
  name: string;
  slug: string;
  address: Address | null;
  phone: string | null;
  timezone: string;
  is_active: boolean;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type EmployeeRole = 'owner' | 'manager' | 'cashier' | 'server' | 'kitchen' | 'bartender';

export interface Employee {
  id: UUID;
  organization_id: UUID;
  email: string;
  first_name: string;
  last_name: string;
  role: EmployeeRole;
  is_active: boolean;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface EmployeeSafe extends Omit<Employee, never> {
  // password_hash, pin_hash, totp_secret are excluded from the employees_safe view
}

export interface EmployeeLocation {
  employee_id: UUID;
  location_id: UUID;
  created_at: Timestamptz;
}

export interface Category {
  id: UUID;
  organization_id: UUID;
  parent_id: UUID | null;
  name: string;
  slug: string;
  sort_order: number;
  color: string | null;
  is_active: boolean;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Product {
  id: UUID;
  organization_id: UUID;
  category_id: UUID | null;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  track_inventory: boolean;
  is_active: boolean;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface ProductVariant {
  id: UUID;
  product_id: UUID;
  sku: string | null;
  name: string;
  options: VariantOptions;
  barcode: string | null;
  weight_grams: number | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Price {
  id: UUID;
  organization_id: UUID;
  variant_id: UUID;
  location_id: UUID | null;
  amount: Cents;
  currency: string;
  valid_from: Timestamptz | null;
  valid_until: Timestamptz | null;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface TaxRate {
  id: UUID;
  organization_id: UUID;
  name: string;
  rate: number;
  applies_to: string;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface ProductTaxRate {
  product_id: UUID;
  tax_rate_id: UUID;
}

export interface ModifierGroup {
  id: UUID;
  organization_id: UUID;
  name: string;
  selection_type: 'single' | 'multiple';
  min_selections: number;
  max_selections: number | null;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Modifier {
  id: UUID;
  group_id: UUID;
  name: string;
  price_delta: Cents;
  is_active: boolean;
  sort_order: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface ProductModifierGroup {
  product_id: UUID;
  group_id: UUID;
  sort_order: number;
}

export interface Ingredient {
  id: UUID;
  organization_id: UUID;
  name: string;
  unit: string;
  cost_per_unit: Cents;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Recipe {
  id: UUID;
  organization_id: UUID;
  variant_id: UUID;
  name: string;
  yield_quantity: number;
  yield_unit: string;
  notes: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface RecipeLine {
  id: UUID;
  recipe_id: UUID;
  ingredient_id: UUID;
  quantity: number;
  unit: string;
  notes: string | null;
  created_at: Timestamptz;
}

export interface InventoryLevel {
  id: UUID;
  location_id: UUID;
  product_id: UUID;
  variant_id: UUID | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  reorder_point: number | null;
  reorder_quantity: number | null;
  updated_at: Timestamptz;
}

export type InventoryMovementType =
  | 'sale' | 'return' | 'purchase' | 'waste' | 'transfer_in'
  | 'transfer_out' | 'adjustment' | 'initial';

export interface InventoryMovement {
  id: UUID;
  location_id: UUID;
  product_id: UUID;
  variant_id: UUID | null;
  employee_id: UUID | null;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  reason: string | null;
  reference_id: UUID | null;
  created_at: Timestamptz;
}

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export interface Table {
  id: UUID;
  location_id: UUID;
  name: string;
  capacity: number | null;
  section: string | null;
  status: TableStatus;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type OrderType = 'dine_in' | 'takeout' | 'delivery' | 'online';
export type OrderStatus =
  | 'open' | 'submitted' | 'in_progress' | 'ready' | 'completed' | 'cancelled' | 'refunded';

export interface Order {
  id: UUID;
  organization_id: UUID;
  location_id: UUID;
  employee_id: UUID;
  customer_id: UUID | null;
  table_id: UUID | null;
  order_number: string | null;
  order_type: OrderType;
  status: OrderStatus;
  subtotal: Cents;
  tax_total: Cents;
  discount_total: Cents;
  tip_amount: Cents;
  total: Cents;
  notes: string | null;
  metadata: OrderMetadata | null;
  completed_at: Timestamptz | null;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export type OrderItemStatus = 'pending' | 'sent' | 'in_progress' | 'ready' | 'served' | 'voided';

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  variant_id: UUID;
  name_snapshot: string;
  unit_price: Cents;
  quantity: number;
  discount_amount: Cents;
  tax_amount: Cents;
  line_total: Cents;
  status: OrderItemStatus;
  notes: string | null;
  void_reason: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface OrderItemModifier {
  id: UUID;
  order_item_id: UUID;
  modifier_id: UUID | null;
  name_snapshot: string;
  price_delta: Cents;
  created_at: Timestamptz;
}

export type PaymentMethod = 'cash' | 'credit' | 'debit' | 'gift_card' | 'loyalty' | 'external';
export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'voided' | 'refunded' | 'failed';

export interface Payment {
  id: UUID;
  order_id: UUID;
  employee_id: UUID | null;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Cents;
  tip_amount: Cents;
  reference: string | null;
  metadata: PaymentMetadata | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Discount {
  id: UUID;
  organization_id: UUID;
  name: string;
  code: string | null;
  discount_type: 'percent' | 'fixed';
  value: number;
  applies_to: 'order' | 'item' | 'category';
  minimum_order_amount: Cents | null;
  max_uses: number | null;
  used_count: number;
  valid_from: Timestamptz | null;
  valid_until: Timestamptz | null;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface OrderDiscount {
  id: UUID;
  order_id: UUID;
  discount_id: UUID | null;
  name_snapshot: string;
  discount_type: 'percent' | 'fixed';
  value: number;
  amount_applied: Cents;
  created_at: Timestamptz;
}

export interface Customer {
  id: UUID;
  organization_id: UUID;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  loyalty_points: number;
  notes: string | null;
  merged_into_id: UUID | null;
  deleted_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface LoyaltyTransaction {
  id: UUID;
  customer_id: UUID;
  order_id: UUID | null;
  employee_id: UUID | null;
  points_delta: number;
  reason: string;
  created_at: Timestamptz;
}

export interface GiftCard {
  id: UUID;
  organization_id: UUID;
  code: string;
  balance: Cents;
  initial_balance: Cents;
  is_active: boolean;
  expires_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface GiftCardTransaction {
  id: UUID;
  gift_card_id: UUID;
  order_id: UUID | null;
  employee_id: UUID | null;
  amount_delta: Cents;
  reason: string;
  created_at: Timestamptz;
}

export interface Printer {
  id: UUID;
  location_id: UUID;
  name: string;
  type: 'receipt' | 'kitchen' | 'label';
  connection: PrinterConnection;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface Device {
  id: UUID;
  location_id: UUID;
  name: string;
  device_type: 'pos' | 'kiosk' | 'kitchen_display' | 'mobile';
  config: DeviceConfig | null;
  last_seen_at: Timestamptz | null;
  is_active: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

export interface OrganizationOrderSequence {
  organization_id: UUID;
  year: number;
  counter: number;
}

export interface AuditLog {
  id: UUID;
  organization_id: UUID | null;
  actor_id: UUID | null;
  actor_type: 'employee' | 'system' | 'api';
  action: string;
  resource_type: string;
  resource_id: UUID | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Timestamptz;
}

// ─── API response helpers ─────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
