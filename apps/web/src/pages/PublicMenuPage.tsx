/**
 * PublicMenuPage — /order/:orgSlug  (and /order/:orgSlug/table/:tableId)
 *
 * Customer-facing QR menu. No auth, no POS chrome. Mobile-first (the vast
 * majority of customers order on a phone): branded header, sticky category
 * tabs, product-card grid, a floating cart → checkout sheet, then a live
 * order-status tracker that auto-refreshes.
 *
 * Note: the public menu API does not return modifier groups, so items add
 * directly. Modifier selection on the public menu would need a backend change
 * to public.service (returning + accepting modifiers) — out of scope here.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, Minus, ShoppingBag, Check, X, Clock, MapPin, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { publicApi, type PublicMenu, type PublicOrderBody } from '../lib/api';
import { OnlinePaymentSheet } from '../components/public/OnlinePaymentSheet';

function fmt(c: number): string { return `$${(c / 100).toFixed(2)}`; }

/** Subtle banner color by wait length — never alarming. */
function waitBanner(mins: number): string {
  if (mins > 30) return 'bg-gray-100 text-gray-600';
  if (mins >= 15) return 'bg-amber-50 text-amber-700';
  return 'bg-green-50 text-green-700';
}

/** Best-effort one-line address from the org's free-form address JSON. */
function formatAddress(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '';
  const get = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
  const line = get('line1') || get('street') || get('address');
  return [line, get('city'), get('state')].filter(Boolean).join(', ');
}

interface CartLine { productId: string; variantId: string | null; name: string; price: number; quantity: number }
interface Placed { orderNumber: string; estimatedMinutes: number; orderId: string }

