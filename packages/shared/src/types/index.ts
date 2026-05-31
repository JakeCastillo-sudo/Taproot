// ─── Primitives ───────────────────────────────────────────────────────────────
export type UUID = string;
export type Timestamptz = string; // ISO-8601
export type Cents = number;       // integer — smallest currency unit

// ─── JSONB shapes ─────────────────────────────────────────────────────────────
export interface Address { line1: string; line2?: string; city: string; state: string; zip: string; country: string; }
export interface PrinterConnection { type: 'network' | 'usb' | 'bluetooth'; host?: string; port?: number; device?: string; }
export interface VariantOptions { size?: string; color?: string; [key: string]: string | undefined; }
export interface OrderMetadata { source?: 'pos' | 'kiosk' | 'online' | 'phone'; notes?: string; covers?: number; [key: string]: unknown; }
export interface PaymentMetadata { processor?: string; auth_code?: string; last4?: string; brand?: string; [key: string]: unknown; }
export interface LoyaltyConfig { points_per_dollar?: number; redemption_rate?: number; minimum_redemption?: number; [key: string]: unknown; }
export interface OnlineOrderConfig { enabled: boolean; url?: string; lead_time_minutes?: number; }
export interface ReceiptConfig { header?: string; footer?: string; show_tax_breakdown?: boolean; show_logo?: boolean; }
export interface DeviceConfig { [key: string]: unknown; }

// ─── Core tables ──────────────────────────────────────────────────────────────

