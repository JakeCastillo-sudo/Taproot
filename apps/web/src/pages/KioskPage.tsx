/**
 * KioskPage — /kiosk
 *
 * Full-screen self-serve ordering. Category tiles → product grid → cart → pay.
 * Auto-resets after inactivity; exits via a hidden corner tap + manager PIN.
 * Uses the authenticated product/order API (kiosk runs on a logged-in device).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Minus, ShoppingCart, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { products as productsApi, categories as categoriesApi, orders as ordersApi } from '../lib/api';
import { getLocationId } from '../lib/session';
import { getCategoryColor } from '../lib/categoryColors';

const IDLE_MS = 90_000;
const WARN_MS = 30_000;
const KIOSK_PIN_KEY = 'taproot_kiosk_pin';

interface KioskItem { productId: string; name: string; unitPrice: number; quantity: number }
function money(c: number): string { return `$${(c / 100).toFixed(2)}`; }

export function KioskPage() {
  const navigate = useNavigate();
  const locationId = getLocationId();

  const { data: prodResp } = useQuery({ queryKey: ['kiosk', 'products'], queryFn: () => productsApi.list() });
  const { data: catResp } = useQuery({ queryKey: ['kiosk', 'categories'], queryFn: () => categoriesApi.list() });
  const allProducts = prodResp?.products ?? [];
  const cats = catResp?.categories ?? [];

  const [catId, setCatId] = useState<string | null>(null);
  const [cart, setCart] = useState<KioskItem[]>([]);
  const [placing, setPlacing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<{ id: string; name: string; price: number } | null>(null);
  const [showWarn, setShowWarn] = useState(false);
  const [exitPin, setExitPin] = useState<string | null>(null);
  const tapCount = useRef(0);

  const visible = useMemo(
    () => (catId ? allProducts.filter((p) => p.category_id === catId) : allProducts),
    [allProducts, catId],
  );
  const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  // ── Idle auto-reset ──────────────────────────────────────────────────────────
  const reset = useCallback(() => { setCart([]); setCatId(null); setDone(null); setUpsell(null); setShowWarn(false); }, []);
  const timers = useRef<{ warn?: ReturnType<typeof setTimeout>; idle?: ReturnType<typeof setTimeout> }>({});
  const bumpActivity = useCallback(() => {
    setShowWarn(false);
    if (timers.current.warn) clearTimeout(timers.current.warn);
    if (timers.current.idle) clearTimeout(timers.current.idle);
    timers.current.warn = setTimeout(() => setShowWarn(true), IDLE_MS - WARN_MS);
    timers.current.idle = setTimeout(reset, IDLE_MS);
  }, [reset]);

  useEffect(() => {
    bumpActivity();
    const h = () => bumpActivity();
    window.addEventListener('pointerdown', h);
    return () => { window.removeEventListener('pointerdown', h); if (timers.current.warn) clearTimeout(timers.current.warn); if (timers.current.idle) clearTimeout(timers.current.idle); };
  }, [bumpActivity]);

  const addItem = (p: { id: string; name: string; defaultPrice?: number }) => {
    const price = p.defaultPrice ?? 0;
    setCart((c) => {
      const ex = c.find((i) => i.productId === p.id);
      return ex ? c.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
                : [...c, { productId: p.id, name: p.name, unitPrice: price, quantity: 1 }];
    });
    // Upsell: suggest a random other product
    const others = allProducts.filter((x) => x.id !== p.id && (x.defaultPrice ?? 0) > 0);
    if (others.length) { const u = others[(p.id.charCodeAt(0) + cart.length) % others.length]; setUpsell({ id: u.id, name: u.name, price: u.defaultPrice ?? 0 }); }
  };
  const changeQty = (id: string, d: number) => setCart((c) => c.flatMap((i) => i.productId === id ? (i.quantity + d <= 0 ? [] : [{ ...i, quantity: i.quantity + d }]) : [i]));

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const order = await ordersApi.create(locationId, {
        orderType: 'in_store',
        items: cart.map((i) => ({ productId: i.productId, variantId: null, quantity: i.quantity, unitPrice: i.unitPrice, modifiers: [] })),
        notes: 'Kiosk order',
      });
      setDone((order as { order_number?: string }).order_number ?? order.id.slice(-6).toUpperCase());
      setCart([]); setUpsell(null);
    } catch { setDone('ERROR'); }
    finally { setPlacing(false); }
  };

  const cornerTap = () => {
    tapCount.current += 1;
    if (tapCount.current >= 3) { tapCount.current = 0; setExitPin(''); }
    setTimeout(() => { tapCount.current = 0; }, 1500);
  };
  const tryExit = () => {
    const pin = (() => { try { return localStorage.getItem(KIOSK_PIN_KEY) || '1234'; } catch { return '1234'; } })();
    if (exitPin === pin) navigate('/'); else setExitPin('');
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="h-screen bg-primary flex flex-col items-center justify-center text-white text-center p-8">
        {done === 'ERROR' ? (
          <><X size={72} className="mb-4" /><h1 className="text-3xl font-bold">Something went wrong</h1><p className="mt-2 text-white/80">Please see a team member.</p></>
        ) : (
          <><div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center mb-4"><Check size={56} /></div>
            <h1 className="text-4xl font-bold">Thank you!</h1>
            <p className="mt-3 text-xl">Order <strong>#{done}</strong></p>
            <p className="mt-1 text-white/80">Please pay at the counter.</p></>
        )}
        <button onClick={reset} className="mt-8 px-8 py-4 bg-white text-primary rounded-2xl text-xl font-bold">Start new order</button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 select-none">
      <header className="bg-primary text-white px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold">🌿 Order Here</h1>
        <div onClick={cornerTap} className="w-12 h-12" aria-hidden /> {/* hidden exit tap target */}
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Menu */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Category chips */}
          <div className="flex gap-3 flex-wrap mb-5">
            <button onClick={() => setCatId(null)} className={clsx('px-5 py-3 rounded-2xl text-lg font-semibold', !catId ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200')}>All</button>
            {cats.map((c) => (
              <button key={c.id} onClick={() => setCatId(c.id)} className={clsx('px-5 py-3 rounded-2xl text-lg font-semibold', catId === c.id ? 'bg-primary text-white' : 'bg-white text-gray-700 border border-gray-200')}>{c.name}</button>
            ))}
          </div>
          {/* Product grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {visible.map((p) => (
              <button key={p.id} onClick={() => addItem(p)}
                className="bg-white rounded-2xl border border-gray-200 p-5 text-left hover:border-primary active:scale-[0.98] transition-all min-h-[110px] flex flex-col justify-between">
                <span className="text-lg font-semibold text-gray-800 leading-tight">{p.name}</span>
                <span className="mt-2 text-xl font-bold" style={{ color: getCategoryColor(p.category_id ?? '') }}>{money(p.defaultPrice ?? 0)}</span>
              </button>
            ))}
            {visible.length === 0 && <p className="text-gray-400 col-span-full text-center py-12 text-lg">No items here.</p>}
          </div>
        </div>

        {/* Cart */}
        <aside className="w-96 bg-white border-l border-gray-200 flex flex-col shrink-0">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2"><ShoppingCart size={22} className="text-primary" /><h2 className="text-xl font-bold">Your Order</h2></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {cart.length === 0 ? <p className="text-gray-400 text-center py-12 text-lg">Tap items to add them</p> : cart.map((i) => (
              <div key={i.productId} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                <div className="flex-1 min-w-0"><p className="font-semibold text-gray-800 truncate">{i.name}</p><p className="text-sm text-gray-500">{money(i.unitPrice)}</p></div>
                <button onClick={() => changeQty(i.productId, -1)} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center"><Minus size={16} /></button>
                <span className="w-6 text-center font-bold">{i.quantity}</span>
                <button onClick={() => changeQty(i.productId, 1)} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center"><Plus size={16} /></button>
              </div>
            ))}
            {upsell && cart.length > 0 && (
              <button onClick={() => { addItem({ id: upsell.id, name: upsell.name, defaultPrice: upsell.price }); }}
                className="w-full mt-2 text-left bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                <span className="font-semibold text-amber-800">Also popular:</span> <span className="text-amber-700">{upsell.name} +{money(upsell.price)}</span>
              </button>
            )}
          </div>
          <div className="border-t border-gray-100 p-4 space-y-3">
            <div className="flex justify-between text-xl font-bold"><span>Total</span><span>{money(total)}</span></div>
            <button onClick={() => void placeOrder()} disabled={cart.length === 0 || placing}
              className="w-full py-4 bg-primary text-white rounded-2xl text-xl font-bold disabled:opacity-40">{placing ? 'Placing…' : 'Pay at Counter'}</button>
          </div>
        </aside>
      </div>

      {/* Idle warning */}
      {showWarn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={bumpActivity}>
          <div className="bg-white rounded-2xl p-8 text-center max-w-sm">
            <h2 className="text-2xl font-bold">Still there?</h2>
            <p className="mt-2 text-gray-500">Tap anywhere to continue. We'll reset soon.</p>
            <button onClick={bumpActivity} className="mt-5 px-8 py-3 bg-primary text-white rounded-xl text-lg font-bold">I'm here</button>
          </div>
        </div>
      )}

      {/* Exit PIN */}
      {exitPin !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={() => setExitPin(null)}>
          <div className="bg-white rounded-2xl p-6 w-72" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">Manager PIN to exit</h2>
            <input autoFocus type="password" inputMode="numeric" value={exitPin}
              onChange={(e) => setExitPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tryExit()}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-2xl tracking-widest" placeholder="••••" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setExitPin(null)} className="flex-1 py-2 text-gray-600 rounded-xl hover:bg-gray-100">Cancel</button>
              <button onClick={tryExit} className="flex-1 py-2 bg-primary text-white rounded-xl font-semibold">Exit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
