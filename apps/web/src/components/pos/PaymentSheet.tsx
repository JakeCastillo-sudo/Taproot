/**
 * Full-screen payment overlay — 4 steps:
 *  1. Tip selection
 *  2. Payment method
 *  3. Processing
 *  4. Success / Error
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, CreditCard, Banknote, Gift, SplitSquareHorizontal,
  Wallet, CheckCircle, AlertCircle, RotateCcw, Printer,
  Mail, MessageSquare, ChevronRight, FlaskConical,
} from 'lucide-react';
import { clsx } from 'clsx';
import { usePOSStore, type LastCompletedOrder } from '../../store/pos.store';
import { orders as ordersApi, payments as paymentsApi } from '../../lib/api';
import { showToast } from '../ui/Toast';
import { TOKEN_KEY, USER_KEY } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'tip' | 'method' | 'processing' | 'success' | 'error';
type Method = 'cash' | 'card' | 'gift_card' | 'account_credit' | 'split';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getLocationId(): string {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return (payload as { locationIds?: string[] }).locationIds?.[0] ?? '';
  } catch {
    return '';
  }
}

/** Read employee/org display names from localStorage for the receipt. */
function getUserInfo(): { employeeName: string; locationName: string; orgName: string } {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const u   = raw ? JSON.parse(raw) as { firstName?: string; lastName?: string } : null;
    return {
      employeeName: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : 'Staff',
      locationName: localStorage.getItem('taproot_location_name') ?? 'Main Location',
      orgName:      localStorage.getItem('taproot_org_name')      ?? 'Taproot POS',
    };
  } catch {
    return { employeeName: 'Staff', locationName: 'Main Location', orgName: 'Taproot POS' };
  }
}

// ─── Tip Preset Row ───────────────────────────────────────────────────────────

const TIP_PRESETS = [15, 18, 20, 25];

interface TipSelectorProps {
  subtotal:    number;
  tip:         number;
  onTipChange: (tip: number) => void;
}

