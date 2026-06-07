/**
 * CustomerDisplayPage — /display (S8-02)
 *
 * Full-screen second-screen customer display. Mirrors the POS cart in real
 * time via BroadcastChannel (see lib/displayChannel.ts). No auth — it only
 * receives broadcasts from the POS window in the same browser profile.
 *
 * States: idle (welcome + clock + rotating messages) → cart (live order) →
 * payment complete (thank you, auto-returns to idle after 5s).
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  listenToDisplay, broadcastToDisplay, DISPLAY_IDLE_MSG_KEY,
  type DisplayMessage,
} from '../lib/displayChannel';

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const DEFAULT_MARKETING = [
  'Earn loyalty points on every purchase',
  'Ask about our daily specials',
  'Thank you for dining with us!',
];

type DisplayState =
  | { kind: 'idle' }
  | { kind: 'cart'; cart: NonNullable<DisplayMessage['cart']> }
  | { kind: 'payment'; payment: NonNullable<DisplayMessage['payment']> };

export function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayState>({ kind: 'idle' });
  const [orgName, setOrgName] = useState('Welcome');
  const [now, setNow] = useState(new Date());
  const [msgIdx, setMsgIdx] = useState(0);

  // Customizable idle message (Hardware settings) + defaults
  const [marketing, setMarketing] = useState<string[]>(DEFAULT_MARKETING);

  useEffect(() => {
    try {
      const custom = localStorage.getItem(DISPLAY_IDLE_MSG_KEY);
      if (custom?.trim()) setMarketing([custom.trim(), ...DEFAULT_MARKETING]);
      const org = localStorage.getItem('taproot_org_name');
      if (org) setOrgName(org);
    } catch { /* defaults are fine */ }
  }, []);

  // Listen for POS broadcasts; ask for the current state on mount
  useEffect(() => {
    const stop = listenToDisplay((msg) => {
      if (msg.orgName) setOrgName(msg.orgName);
      if (msg.type === 'cart_update' && msg.cart) {
        setState({ kind: 'cart', cart: msg.cart });
      } else if (msg.type === 'payment_complete' && msg.payment) {
        setState({ kind: 'payment', payment: msg.payment });
      } else if (msg.type === 'idle' || msg.type === 'welcome') {
        setState({ kind: 'idle' });
      }
    });
    broadcastToDisplay({ type: 'request_state' });
    return stop;
  }, []);

  // Payment screen auto-returns to idle after 5 seconds
  useEffect(() => {
    if (state.kind !== 'payment') return;
    const t = setTimeout(() => setState({ kind: 'idle' }), 5000);
    return () => clearTimeout(t);
  }, [state.kind]);

  // Clock + rotating marketing messages
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000 * 30);
    const rotate = setInterval(() => setMsgIdx((i) => i + 1), 8000);
    return () => { clearInterval(clock); clearInterval(rotate); };
  }, []);

  return (
    <div className="h-screen overflow-hidden flex flex-col select-none text-white"
      style={{ background: 'linear-gradient(160deg, #0F6E56 0%, #1D9E75 60%, #2BB587 100%)' }}>
      {state.kind === 'idle' && <IdleScreen orgName={orgName} now={now} message={marketing[msgIdx % marketing.length]} />}
      {state.kind === 'cart' && <CartScreen orgName={orgName} cart={state.cart} />}
      {state.kind === 'payment' && <PaymentScreen payment={state.payment} />}
    </div>
  );
}

// ─── Idle ─────────────────────────────────────────────────────────────────────

function IdleScreen({ orgName, now, message }: { orgName: string; now: Date; message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
      <div className="w-24 h-24 rounded-3xl bg-white/15 flex items-center justify-center mb-6">
        <span className="text-5xl">🌿</span>
      </div>
      <h1 className="text-5xl font-extrabold tracking-tight mb-3">{orgName}</h1>
      <p className="text-2xl font-medium text-white/90 mb-10">Welcome!</p>
      <p className="text-lg text-white/75 max-w-lg min-h-[28px] transition-opacity">{message}</p>
      <p className="mt-12 text-white/60 text-xl tabular-nums">
        {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </p>
    </div>
  );
}

// ─── Cart ─────────────────────────────────────────────────────────────────────

function CartScreen({ orgName, cart }: { orgName: string; cart: NonNullable<DisplayMessage['cart']> }) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden max-w-3xl w-full mx-auto p-8">
      <h1 className="shrink-0 text-2xl font-bold mb-6">{orgName}</h1>

      {/* Items */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-2">
        <table className="w-full text-lg">
          <tbody>
            {cart.items.map((item, i) => (
              <tr key={i} className="align-top">
                <td className="py-2.5 pr-3">
                  <span className="font-semibold">{item.name}</span>
                  {item.modifiers.map((m, j) => (
                    <p key={j} className="text-sm text-white/70 pl-4">{m}</p>
                  ))}
                </td>
                <td className="py-2.5 text-center text-white/80 whitespace-nowrap w-16">× {item.quantity}</td>
                <td className="py-2.5 text-right tabular-nums whitespace-nowrap w-28">{fmt(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="shrink-0 border-t border-white/25 mt-4 pt-4 space-y-1.5 text-lg">
        <Row label="Subtotal" value={fmt(cart.subtotal)} />
        {cart.discount > 0 && <Row label="Discount" value={`−${fmt(cart.discount)}`} />}
        <Row label="Tax" value={fmt(cart.tax)} />
        <div className="border-t border-white/25 my-2" />
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold">TOTAL</span>
          <span className="text-4xl font-extrabold tabular-nums">{fmt(cart.total)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-white/85">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ─── Payment complete ─────────────────────────────────────────────────────────

function PaymentScreen({ payment }: { payment: NonNullable<DisplayMessage['payment']> }) {
  const isCash = payment.method === 'cash';
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
      <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center mb-8 animate-scale-in">
        <Check size={64} className="text-primary" strokeWidth={3} />
      </div>
      <h1 className="text-6xl font-extrabold tracking-tight mb-4">THANK YOU!</h1>
      <p className="text-3xl font-semibold text-white/90">Total: {fmt(payment.total)}</p>
      {isCash && payment.changeDue > 0 && (
        <p className="text-2xl text-white/80 mt-2">Change: {fmt(payment.changeDue)}</p>
      )}
      <p className="text-xl text-white/70 mt-8">Have a great day! 🌿</p>
    </div>
  );
}
