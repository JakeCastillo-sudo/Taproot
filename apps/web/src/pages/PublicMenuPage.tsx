/**
 * PublicMenuPage — /order/:orgSlug  (and /order/:orgSlug/table/:tableId)
 *
 * Customer-facing QR menu. No auth, no POS chrome. Browse → add to cart →
 * checkout (name/phone) → place order (pay at counter). Shows a confirmation
 * with the order number and estimated time.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Minus, ShoppingBag, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { publicApi, type PublicMenu, type PublicOrderBody } from '../lib/api';
import { OnlinePaymentSheet } from '../components/public/OnlinePaymentSheet';

function fmt(c: number): string { return `$${(c / 100).toFixed(2)}`; }

interface CartLine { productId: string; variantId: string | null; name: string; price: number; quantity: number }

export function PublicMenuPage() {
  const { orgSlug = '', tableId } = useParams<{ orgSlug: string; tableId?: string }>();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [placed, setPlaced] = useState<{ orderNumber: string; estimatedMinutes: number } | null>(null);

  const { data: menu, isLoading, error } = useQuery({
    queryKey: ['public-menu', orgSlug],
    queryFn:  () => publicApi.menu(orgSlug),
    retry: false,
  });

  const total = cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const count = cart.reduce((s, l) => s + l.quantity, 0);

  const add = (p: PublicMenu['categories'][number]['products'][number]) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0) return c.map((l, j) => j === i ? { ...l, quantity: l.quantity + 1 } : l);
      return [...c, { productId: p.id, variantId: p.variantId, name: p.name, price: p.price, quantity: 1 }];
    });
  };
  const setQty = (productId: string, q: number) =>
    setCart((c) => q <= 0 ? c.filter((l) => l.productId !== productId) : c.map((l) => l.productId === productId ? { ...l, quantity: q } : l));

  const online = menu?.online;
  const deliveryFee = fulfillment === 'delivery' ? (online?.deliveryFeeCents ?? 0) : 0;
  const grandTotal = total + deliveryFee;
  const belowMin = (online?.minOrderCents ?? 0) > 0 && total < (online!.minOrderCents);

  const orderBody = (): PublicOrderBody => ({
    tableId: tableId ?? null,
    items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
    customerName: name.trim() || undefined,
    customerPhone: phone.trim() || undefined,
    fulfillmentType: tableId ? undefined : fulfillment,
    address: fulfillment === 'delivery' ? address.trim() || undefined : undefined,
  });

  const place = useMutation({
    mutationFn: () => publicApi.createOrder(orgSlug, orderBody()),
    onSuccess: (r) => { setPlaced({ orderNumber: r.orderNumber, estimatedMinutes: r.estimatedMinutes }); setCart([]); setCheckout(false); },
  });

  const allProducts = useMemo(() => menu?.categories ?? [], [menu]);

  if (error) {
    return <div className="h-screen overflow-y-auto flex items-center justify-center bg-surface-2 text-center p-6">
      <div><p className="text-lg font-bold text-gray-900">Restaurant not found</p><p className="text-sm text-gray-500 mt-1">Check the link and try again.</p></div>
    </div>;
  }

  if (placed) {
    return (
      <div className="h-screen overflow-y-auto flex items-center justify-center bg-surface-2 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center max-w-sm w-full">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"><Check size={28} className="text-green-600" /></div>
          <h1 className="text-xl font-bold text-gray-900">Order placed!</h1>
          <p className="text-sm text-gray-500 mt-1">Order <span className="font-semibold">{placed.orderNumber}</span></p>
          <p className="text-sm text-gray-500 mt-2">Estimated ready in ~{placed.estimatedMinutes} min{tableId ? ' — we\'ll bring it to your table.' : ' — pay at the counter.'}</p>
          <button onClick={() => setPlaced(null)} className="mt-5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark">Order more</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-surface-2 pb-28">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {menu?.org.logo ? <img src={menu.org.logo} alt="" className="w-10 h-10 rounded-lg object-cover" />
            : <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-white font-bold">{(menu?.org.name ?? 'T')[0]}</div>}
          <div>
            <h1 className="text-base font-bold text-gray-900">{menu?.org.name ?? 'Menu'}</h1>
            {tableId && <p className="text-xs text-gray-400">Ordering for your table</p>}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>
        ) : allProducts.map((cat) => (
          <section key={cat.id}>
            <h2 className="text-sm font-bold text-gray-700 mb-2">{cat.icon ? `${cat.icon} ` : ''}{cat.name}</h2>
            <div className="space-y-2">
              {cat.products.map((p) => (
                <div key={p.id} className="bg-white rounded-lg border border-gray-100 p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-400 line-clamp-2">{p.description}</p>}
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{fmt(p.price)}</p>
                  </div>
                  <button onClick={() => add(p)} className="shrink-0 w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-dark active:scale-95 transition-all"><Plus size={18} /></button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>

      {/* Cart bar */}
      {count > 0 && !checkout && (
        <button onClick={() => setCheckout(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-primary text-white rounded-full shadow-lg px-5 py-3.5 flex items-center justify-between active:scale-[0.99] transition-all">
          <span className="flex items-center gap-2 font-semibold"><ShoppingBag size={18} /> {count} item{count !== 1 ? 's' : ''}</span>
          <span className="font-bold">{fmt(total)} · Review</span>
        </button>
      )}

      {/* Checkout sheet */}
      {checkout && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setCheckout(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Your order</h2>
              <button onClick={() => setCheckout(false)} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
              {cart.map((l) => (
                <div key={l.productId} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                  <span className="flex-1 text-sm text-gray-700">{l.name}</span>
                  <button onClick={() => setQty(l.productId, l.quantity - 1)} className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center"><Minus size={13} /></button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                  <button onClick={() => setQty(l.productId, l.quantity + 1)} className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center"><Plus size={13} /></button>
                  <span className="w-16 text-right text-sm font-semibold text-gray-800">{fmt(l.price * l.quantity)}</span>
                </div>
              ))}
              {/* Fulfillment (hidden for QR table orders) */}
              {!tableId && (online?.deliveryEnabled || online?.pickupEnabled) && (
                <div className="mt-3">
                  <div className="flex gap-1.5">
                    {online?.pickupEnabled && (
                      <button onClick={() => setFulfillment('pickup')}
                        className={clsx('flex-1 px-3 py-1.5 rounded-md text-sm font-medium', fulfillment === 'pickup' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>Pickup</button>
                    )}
                    {online?.deliveryEnabled && (
                      <button onClick={() => setFulfillment('delivery')}
                        className={clsx('flex-1 px-3 py-1.5 rounded-md text-sm font-medium', fulfillment === 'delivery' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>Delivery</button>
                    )}
                  </div>
                  {fulfillment === 'delivery' && (
                    <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address"
                      className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-md text-sm" />
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel"
                  className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm" />
              </div>
              {belowMin && <p className="text-xs text-amber-600 mt-2">Minimum order is {fmt(online!.minOrderCents)}.</p>}
              {place.isError && <p className="text-xs text-red-600 mt-2">{place.error instanceof Error ? place.error.message : 'Could not place order'}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              {deliveryFee > 0 && <div className="flex justify-between text-sm text-gray-500"><span>Delivery</span><span>{fmt(deliveryFee)}</span></div>}
              <div className="flex justify-between font-bold text-gray-900"><span>Total</span><span>{fmt(grandTotal)}</span></div>
              {online?.paymentAvailable && (
                <button onClick={() => setPayNow(true)} disabled={cart.length === 0 || belowMin || (fulfillment === 'delivery' && !address.trim())}
                  className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark disabled:opacity-50">
                  Pay now with card · {fmt(grandTotal)}
                </button>
              )}
              <button onClick={() => place.mutate()} disabled={place.isPending || cart.length === 0 || belowMin || (fulfillment === 'delivery' && !address.trim())}
                className={clsx('w-full h-12 rounded-md text-base font-bold disabled:opacity-50',
                  online?.paymentAvailable ? 'border border-gray-200 text-gray-700 hover:bg-gray-50' : 'bg-primary text-white hover:bg-primary-dark')}>
                {place.isPending ? 'Placing…' : 'Place order · Pay at counter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payNow && (
        <OnlinePaymentSheet
          slug={orgSlug}
          body={orderBody()}
          onClose={() => setPayNow(false)}
          onSuccess={(orderNumber, estimatedMinutes) => { setPayNow(false); setPlaced({ orderNumber, estimatedMinutes }); setCart([]); setCheckout(false); }}
        />
      )}
    </div>
  );
}