export function PublicMenuPage() {
  const { orgSlug = '', tableId } = useParams<{ orgSlug: string; tableId?: string }>();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [activeCat, setActiveCat] = useState<string>('');
  const [placed, setPlaced] = useState<Placed | null>(null);

  const { data: menu, isLoading, error } = useQuery({
    queryKey: ['public-menu', orgSlug],
    queryFn:  () => publicApi.menu(orgSlug),
    retry: false,
  });

  // Live queue-aware wait time (FEAT-WAIT-001) — best-effort; banner hides if unavailable.
  const { data: waitTime } = useQuery({
    queryKey: ['public-wait', orgSlug],
    queryFn:  () => publicApi.waitTime(orgSlug),
    refetchInterval: 60_000,
    staleTime: 30_000,
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
    onSuccess: (r) => { setPlaced({ orderNumber: r.orderNumber, estimatedMinutes: r.estimatedMinutes, orderId: r.orderId }); setCart([]); setCheckout(false); },
  });

  const categories = useMemo(() => (menu?.categories ?? []).filter((c) => c.products.length > 0), [menu]);

  const scrollToCat = (id: string) => {
    setActiveCat(id);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Error / confirmation states ────────────────────────────────────────────
  if (error) {
    return <div className="h-screen overflow-y-auto flex items-center justify-center bg-surface-2 text-center p-6">
      <div><p className="text-lg font-bold text-gray-900">Restaurant not found</p><p className="text-sm text-gray-500 mt-1">Check the link and try again.</p></div>
    </div>;
  }

  if (placed) {
    return (
      <OrderConfirmation
        slug={orgSlug}
        placed={placed}
        orgName={menu?.org.name ?? 'the kitchen'}
        tableId={tableId}
        onOrderMore={() => setPlaced(null)}
      />
    );
  }

  const addr = formatAddress(menu?.org.address);

  return (
    <div className="h-screen overflow-y-auto bg-surface-2 pb-28">
      {/* Sticky branded header + category tabs */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100">
        <header className="max-w-3xl mx-auto px-4 pt-4 pb-3 flex items-center gap-3">
          {menu?.org.logo
            ? <img src={menu.org.logo} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
            : <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white text-xl font-bold shrink-0">{(menu?.org.name ?? 'T')[0]}</div>}
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-gray-900 truncate">{menu?.org.name ?? 'Menu'}</h1>
            {tableId
              ? <p className="text-xs text-gray-400">Ordering for your table</p>
              : addr && <p className="text-xs text-gray-400 flex items-center gap-1 truncate"><MapPin size={11} className="shrink-0" /> {addr}</p>}
          </div>
        </header>

        {waitTime?.available && waitTime.estimatedMinutes != null && (
          <div className="max-w-3xl mx-auto px-4 pb-2">
            <div className={clsx('flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5', waitBanner(waitTime.estimatedMinutes))}>
              <Clock size={12} className="shrink-0" />
              {waitTime.rushMode ? 'Busy right now · ' : ''}Current wait: {waitTime.displayText}
            </div>
          </div>
        )}

        {categories.length > 1 && (
          <div className="max-w-3xl mx-auto px-2 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => scrollToCat(cat.id)}
                className={clsx(
                  'shrink-0 px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors min-h-[44px]',
                  activeCat === cat.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {cat.icon ? `${cat.icon} ` : ''}{cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-7">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : categories.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">This menu has no items yet. Check back soon.</p>
        ) : categories.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-36">
            <h2 className="text-base font-bold text-gray-800 mb-2.5">{cat.icon ? `${cat.icon} ` : ''}{cat.name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {cat.products.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
                  <div className="aspect-[4/3] bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center">
                    <span className="text-white text-4xl font-extrabold opacity-90">{p.name[0]?.toUpperCase()}</span>
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{p.name}</p>
                    {p.description && <p className="text-xs text-gray-400 line-clamp-2 mt-0.5 flex-1">{p.description}</p>}
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <span className="text-sm font-bold text-primary-dark">{fmt(p.price)}</span>
                      <button
                        onClick={() => add(p)}
                        aria-label={`Add ${p.name}`}
                        className="shrink-0 w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-dark active:scale-95 transition-all"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <p className="text-center text-[11px] text-gray-300 pt-2">Powered by Taproot</p>
      </main>

      {/* Floating cart bar */}
      {count > 0 && !checkout && (
        <button onClick={() => setCheckout(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md bg-primary text-white rounded-full shadow-lg px-5 py-3.5 flex items-center justify-between active:scale-[0.99] transition-all z-30">
          <span className="flex items-center gap-2 font-semibold"><ShoppingBag size={18} /> {count} item{count !== 1 ? 's' : ''}</span>
          <span className="font-bold">{fmt(total)} · Review</span>
        </button>
      )}

      {/* Checkout sheet */}
      {checkout && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setCheckout(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Your order</h2>
              <button onClick={() => setCheckout(false)} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
              {cart.map((l) => (
                <div key={l.productId} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0">
                  <span className="flex-1 text-sm text-gray-700">{l.name}</span>
                  <button onClick={() => setQty(l.productId, l.quantity - 1)} aria-label="Decrease" className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center"><Minus size={13} /></button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantity}</span>
                  <button onClick={() => setQty(l.productId, l.quantity + 1)} aria-label="Increase" className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center"><Plus size={13} /></button>
                  <span className="w-16 text-right text-sm font-semibold text-gray-800">{fmt(l.price * l.quantity)}</span>
                </div>
              ))}
              {/* Fulfillment (hidden for QR table orders) */}
              {!tableId && (online?.deliveryEnabled || online?.pickupEnabled) && (
                <div className="mt-3">
                  <div className="flex gap-1.5">
                    {online?.pickupEnabled && (
                      <button onClick={() => setFulfillment('pickup')}
                        className={clsx('flex-1 px-3 py-2 rounded-md text-sm font-medium', fulfillment === 'pickup' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>Pickup</button>
                    )}
                    {online?.deliveryEnabled && (
                      <button onClick={() => setFulfillment('delivery')}
                        className={clsx('flex-1 px-3 py-2 rounded-md text-sm font-medium', fulfillment === 'delivery' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>Delivery</button>
                    )}
                  </div>
                  {fulfillment === 'delivery' && (
                    <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address"
                      className="w-full mt-2 px-3 py-2.5 border border-gray-200 rounded-md text-sm" />
                  )}
                </div>
              )}

              <div className="mt-3 space-y-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-md text-sm" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-md text-sm" />
              </div>
              {belowMin && <p className="text-xs text-amber-600 mt-2">Minimum order is {fmt(online!.minOrderCents)}.</p>}
              {place.isError && <p className="text-xs text-red-600 mt-2">{place.error instanceof Error ? place.error.message : 'Could not place order'}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><span>{fmt(total)}</span></div>
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
          onSuccess={(orderNumber, estimatedMinutes, orderId) => { setPayNow(false); setPlaced({ orderNumber, estimatedMinutes, orderId }); setCart([]); setCheckout(false); }}
        />
      )}
    </div>
  );
}

// ─── Order confirmation + live status tracker ──────────────────────────────────

function OrderConfirmation({ slug, placed, orgName, tableId, onOrderMore }: {
  slug: string; placed: Placed; orgName: string; tableId?: string; onOrderMore: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['public-order-status', slug, placed.orderId],
    queryFn:  () => publicApi.orderStatus(slug, placed.orderId),
    refetchInterval: 30_000,
    initialData: { status: 'pending', orderNumber: placed.orderNumber, estimatedMinutes: placed.estimatedMinutes },
  });

  const s = (data?.status ?? '').toLowerCase();
  const ready = ['ready', 'complete', 'completed', 'fulfilled'].some((x) => s.includes(x));
  const steps = [
    { label: 'Order received', done: true, active: false },
    { label: 'Being prepared', done: ready, active: !ready },
    { label: tableId ? 'Ready — we\'ll bring it over' : 'Ready for pickup', done: ready, active: false },
  ];

  return (
    <div className="h-screen overflow-y-auto bg-surface-2 p-6 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7 text-center max-w-sm w-full">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4"><Check size={28} className="text-green-600" /></div>
        <h1 className="text-xl font-extrabold text-gray-900">Order confirmed!</h1>
        <p className="text-sm text-gray-500 mt-1">Thanks for ordering from {orgName}.</p>

        <div className="mt-4 bg-surface-2 rounded-xl py-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Order number</p>
          <p className="text-2xl font-extrabold text-gray-900">{data?.orderNumber ?? placed.orderNumber}</p>
        </div>

        {!ready && (() => {
          const mins = data?.estimatedMinutes ?? placed.estimatedMinutes;
          const readyBy = new Date(Date.now() + mins * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return (
            <p className="text-sm text-gray-500 mt-3 flex items-center justify-center gap-1.5">
              <Clock size={14} /> Ready in ~{mins} min · est. {readyBy}
            </p>
          );
        })()}

        {/* Status tracker */}
        <div className="mt-5 text-left space-y-3">
          {steps.map((st) => (
            <div key={st.label} className="flex items-center gap-3">
              <span className={clsx('w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                st.done ? 'bg-green-100 text-green-600' : st.active ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-300')}>
                {st.done ? <Check size={14} /> : st.active ? <Loader2 size={13} className="animate-spin" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
              </span>
              <span className={clsx('text-sm', st.done || st.active ? 'font-semibold text-gray-800' : 'text-gray-400')}>{st.label}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-gray-300 mt-4">Status updates automatically</p>
        <button onClick={onOrderMore} className="mt-4 w-full h-11 bg-primary text-white text-sm font-bold rounded-md hover:bg-primary-dark">Order more</button>
      </div>
    </div>
  );
}
