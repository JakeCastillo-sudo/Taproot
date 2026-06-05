/**
 * POS Zustand store — cart state, UI state, computed totals.
 * Persisted to sessionStorage (survives page refresh, clears on tab close).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from '../lib/nanoid';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppliedModifier {
  modifierId: string;
  name:       string;
  priceDelta: number;
}

export interface CartItem {
  id:        string;
  productId: string;
  variantId: string | null;
  name:      string;
  sku:       string;
  quantity:  number;
  unitPrice: number;    // base price BEFORE modifiers
  modifiers: AppliedModifier[];
  notes:     string;
  lineTotal: number;    // (unitPrice + sum(modifiers.priceDelta)) * quantity
}

export type ActiveView = 'checkout' | 'payment' | 'receipt' | 'orders' | 'inventory';

// ─── Receipt state (NOT persisted — in-memory only) ───────────────────────────

export interface LastCompletedOrderItem {
  name:      string;
  quantity:  number;
  unitPrice: number;   // cents (before modifiers)
  modifiers: string[]; // modifier display names
  total:     number;   // line total in cents
}

export interface LastCompletedOrder {
  orderId:       string;
  orderNumber:   string;
  items:         LastCompletedOrderItem[];
  subtotal:      number;   // cents
  taxTotal:      number;   // cents
  tipTotal:      number;   // cents
  total:         number;   // cents
  amountPaid:    number;   // cents
  changeDue:     number;   // cents
  paymentMethod: string;
  cardLast4?:    string;
  cardBrand?:    string;
  employeeName:  string;
  locationName:  string;
  orgName:       string;
  orderType:     string;
  completedAt:   string;   // ISO timestamp
}

export interface POSStore {
  // ── Cart ──────────────────────────────────────────────────────────────────
  cart:                CartItem[];
  customerId:          string | null;
  customerName:        string | null;
  tableId:             string | null;
  orderNotes:          string;
  appliedDiscountIds:  string[];
  appliedDiscount:     { code: string; amount: number } | null;

  // ── UI state ──────────────────────────────────────────────────────────────
  activeView:          ActiveView;
  selectedCategory:    string | null;
  searchQuery:         string;
  isOffline:           boolean;
  pendingSyncCount:    number;
  isModifierSheetOpen: boolean;
  isPaymentSheetOpen:  boolean;
  undoStack:           CartItem[];       // last removed item for Ctrl+Z

  // ── Cart actions ──────────────────────────────────────────────────────────
  addToCart:      (item: Omit<CartItem, 'id' | 'lineTotal'>) => void;
  removeFromCart: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  updateNotes:    (itemId: string, notes: string) => void;
  clearCart:      () => void;
  undoLastRemove: () => void;

  setAppliedDiscount: (d: { code: string; amount: number } | null) => void;
  setCustomer:     (id: string | null, name: string | null) => void;
  setTable:        (id: string | null) => void;
  setOrderNotes:   (notes: string) => void;
  applyDiscount:   (discountId: string) => void;
  removeDiscount:  (discountId: string) => void;

  // ── Receipt (not persisted) ───────────────────────────────────────────────
  lastCompletedOrder:     LastCompletedOrder | null;
  setLastCompletedOrder:  (order: LastCompletedOrder) => void;
  clearLastCompletedOrder:() => void;

  // ── UI actions ────────────────────────────────────────────────────────────
  setView:                (view: ActiveView) => void;
  setCategory:            (categoryId: string | null) => void;
  setSearch:              (query: string) => void;
  setOffline:             (offline: boolean) => void;
  setPendingSyncCount:    (n: number) => void;
  setModifierSheetOpen:   (open: boolean) => void;
  setPaymentSheetOpen:    (open: boolean) => void;

  // ── Computed ──────────────────────────────────────────────────────────────
  subtotal:      () => number;
  discountTotal: () => number;
  taxTotal:      () => number;
  total:         () => number;
  itemCount:     () => number;
}

// ─── Helper: compute lineTotal ────────────────────────────────────────────────

function calcLineTotal(item: Omit<CartItem, 'id' | 'lineTotal'>): number {
  const modSum = item.modifiers.reduce((s, m) => s + m.priceDelta, 0);
  return Math.round((item.unitPrice + modSum) * item.quantity);
}

// ─── Configurable display tax rate ────────────────────────────────────────────
// The authoritative tax is computed server-side from locations.tax_config on order
// create. This module-level rate is only the cart-preview estimate; the Business
// settings page loads the real rate and calls setPosTaxRate(). Default 8.5%.

let _posTaxRate = 0.085;
export function setPosTaxRate(rate: number): void {
  if (isFinite(rate) && rate >= 0) _posTaxRate = rate;
}
export function getPosTaxRate(): number {
  return _posTaxRate;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePOSStore = create<POSStore>()(
  persist(
    immer((set, get) => ({
      // initial state
      cart:                [],
      customerId:          null,
      customerName:        null,
      tableId:             null,
      orderNotes:          '',
      appliedDiscountIds:  [],
      appliedDiscount:     null,
      activeView:          'checkout',
      selectedCategory:    null,
      searchQuery:         '',
      isOffline:           false,
      pendingSyncCount:    0,
      isModifierSheetOpen: false,
      isPaymentSheetOpen:  false,
      undoStack:           [],
      lastCompletedOrder:  null,

      // ── Cart actions ────────────────────────────────────────────────────

      addToCart: (item) =>
        set((s) => {
          // If same product+variant with no modifiers: increment quantity
          const existing = s.cart.find(
            (c) =>
              c.productId === item.productId &&
              c.variantId === item.variantId &&
              c.modifiers.length === 0 &&
              item.modifiers.length === 0,
          );
          if (existing) {
            existing.quantity += item.quantity;
            existing.lineTotal = calcLineTotal(existing);
          } else {
            s.cart.push({
              ...item,
              id:        nanoid(),
              lineTotal: calcLineTotal(item),
            });
          }
        }),

      removeFromCart: (itemId) =>
        set((s) => {
          const idx = s.cart.findIndex((c) => c.id === itemId);
          if (idx !== -1) {
            s.undoStack = [s.cart[idx]];
            s.cart.splice(idx, 1);
          }
        }),

      updateQuantity: (itemId, quantity) =>
        set((s) => {
          if (quantity <= 0) {
            const idx = s.cart.findIndex((c) => c.id === itemId);
            if (idx !== -1) {
              s.undoStack = [s.cart[idx]];
              s.cart.splice(idx, 1);
            }
          } else {
            const item = s.cart.find((c) => c.id === itemId);
            if (item) {
              item.quantity  = quantity;
              item.lineTotal = calcLineTotal(item);
            }
          }
        }),

      updateNotes: (itemId, notes) =>
        set((s) => {
          const item = s.cart.find((c) => c.id === itemId);
          if (item) item.notes = notes;
        }),

      clearCart: () =>
        set((s) => {
          s.cart               = [];
          s.customerId         = null;
          s.customerName       = null;
          s.tableId            = null;
          s.orderNotes         = '';
          s.appliedDiscountIds = [];
          s.appliedDiscount    = null;
          s.undoStack          = [];
        }),

      undoLastRemove: () =>
        set((s) => {
          if (s.undoStack.length > 0) {
            const item = s.undoStack[0];
            s.cart.push({ ...item, id: nanoid() });
            s.undoStack = [];
          }
        }),

      setAppliedDiscount: (d) =>
        set((s) => { s.appliedDiscount = d; }),

      setCustomer: (id, name) =>
        set((s) => { s.customerId = id; s.customerName = name; }),

      setTable: (id) =>
        set((s) => { s.tableId = id; }),

      setOrderNotes: (notes) =>
        set((s) => { s.orderNotes = notes; }),

      applyDiscount: (discountId) =>
        set((s) => {
          if (!s.appliedDiscountIds.includes(discountId)) {
            s.appliedDiscountIds.push(discountId);
          }
        }),

      removeDiscount: (discountId) =>
        set((s) => {
          s.appliedDiscountIds = s.appliedDiscountIds.filter((id) => id !== discountId);
        }),

      // ── Receipt (not persisted) ─────────────────────────────────────────

      setLastCompletedOrder: (order) =>
        set((s) => { s.lastCompletedOrder = order; }),

      clearLastCompletedOrder: () =>
        set((s) => { s.lastCompletedOrder = null; }),

      // ── UI actions ──────────────────────────────────────────────────────

      setView: (view) =>
        set((s) => { s.activeView = view; }),

      setCategory: (categoryId) =>
        set((s) => { s.selectedCategory = categoryId; s.searchQuery = ''; }),

      setSearch: (query) =>
        set((s) => { s.searchQuery = query; s.selectedCategory = null; }),

      setOffline: (offline) =>
        set((s) => { s.isOffline = offline; }),

      setPendingSyncCount: (n) =>
        set((s) => { s.pendingSyncCount = n; }),

      setModifierSheetOpen: (open) =>
        set((s) => { s.isModifierSheetOpen = open; }),

      setPaymentSheetOpen: (open) =>
        set((s) => { s.isPaymentSheetOpen = open; }),

      // ── Computed ────────────────────────────────────────────────────────

      subtotal: () =>
        get().cart.reduce((sum, item) => sum + item.lineTotal, 0),

      discountTotal: () => {
        const d = get().appliedDiscount;
        return d ? Math.min(d.amount, get().subtotal()) : 0;
      },

      taxTotal: () => {
        const sub = get().subtotal();
        return Math.round((sub - get().discountTotal()) * _posTaxRate);
      },

      total: () => {
        const s = get();
        return s.subtotal() - s.discountTotal() + s.taxTotal();
      },

      itemCount: () =>
        get().cart.reduce((sum, item) => sum + item.quantity, 0),
    })),
    {
      name:    'taproot-pos-cart',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist cart data, not UI state or computed
      partialize: (state) => ({
        cart:               state.cart,
        customerId:         state.customerId,
        customerName:       state.customerName,
        tableId:            state.tableId,
        orderNotes:         state.orderNotes,
        appliedDiscountIds: state.appliedDiscountIds,
        appliedDiscount:    state.appliedDiscount,
      }),
    },
  ),
);