export interface Organization {
  id: UUID; name: string; slug: string;
  plan: 'trial' | 'starter' | 'growth' | 'enterprise';
  currency: string; timezone: string; locale: string; tax_inclusive: boolean;
  loyalty_config: LoyaltyConfig | null; online_order_config: OnlineOrderConfig | null;
  receipt_config: ReceiptConfig | null; deleted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Location {
  id: UUID; organization_id: UUID; name: string;
  address: Address | null; phone: string | null; timezone: string;
  currency: string; is_active: boolean; settings: Record<string, unknown>;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

// Must match CHECK: ('owner','manager','cashier','kitchen','readonly')
export type EmployeeRole = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'readonly';

export interface Employee {
  id: UUID; organization_id: UUID; email: string;
  first_name: string; last_name: string; role: EmployeeRole;
  totp_enabled: boolean; last_login_at: Timestamptz | null;
  failed_login_attempts: number; locked_until: Timestamptz | null;
  location_ids: UUID[] | null; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Category {
  id: UUID; organization_id: UUID; parent_id: UUID | null;
  name: string; color: string | null; icon: string | null;
  sort_order: number; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Supplier {
  id: UUID; organization_id: UUID; name: string;
  contact_name: string | null; email: string | null; phone: string | null;
  address: Address | null; payment_terms: string | null; lead_time_days: number;
  notes: string | null; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

// product_type CHECK: standard|recipe|bundle|service|weight
// unit_of_measure CHECK: each|g|kg|ml|l|oz|lb|m|ft
export type ProductType = 'standard' | 'recipe' | 'bundle' | 'service' | 'weight';
export type UnitOfMeasure = 'each' | 'g' | 'kg' | 'ml' | 'l' | 'oz' | 'lb' | 'm' | 'ft';

export interface Product {
  id: UUID; organization_id: UUID; category_id: UUID | null; supplier_id: UUID | null;
  name: string; description: string | null; sku: string | null; barcode: string | null;
  product_type: ProductType; unit_of_measure: UnitOfMeasure;
  cost_price: number; track_inventory: boolean; is_active: boolean;
  images: unknown[]; tags: string[] | null; metadata: Record<string, unknown>;
  created_by: UUID | null; deleted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface ProductVariant {
  id: UUID; product_id: UUID; organization_id: UUID;
  name: string; sku: string | null; barcode: string | null;
  options: VariantOptions; cost_price: number;
  is_active: boolean; sort_order: number;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

// DB table: product_prices (not prices)
export interface ProductPrice {
  id: UUID; variant_id: UUID; location_id: UUID | null;
  price: number; compare_at_price: number | null; currency: string;
  is_active: boolean; effective_from: Timestamptz; effective_until: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface TaxRate {
  id: UUID; organization_id: UUID; name: string; rate: number;
  applies_to: string; is_active: boolean;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface ModifierGroup {
  id: UUID; organization_id: UUID; name: string;
  selection_type: 'single' | 'multiple' | 'required_single' | 'required_multiple';
  min_selections: number; max_selections: number | null;
  sort_order: number; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Modifier {
  id: UUID; group_id: UUID; name: string;
  price_delta: number; cost_delta: number;
  is_default: boolean; sort_order: number; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

// DB table: recipes — keyed by product_id (not variant_id)
export interface Recipe {
  id: UUID; product_id: UUID; organization_id: UUID;
  name: string; yield_factor: number; notes: string | null;
  version: number; is_active: boolean;
  created_by: UUID | null; deleted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

// DB table: recipe_lines — uses ingredient_product_id + ingredient_variant_id
export interface RecipeLine {
  id: UUID; recipe_id: UUID;
  ingredient_product_id: UUID; ingredient_variant_id: UUID | null;
  quantity: number; unit: string; waste_factor: number;
  notes: string | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface InventoryLevel {
  id: UUID; organization_id: UUID; location_id: UUID;
  product_id: UUID; variant_id: UUID | null;
  quantity_on_hand: number; quantity_on_order: number;
  reorder_point: number | null; reorder_quantity: number | null;
  max_stock_level: number | null; last_counted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

// movement_type CHECK: sale|return|waste|adjustment|transfer_in|transfer_out|po_receipt|opening_count|cycle_count
export type InventoryMovementType =
  | 'sale' | 'return' | 'waste' | 'adjustment'
  | 'transfer_in' | 'transfer_out' | 'po_receipt'
  | 'opening_count' | 'cycle_count';

export interface InventoryMovement {
  id: UUID; organization_id: UUID; location_id: UUID;
  product_id: UUID; variant_id: UUID | null;
  movement_type: InventoryMovementType;
  quantity_delta: number; quantity_before: number; quantity_after: number;
  reference_type: string | null; reference_id: UUID | null;
  employee_id: UUID | null; notes: string | null;
  metadata: Record<string, unknown>; created_at: Timestamptz;
}

export interface PurchaseOrder {
  id: UUID; organization_id: UUID; location_id: UUID; supplier_id: UUID | null;
  po_number: string;
  status: 'draft' | 'sent' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';
  expected_delivery_date: string | null; notes: string | null;
  subtotal: number; tax_total: number; total: number;
  sent_at: Timestamptz | null; received_at: Timestamptz | null;
  created_by: UUID | null; deleted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface PurchaseOrderLine {
  id: UUID; purchase_order_id: UUID; product_id: UUID; variant_id: UUID | null;
  quantity_ordered: number; quantity_received: number;
  unit_cost: number; total_cost: number;
  received_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface VarianceReport {
  id: UUID; organization_id: UUID; location_id: UUID;
  period_start: Timestamptz; period_end: Timestamptz;
  status: 'draft' | 'finalized';
  generated_by: UUID | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface VarianceReportLine {
  id: UUID; report_id: UUID; product_id: UUID; variant_id: UUID | null;
  opening_quantity: number; closing_quantity: number; received_quantity: number;
  theoretical_usage: number; actual_usage: number;
  variance_delta: number; variance_pct: number;
  is_flagged: boolean; flag_threshold: number | null;
  ai_suggested_causes: unknown[]; created_at: Timestamptz;
}

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning';

export interface TableRecord {
  id: UUID; location_id: UUID; organization_id: UUID;
  name: string; section: string | null; seats: number;
  position_x: number; position_y: number; shape: string;
  width: number; height: number; is_active: boolean;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Order {
  id: UUID; organization_id: UUID; location_id: UUID;
  customer_id: UUID | null; employee_id: UUID;
  order_number: string; status: string; order_type: string;
  table_id: UUID | null; subtotal: number; discount_total: number;
  tax_total: number; tip_total: number; total: number;
  amount_paid: number; change_due: number; notes: string | null;
  source: string; fulfilled_at: Timestamptz | null;
  voided_at: Timestamptz | null; void_reason: string | null;
  metadata: Record<string, unknown>; created_at: Timestamptz; updated_at: Timestamptz;
}

// DB table: order_line_items (not order_items)
export interface OrderLineItem {
  id: UUID; order_id: UUID; product_id: UUID; variant_id: UUID | null;
  name: string; sku: string | null; quantity: number;
  unit_price: number; cost_price: number;
  discount_amount: number; tax_amount: number; total: number;
  modifiers: AppliedModifier[];
  notes: string | null; voided_at: Timestamptz | null; void_reason: string | null;
  employee_id: UUID | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface AppliedModifier {
  modifierId: string;
  name: string;
  priceDelta: number;
  ingredientOverrides?: Array<{
    ingredientProductId: string;
    quantityDelta: number;
  }>;
}

export type OrderStatus = 'open' | 'in_progress' | 'completed' | 'refunded' | 'partially_refunded' | 'voided' | 'parked';
export type OrderType = 'in_store' | 'takeout' | 'delivery' | 'table_service' | 'online' | 'phone';
export type PaymentMethod = 'cash' | 'credit_card' | 'debit_card' | 'apple_pay' | 'google_pay' | 'gift_card' | 'account_credit' | 'bnpl' | 'check' | 'other';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'partially_refunded' | 'offline_queued';
export type DiscountType = 'percentage' | 'fixed_amount' | 'bogo' | 'free_item';
export type LoyaltyTier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum';
export type LoyaltyTransactionType = 'earn' | 'redeem' | 'adjust' | 'expire' | 'migrate';
export type GiftCardTransactionType = 'issue' | 'reload' | 'redemption' | 'refund' | 'adjustment';
export type OrderEventType =
  | 'order:created' | 'order:updated' | 'order:completed' | 'order:voided'
  | 'order:parked' | 'order:resumed' | 'order:item:added' | 'order:item:voided'
  | 'order:fired' | 'inventory:low_stock' | 'inventory:stockout_imminent';

export interface Customer {
  id: UUID; organization_id: UUID;
  first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null;
  loyalty_points: number; loyalty_tier: LoyaltyTier;
  account_credit: number; total_spend: number;
  visit_count: number; last_visit_at: Timestamptz | null;
  tags: string[] | null;
  notes: string | null; merged_into_id: UUID | null;
  deleted_at: Timestamptz | null; created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Payment {
  id: UUID; order_id: UUID;
  payment_method: PaymentMethod; amount: number; tip_amount: number;
  status: PaymentStatus;
  processor: string | null; processor_payment_id: string | null;
  processor_response: Record<string, unknown> | null;
  card_last4: string | null; card_brand: string | null;
  offline_queued_at: Timestamptz | null; offline_synced_at: Timestamptz | null;
  refunded_amount: number;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface Discount {
  id: UUID; organization_id: UUID;
  name: string; code: string | null;
  discount_type: DiscountType; value: number;
  applies_to: 'order' | 'category' | 'product'; applies_to_ids: UUID[] | null;
  minimum_order_amount: number | null; maximum_discount_amount: number | null;
  usage_limit: number | null; usage_count: number; per_customer_limit: number | null;
  stackable: boolean; priority: number;
  active_from: Timestamptz; active_until: Timestamptz | null;
  customer_tags: string[] | null; is_active: boolean;
  created_by: UUID | null; deleted_at: Timestamptz | null;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface AppliedDiscount {
  id: UUID; order_id: UUID; line_item_id: UUID | null; discount_id: UUID | null;
  name: string; discount_type: DiscountType; value: number; amount_saved: number;
  created_at: Timestamptz;
}

export interface GiftCard {
  id: UUID; organization_id: UUID; code: string;
  initial_balance: number; current_balance: number; currency: string;
  issued_to_customer_id: UUID | null; issued_by_employee_id: UUID | null;
  issued_at: Timestamptz; expires_at: Timestamptz | null; is_active: boolean;
  created_at: Timestamptz; updated_at: Timestamptz;
}

export interface LoyaltyTransaction {
  id: UUID; organization_id: UUID; customer_id: UUID; order_id: UUID | null;
  transaction_type: LoyaltyTransactionType;
  points_delta: number; points_before: number; points_after: number;
  notes: string | null; created_at: Timestamptz;
}

export interface OrderEvent {
  type: OrderEventType;
  locationId: string;
  orderId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface TipDistributionReport {
  locationId: string; periodStart: string; periodEnd: string;
  distributionMethod: string; totalTips: number;
  allocations: Array<{ employeeId: string; employeeName: string; amount: number; percentage: number }>;
}

export interface AuditLog {
  id: UUID; organization_id: UUID | null; actor_id: UUID | null;
  actor_type: 'employee' | 'system' | 'api'; action: string;
  resource_type: string | null; resource_id: UUID | null;
  before_state: Record<string, unknown> | null; after_state: Record<string, unknown> | null;
  ip_address: string | null; user_agent: string | null;
  metadata: Record<string, unknown>; created_at: Timestamptz;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> { data: T[]; total: number; page: number; per_page: number; }
export interface ApiError { code: string; message: string; details?: unknown; }

// ─── Service DTOs ─────────────────────────────────────────────────────────────

export interface ProductWithRelations extends Product {
  variants: ProductVariant[];
  prices: ProductPrice[];
  recipe: (Recipe & { lines: RecipeLine[] }) | null;
}

export interface DepletionResult {
  ingredientProductId: string;
  ingredientVariantId: string | null;
  depletionQty: number;
  unit: string;
}

export interface OrderWithRelations extends Order {
  lineItems: OrderLineItem[];
  payments: Payment[];
  discounts: AppliedDiscount[];
  customer: Customer | null;
}

export interface StockoutForecast {
  productId: string;
  productName: string;
  sku: string | null;
  currentOnHand: number;
  unit: UnitOfMeasure;
  burnRatePerHour: number;
  hoursUntilStockout: number | null;
  estimatedStockoutAt: Date | null;
  reorderPointReached: boolean;
  hoursUntilReorderPoint: number | null;
  urgency: 'critical' | 'warning' | 'ok';
  confidence: 'high' | 'medium' | 'low';
  dataPoints: number;
}
