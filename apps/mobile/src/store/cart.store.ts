/**
 * Cart store — a minimal version of the web pos.store for the mobile foundation.
 *
 * Modifiers are intentionally NOT handled here yet: tapping a product fast-adds at
 * its default price (web parity for the no-modifier path). Order totals (tax,
 * discounts) are authoritative on the server — the local `subtotal` is preview only.
 */
import { create } from 'zustand';

export interface CartItem {
  /** Stable key for list rendering (productId for now — one line per product). */
  key: string;
  productId: string;
  name: string;
  unitPrice: number; // cents
  quantity: number;
}

interface CartState {
  items: CartItem[];
  add: (p: { productId: string; name: string; unitPrice: number }) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],

  add: (p) =>
    set((state) => {
      const existing = state.items.find((i) => i.key === p.productId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.key === p.productId ? { ...i, quantity: i.quantity + 1 } : i,
          ),
        };
      }
      return {
        items: [
          ...state.items,
          { key: p.productId, productId: p.productId, name: p.name, unitPrice: p.unitPrice, quantity: 1 },
        ],
      };
    }),

  inc: (key) =>
    set((state) => ({
      items: state.items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i)),
    })),

  dec: (key) =>
    set((state) => ({
      items: state.items
        .map((i) => (i.key === key ? { ...i, quantity: i.quantity - 1 } : i))
        .filter((i) => i.quantity > 0),
    })),

  remove: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),

  clear: () => set({ items: [] }),
}));

/** Cart subtotal in cents (preview — server computes tax/discounts). */
export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}