function TipSelector({ subtotal, tip, onTipChange }: TipSelectorProps) {
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const setPreset = (pct: number) => {
    setShowCustom(false);
    setCustom('');
    onTipChange(Math.round(subtotal * pct / 100));
  };

  const handleCustom = (val: string) => {
    setCustom(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0) onTipChange(Math.round(n * 100));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {TIP_PRESETS.map((pct) => {
          const amount = Math.round(subtotal * pct / 100);
          const active = !showCustom && tip === amount;
          return (
            <button
              key={pct}
              onClick={() => setPreset(pct)}
              className={clsx(
                'flex flex-col items-center py-3 rounded-md border text-sm font-medium transition-all min-h-tap',
                active
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100',
              )}
            >
              <span className="font-semibold">{pct}%</span>
              <span className={clsx('text-[11px] mt-0.5', active ? 'text-white/80' : 'text-gray-400')}>
                {fmt(amount)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { setShowCustom(true); onTipChange(0); setCustom(''); }}
          className={clsx(
            'flex-1 py-2.5 rounded-md border text-sm font-medium transition-all',
            showCustom
              ? 'bg-primary-light border-primary/30 text-primary-dark'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100',
          )}
        >
          Custom
        </button>
        <button
          onClick={() => { setShowCustom(false); setCustom(''); onTipChange(0); }}
          className={clsx(
            'flex-1 py-2.5 rounded-md border text-sm font-medium transition-all',
            !showCustom && tip === 0
              ? 'bg-primary-light border-primary/30 text-primary-dark'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100',
          )}
        >
          No tip
        </button>
      </div>

      {showCustom && (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">$</span>
          <input
            type="number"
            inputMode="decimal"
            value={custom}
            onChange={(e) => handleCustom(e.target.value)}
            placeholder="0.00"
            className="w-full pl-7 pr-3 py-2.5 border border-primary/30 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-primary-light/30"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

// ─── Cash keypad ──────────────────────────────────────────────────────────────

function CashKeypad({ total, onTendered }: { total: number; onTendered: (v: number) => void }) {
  const [value, setValue] = useState('');
  const tendered = parseFloat(value) * 100 || 0;
  const change   = tendered - total;

  const press = (k: string) => {
    if (k === 'DEL') { setValue((v) => v.slice(0, -1)); return; }
    if (k === '.' && value.includes('.')) return;
    setValue((v) => v + k);
  };

  const KEYS = ['1','2','3','4','5','6','7','8','9','.','0','DEL'];

  // Quick-amount presets
  const QUICK = [
    Math.ceil(total / 100) * 100,
    Math.ceil(total / 500) * 500,
    Math.ceil(total / 1000) * 1000,
    Math.ceil(total / 2000) * 2000,
  ].filter((v, i, a) => v !== a[i - 1]);

  return (
    <div className="space-y-4">
      {/* Quick amounts */}
      <div className="grid grid-cols-4 gap-2">
        {QUICK.slice(0, 4).map((q) => (
          <button
            key={q}
            onClick={() => { setValue(String(q / 100)); onTendered(q); }}
            className="py-2 rounded-md bg-gray-100 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {fmt(q)}
          </button>
        ))}
      </div>

      {/* Display */}
      <div className="text-center py-3 bg-gray-50 rounded-md border border-gray-200">
        <div className="text-2xl font-bold text-gray-900">{value ? `$${value}` : '—'}</div>
        {change >= 0 && tendered > 0 && (
          <div className="text-sm text-green-600 font-medium mt-1">Change: {fmt(change)}</div>
        )}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            onClick={() => { press(k); if (k !== 'DEL') onTendered(parseFloat(value + (k !== 'DEL' ? k : '')) * 100 || 0); }}
            className="h-12 rounded-md bg-gray-100 text-base font-medium text-gray-800 hover:bg-gray-200 active:scale-95 transition-all"
          >
            {k === 'DEL' ? '⌫' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { onClose: () => void }

export function PaymentSheet({ onClose }: Props) {
  const navigate = useNavigate();
  const { cart, subtotal, taxTotal, total, itemCount, clearCart, setPaymentSheetOpen,
          customerId, orderNotes, setLastCompletedOrder } = usePOSStore();

  const [step,       setStep]       = useState<Step>('tip');
  const [tip,        setTip]        = useState(0);
  const [method,     setMethod]     = useState<Method | null>(null);
  const [cashTender, setCashTender] = useState(0);
  const [giftCode,   setGiftCode]   = useState('');
  const [orderId,    setOrderId]    = useState<string | null>(null);
  const [orderNum,   setOrderNum]   = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string>('');

  const sub  = subtotal();
  const tax  = taxTotal();
  const ttl  = total() + tip;

  const locationId = getLocationId();

  const close = useCallback(() => {
    setPaymentSheetOpen(false);
    onClose();
  }, [onClose, setPaymentSheetOpen]);

  // Close on Escape (only from tip/method steps)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (step === 'tip' || step === 'method')) close();
      if (e.key === 'Enter' && step === 'success') { clearCart(); close(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [step, close, clearCart]);

  /** Build the in-memory receipt snapshot from current cart + payment state. */
  const buildReceiptSnapshot = useCallback(
    (ordId: string, orderNum: string, method: string, tendered: number): LastCompletedOrder => {
      const ui = getUserInfo();
      return {
        orderId:       ordId,
        orderNumber:   orderNum,
        items:         cart.map((c) => ({
          name:      c.name,
          quantity:  c.quantity,
          unitPrice: c.unitPrice,
          // BUG-PAY-001: modifiers may be undefined on deserialized cart items
          modifiers: (c.modifiers ?? []).map((m) => m.name),
          total:     c.lineTotal,
        })),
        subtotal:      sub,
        taxTotal:      tax,
        tipTotal:      tip,
        total:         ttl,
        amountPaid:    method === 'cash' && tendered > 0 ? tendered : ttl,
        changeDue:     method === 'cash' && tendered > 0 ? Math.max(0, tendered - ttl) : 0,
        paymentMethod: method,
        employeeName:  ui.employeeName,
        locationName:  ui.locationName,
        orgName:       ui.orgName,
        orderType:     'in_store',
        completedAt:   new Date().toISOString(),
      };
    },
    [cart, sub, tax, tip, ttl],
  );

  // Process payment
  const processPayment = useCallback(async (selectedMethod: Method) => {
    setMethod(selectedMethod);
    setStep('processing');
    setErrorMsg('');

    // ── Dev / demo mode for card payments ────────────────────────────────────
    // In development there is no Stripe Terminal reader, so we simulate a
    // 2-second card tap and navigate straight to the receipt screen.
    // Production flows through the real Stripe Terminal integration.
    if (selectedMethod === 'card' && import.meta.env.DEV) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      const demoNum = `DEMO-${Date.now().toString().slice(-6)}`;
      const snapshot = buildReceiptSnapshot(`demo-${Date.now()}`, demoNum, 'card', 0);
      setLastCompletedOrder(snapshot);
      clearCart();
      close();
      navigate('/receipt', { replace: true });
      return;
    }

    try {
      // 1. Create order
      const order = await ordersApi.create(locationId, {
        customerId: customerId ?? undefined,
        tableId: usePOSStore.getState().tableId ?? undefined,
        items: cart.map((c) => ({
          productId: c.productId,
          variantId: c.variantId,
          quantity:  c.quantity,
          unitPrice: c.unitPrice,
          notes:     c.notes || undefined,
          modifiers: (c.modifiers ?? []).map((m) => ({ modifierId: m.modifierId, name: m.name, priceDelta: m.priceDelta })),
        })),
        notes: orderNotes || undefined,
      });

      const orderNum = order.order_number?.toString() ?? order.id.slice(-6).toUpperCase();
      setOrderId(order.id);
      setOrderNum(orderNum);

      // 2. Process payment.
      // `amount` is the order total WITHOUT the tip; the tip is sent separately as
      // `tipAmount` so the backend tracks it on its own (and never as "change due").
      await paymentsApi.process(locationId, order.id, {
        paymentMethod: selectedMethod === 'card' ? 'card' : selectedMethod,
        amount:        total(),
        tipAmount:     tip > 0 ? tip : undefined,
        cashTendered:  selectedMethod === 'cash' && cashTender > 0 ? cashTender : undefined,
        giftCardCode:  selectedMethod === 'gift_card' && giftCode.trim() ? giftCode.trim() : undefined,
      });

      // 3. Store receipt snapshot and navigate — EDIT CHAIN: data flows to /receipt
      const snapshot = buildReceiptSnapshot(
        order.id,
        orderNum,
        selectedMethod,
        selectedMethod === 'cash' ? cashTender : 0,
      );
      setLastCompletedOrder(snapshot);
      clearCart();
      close();
      navigate('/receipt', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed. Please try again.';
      setErrorMsg(msg);
      setStep('error');
    }
  }, [cart, customerId, locationId, orderNotes, ttl, tip, cashTender, giftCode,
      buildReceiptSnapshot, setLastCompletedOrder, clearCart, close, navigate]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-lg rounded-none sm:rounded-2xl shadow-lg overflow-hidden flex flex-col max-h-dvh sm:max-h-[90dvh]">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        {step !== 'success' && step !== 'error' && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <h2 className="text-base font-semibold text-gray-900">
              {step === 'tip'        && 'Add a tip?'}
              {step === 'method'     && 'Payment method'}
              {step === 'processing' && 'Processing…'}
            </h2>
            {(step === 'tip' || step === 'method') && (
              <button onClick={close} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
                <X size={18} className="text-gray-500" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Step 1: Tip ──────────────────────────────────────────────── */}
          {step === 'tip' && (
            <div className="space-y-5">
              {/* Order summary */}
              <div className="bg-gray-50 rounded-md p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>{itemCount()} item{itemCount() !== 1 ? 's' : ''}</span>
                  <span>{fmt(sub)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Tax</span>
                  <span>{fmt(tax)}</span>
                </div>
                <div className="flex justify-between font-semibold text-gray-900 pt-1 border-t border-gray-200 mt-1">
                  <span>Subtotal</span>
                  <span>{fmt(total())}</span>
                </div>
              </div>

              <TipSelector subtotal={sub} tip={tip} onTipChange={setTip} />

              {/* Total with tip */}
              <div className="flex items-center justify-between bg-primary-light px-4 py-3 rounded-md">
                <span className="text-sm font-semibold text-primary-dark">Total due</span>
                <span className="text-2xl font-bold text-primary-dark">{fmt(ttl)}</span>
              </div>

              <button
                onClick={() => setStep('method')}
                className="w-full h-12 bg-primary text-white rounded-md text-base font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                Continue <ChevronRight size={18} />
              </button>
            </div>
          )}

          {/* ── Step 2: Method ───────────────────────────────────────────── */}
          {step === 'method' && (
            <div className="space-y-3">
              <div className="bg-primary-light px-4 py-2.5 rounded-md flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-primary-dark">Total due</span>
                <span className="text-xl font-bold text-primary-dark">{fmt(ttl)}</span>
              </div>

              {[
                { id: 'card'           as Method, icon: CreditCard,           label: 'Card',          desc: import.meta.env.DEV ? 'Demo mode — simulates card tap' : 'Tap, insert, or swipe' },
                { id: 'cash'           as Method, icon: Banknote,             label: 'Cash',          desc: 'Enter amount tendered' },
                { id: 'gift_card'      as Method, icon: Gift,                 label: 'Gift Card',     desc: 'Scan or enter code' },
                { id: 'account_credit' as Method, icon: Wallet,               label: 'Account Credit',desc: 'Customer balance' },
                { id: 'split'          as Method, icon: SplitSquareHorizontal,label: 'Split',         desc: 'Divide between methods' },
              ].map(({ id, icon: Icon, label, desc }) => (
                <button
                  key={id}
                  onClick={() => {
                    if (id === 'cash' || id === 'gift_card') { setMethod(id); }
                    else void processPayment(id);
                  }}
                  className="w-full flex items-center gap-4 px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 hover:border-gray-300 active:scale-[0.99] transition-all min-h-tap"
                >
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold text-gray-800">{label}</div>
                    <div className="text-xs text-gray-400">{desc}</div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              ))}

              {/* Cash sub-flow inline */}
              {method === 'cash' && (
                <div className="mt-4 space-y-4 pt-4 border-t border-gray-100">
                  <CashKeypad total={ttl} onTendered={setCashTender} />
                  <button
                    onClick={() => void processPayment('cash')}
                    className="w-full h-12 bg-primary text-white rounded-md text-base font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all"
                  >
                    Confirm cash {fmt(ttl)}
                  </button>
                </div>
              )}

              {/* Gift card sub-flow inline */}
              {method === 'gift_card' && (
                <div className="mt-4 space-y-3 pt-4 border-t border-gray-100">
                  <label className="block text-xs font-semibold text-gray-600">Gift card code</label>
                  <input
                    autoFocus value={giftCode} onChange={(e) => setGiftCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={() => void processPayment('gift_card')}
                    disabled={!giftCode.trim()}
                    className="w-full h-12 bg-primary text-white rounded-md text-base font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    Redeem gift card {fmt(ttl)}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Processing ───────────────────────────────────────── */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-base font-semibold text-gray-800">
                  {method === 'card' ? (import.meta.env.DEV ? 'Simulating card tap…' : 'Waiting for card…') : 'Processing payment…'}
                </p>
                {method === 'card' && (
                  <p className="text-sm text-gray-400">
                    {import.meta.env.DEV ? 'Demo mode — success in 2 seconds' : 'Tap, insert, or swipe card on terminal'}
                  </p>
                )}
              </div>
              {import.meta.env.DEV && method === 'card' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700 font-medium">
                  <FlaskConical size={12} /> Demo Mode
                </div>
              )}
              {!(import.meta.env.DEV && method === 'card') && (
                <button
                  onClick={close}
                  className="text-sm text-gray-400 hover:text-gray-600 underline transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          {/* ── Step 4a: Success ─────────────────────────────────────────── */}
          {step === 'success' && (
            <div className="flex flex-col items-center py-8 space-y-5">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle size={40} className="text-green-500" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900">Payment received</h2>
                {orderNum && (
                  <p className="text-sm text-gray-400 mt-1">Order #{orderNum}</p>
                )}
                {method === 'cash' && cashTender > 0 && (
                  <p className="text-base font-semibold text-green-600 mt-2">
                    Change: {fmt(cashTender - ttl)}
                  </p>
                )}
              </div>

              {/* Receipt options */}
              <div className="w-full space-y-2 pt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Receipt</p>
                {[
                  { icon: Printer,       label: 'Print receipt' },
                  { icon: Mail,          label: 'Email receipt' },
                  { icon: MessageSquare, label: 'SMS receipt' },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    onClick={() => showToast.info(`${label} — coming soon`)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors text-sm text-gray-700"
                  >
                    <Icon size={16} className="text-gray-400" />
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => { clearCart(); close(); }}
                className="w-full h-12 bg-primary text-white rounded-md text-base font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all mt-2"
              >
                New Order
              </button>
              <p className="text-xs text-gray-300">Press Enter for new order without receipt</p>
            </div>
          )}

          {/* ── Step 4b: Error ───────────────────────────────────────────── */}
          {step === 'error' && (
            <div className="flex flex-col items-center py-8 space-y-5">
              <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
                <AlertCircle size={40} className="text-danger" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900">Payment failed</h2>
                <p className="text-sm text-gray-500 mt-2 max-w-xs">{errorMsg || 'Something went wrong. Please try again.'}</p>
              </div>
              <div className="w-full space-y-2">
                <button
                  onClick={() => { setStep('method'); setMethod(null); }}
                  className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors"
                >
                  <RotateCcw size={15} /> Try again
                </button>
                <button
                  onClick={() => { setStep('method'); setMethod(null); }}
                  className="w-full h-11 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  Different payment method
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
