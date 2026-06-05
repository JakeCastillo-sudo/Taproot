/**
 * MobileCart — floating cart FAB + bottom-sheet order summary for mobile.
 *
 * Shows only on screens narrower than `md` (768px).
 * Floating button: item count badge + total price.
 * Bottom sheet: cart items, discount button, totals, Charge CTA.
 */

import React from 'react';
import { ShoppingCart, Tag, AlertTriangle } from 'lucide-react';
import { usePOSStore, getPosTaxRate, type CartItem } from '../../store/pos.store';
import { BottomSheet, BottomSheetFooter } from '../ui/BottomSheet';
import { useHaptic } from '../../hooks/useHaptic';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── CartLine (mobile) ─────────────────────────────────────────────────────────

function CartLine({ item }: { item: CartItem }) {
  const updateQuantity = usePOSStore((s) => s.updateQuantity);
  const removeFromCart = usePOSStore((s) => s.removeFromCart);

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
        {item.modifiers.length > 0 && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {item.modifiers.map((m) => m.name).join(', ')}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">{fmt(item.unitPrice)} each</p>
      </div>

      {/* Qty stepper */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold transition-colors"
          aria-label="Decrease"
        >−</button>
        <span className="w-6 text-center text-sm font-semibold text-gray-900">{item.quantity}</span>
        <button
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-lg font-bold transition-colors"
          aria-label="Increase"
        >+</button>
      </div>

      {/* Line total */}
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-gray-900">{fmt(item.lineTotal)}</p>
        <button
          onClick={() => removeFromCart(item.id)}
          className="mt-1 text-[11px] text-red-400 hover:text-red-600 transition-colors"
          aria-label={`Remove ${item.name}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ── MobileCart ────────────────────────────────────────────────────────────────

interface MobileCartProps {
  open:    boolean;
  onOpen:  () => void;
  onClose: () => void;
}

export function MobileCart({ open, onOpen, onClose }: MobileCartProps) {
  const haptic = useHaptic();

  const {
    cart,
    clearCart,
    setPaymentSheetOpen,
    subtotal,
    taxTotal,
    total,
    discountTotal,
    itemCount,
  } = usePOSStore();

  const cnt  = itemCount();
  const sub  = subtotal();
  const disc = discountTotal();
  const tax  = taxTotal();
  const ttl  = total();

  // ── Floating cart button ──────────────────────────────────────────────────
  if (cnt === 0 && !open) return null;

  return (
    <>
      {/* Floating cart FAB — only when cart has items and sheet is closed */}
      {cnt > 0 && !open && (
        <button
          className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-40
                     flex items-center gap-3 bg-primary text-white
                     px-6 py-3.5 rounded-full shadow-lg
                     active:scale-95 transition-all animate-bounce-in"
          onClick={() => { haptic.light(); onOpen(); }}
          aria-label={`View cart — ${cnt} item${cnt !== 1 ? 's' : ''}, ${fmt(ttl)}`}
        >
          <span className="relative">
            <ShoppingCart size={18} />
            {/* Badge */}
            <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] bg-white text-primary rounded-full text-[10px] font-bold flex items-center justify-center px-0.5 shadow">
              {cnt}
            </span>
          </span>
          <span className="font-semibold">{cnt} item{cnt !== 1 ? 's' : ''}</span>
          <span className="text-white/70">·</span>
          <span className="font-bold">{fmt(ttl)}</span>
        </button>
      )}

      {/* Bottom sheet */}
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Your order"
        headerRight={
          cnt > 0 ? (
            <button
              onClick={() => {
                haptic.medium();
                if (window.confirm('Clear order?')) clearCart();
              }}
              className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 transition-colors"
            >
              <AlertTriangle size={11} /> Clear
            </button>
          ) : undefined
        }
      >
        {/* Cart items */}
        <div className="px-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingCart size={32} className="text-gray-200 mb-3" />
              <p className="text-sm text-gray-400">Cart is empty</p>
            </div>
          ) : (
            cart.map((item) => <CartLine key={item.id} item={item} />)
          )}
        </div>

        {/* Totals */}
        {cart.length > 0 && (
          <div className="px-4 pb-4 pt-3 border-t border-gray-50 mt-1 space-y-2">
            <button className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark transition-colors">
              <Tag size={11} /> Add discount
            </button>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span>{fmt(sub)}</span>
              </div>
              {disc > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span><span>−{fmt(disc)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>Tax ({(getPosTaxRate() * 100).toFixed(getPosTaxRate() * 100 % 1 === 0 ? 0 : 2)}%)</span><span>{fmt(tax)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100 text-base">
                <span>Total</span><span>{fmt(ttl)}</span>
              </div>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Charge CTA — rendered outside BottomSheet scroll area */}
      {open && cart.length > 0 && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-[51] bg-white border-t border-gray-100 px-4 py-3 space-y-2"
             style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => {
              haptic.success();
              onClose();
              setPaymentSheetOpen(true);
            }}
            className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark active:scale-[0.98] transition-all shadow-sm"
          >
            Charge {fmt(ttl)}
          </button>
        </div>
      )}
    </>
  );
}
