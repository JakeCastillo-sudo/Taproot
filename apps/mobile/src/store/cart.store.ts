/**
 * Cart store — mirrors the web pos.store cart model.
 *
 * A line carries a base product price plus any selected modifiers (each with a
 * cents priceDelta). Identical product+modifier combinations stack onto one line;
 * different modifier choices on the same product become separate lines. Order
 * totals (tax/discounts) remain authoritative on the server — `subtotal` is a
 * client-side preview only.
 */
import { create } from 'zustand';

export interface CartModifier {
  modifierId: string;
  name: string;
  priceDelta: number; // cents, may be negative
}

export interface CartItem {
  /** Stable key = productId + sorted modifier ids, so identical combos stack. */
  key: string;
  productId: string;
  name: string;
  basePrice: number; // cents
  modifiers: CartModifier[];
  quantity: number;
}

/** Unit price of a line including its modifiers (cents). */
export function lineUnitPrice(item: CartItem): number {
  return item.basePrice + item.modifiers.reduce((s, m) => s + m.priceDelta, 0);
}

/** Total for a line (unit incl. modifiers × quantity). */
export function lineTotal(item: CartItem): number {
  return lineUnitPrice(item) * item.quantity;
}

function makeKey(productId: string, modifiers: CartModifier[]): string {
  const ids = modifiers.map((m) => m.modifierId).sort();
  return ids.length ? `${productId}::${ids.join(',')}` : productId;
}

interface CartState {
  items: CartItem[];
  add: (
    p: {
      productId: string;
      name: string;
      basePrice: number;
      modifiers?: CartModifier[];
    },
    quantity?: number,
  ) => void;
  /** Replace a line's modifiers + quantity (used by cart "edit"). Re-keys the line
   *  and merges into an existing identical-combo line if one results. */
  updateLine: (oldKey: string, modifiers: CartModifier[], quantity: number) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],

  add: (p, quantity = 1) =>
    set((state) => {
      const modifiers = p.modifiers ?? [];
      const key = makeKey(p.productId, modifiers);
      const existing = state.items.find((i) => i.key === key);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.key === key ? { ...i, quantity: i.quantity + quantity } : i,
          ),
        };
      }
      return {
        items: [
          ...state.items,
          { key, productId: p.productId, name: p.name, basePrice: p.basePrice, modifiers, quantity },
        ],
      };
    }),

  updateLine: (oldKey, modifiers, quantity) =>
    set((state) => {
      const old = state.items.find((i) => i.key === oldKey);
      if (!old) return {};
      const rest = state.items.filter((i) => i.key !== oldKey);
      const newKey = makeKey(old.productId, modifiers);
      const merged = rest.find((i) => i.key === newKey);
      if (merged) {
        return {
          items: rest.map((i) =>
            i.key === newKey ? { ...i, quantity: i.quantity + quantity } : i,
          ),
        };
      }
      return { items: [...rest, { ...old, key: newKey, modifiers, quantity }] };
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
  return items.reduce((sum, i) => sum + lineTotal(i), 0);
}
