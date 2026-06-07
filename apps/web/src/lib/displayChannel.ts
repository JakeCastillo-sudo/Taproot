/**
 * displayChannel — customer-facing display bridge (S8-02).
 *
 * The customer display (/display) runs in a second browser window and mirrors
 * the POS cart in real time over the BroadcastChannel API — pure same-origin
 * browser messaging, no server round-trips.
 *
 * Wiring (initDisplayBroadcast, called once from POSLayout):
 *   - subscribes to the POS Zustand store; whenever the cart / discount
 *     changes → broadcast `cart_update` (or `idle` when empty)
 *   - lastCompletedOrder transitions null→order → broadcast `payment_complete`
 *   - answers `request_state` from a freshly-opened display window with the
 *     current snapshot, so the display is correct even if opened mid-order.
 *
 * Browsers without BroadcastChannel (very old Safari): everything no-ops.
 */

import { usePOSStore } from '../store/pos.store';

const CHANNEL_NAME = 'taproot-customer-display';

/** localStorage key for the customizable idle message (Hardware settings). */
export const DISPLAY_IDLE_MSG_KEY = 'taproot_display_idle_message';

export interface DisplayCartLine {
  name:      string;
  quantity:  number;
  unitPrice: number;    // cents, before modifiers
  modifiers: string[];  // display names (with price deltas pre-formatted)
  lineTotal: number;    // cents
}

export interface DisplayMessage {
  type: 'cart_update' | 'payment_complete' | 'idle' | 'welcome' | 'request_state';
  cart?: {
    items:    DisplayCartLine[];
    subtotal: number;   // cents
    discount: number;   // cents
    tax:      number;   // cents
    total:    number;   // cents
  };
  payment?: {
    method:     string;
    total:      number; // cents
    amountPaid: number; // cents
    changeDue:  number; // cents
  };
  orgName?:      string;
  locationName?: string;
}

const supported = typeof BroadcastChannel !== 'undefined';

export function broadcastToDisplay(msg: DisplayMessage): void {
  if (!supported) return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(msg);
    channel.close();
  } catch { /* non-fatal — display is best-effort */ }
}

export function listenToDisplay(callback: (msg: DisplayMessage) => void): () => void {
  if (!supported) return () => {};
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<DisplayMessage>) => {
    if (e.data && typeof e.data.type === 'string') callback(e.data);
  };
  return () => channel.close();
}

// ─── POS-side broadcaster ─────────────────────────────────────────────────────

function fmtDelta(cents: number): string {
  const sign = cents < 0 ? '−' : '+';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function snapshot(): DisplayMessage {
  const s = usePOSStore.getState();
  if (s.cart.length === 0) {
    return { type: 'idle', orgName: getOrgName() };
  }
  return {
    type: 'cart_update',
    orgName: getOrgName(),
    cart: {
      items: s.cart.map((c) => ({
        name:      c.name,
        quantity:  c.quantity,
        unitPrice: c.unitPrice,
        modifiers: (c.modifiers ?? []).map((m) =>
          m.priceDelta ? `${m.name} ${fmtDelta(m.priceDelta)}` : m.name),
        lineTotal: c.lineTotal,
      })),
      subtotal: s.subtotal(),
      discount: s.discountTotal(),
      tax:      s.taxTotal(),
      total:    s.total(),
    },
  };
}

function getOrgName(): string {
  try { return localStorage.getItem('taproot_org_name') ?? 'Taproot POS'; }
  catch { return 'Taproot POS'; }
}

let _initialized = false;

/**
 * Start mirroring POS state to the customer display. Idempotent — safe to call
 * from POSLayout on every mount. Returns a cleanup (only tears down when called
 * by the original initializer).
 */
export function initDisplayBroadcast(): () => void {
  if (!supported || _initialized) return () => {};
  _initialized = true;

  let prevCart = usePOSStore.getState().cart;
  let prevDiscount = usePOSStore.getState().appliedDiscount;
  let prevCompleted = usePOSStore.getState().lastCompletedOrder;

  const unsubscribe = usePOSStore.subscribe((state) => {
    // Payment completed (null → order)
    if (state.lastCompletedOrder && state.lastCompletedOrder !== prevCompleted) {
      const o = state.lastCompletedOrder;
      broadcastToDisplay({
        type: 'payment_complete',
        orgName: getOrgName(),
        payment: {
          method:     o.paymentMethod,
          total:      o.total,
          amountPaid: o.amountPaid,
          changeDue:  o.changeDue,
        },
      });
    }
    prevCompleted = state.lastCompletedOrder;

    // Cart / discount changed
    if (state.cart !== prevCart || state.appliedDiscount !== prevDiscount) {
      prevCart = state.cart;
      prevDiscount = state.appliedDiscount;
      broadcastToDisplay(snapshot());
    }
  });

  // Answer "what's the current state?" from a freshly-opened display window
  const stopListening = listenToDisplay((msg) => {
    if (msg.type === 'request_state') broadcastToDisplay(snapshot());
  });

  return () => {
    _initialized = false;
    unsubscribe();
    stopListening();
  };
}

/** Open (or focus) the customer display window. */
export function openCustomerDisplay(): void {
  window.open('/display', 'taproot-customer-display', 'width=1024,height=768');
}
