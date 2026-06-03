import React, { useState } from 'react';
import { Plus, Minus, Trash2, CreditCard, Banknote, Smartphone, Tag, ReceiptText, Package } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useFetch, apiPost } from '../hooks/useApi';
import Modal from '../components/Modal';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'other', label: 'Other', icon: Smartphone },
];

function fmt(sym, n) {
  return `${sym}${Number(n).toFixed(2)}`;
}

export default function Register() {
  const { cart, addToCart, updateQuantity, removeFromCart, clearCart, subtotal, tax, total, settings } = useApp();
  const sym = settings.currency_symbol || '$';

  const { data: categories } = useFetch('/api/categories');
  const { data: products } = useFetch('/api/products');

  const [activeCategory, setActiveCategory] = useState(null);
  const [search, setSearch] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [tendered, setTendered] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const discountAmt = Math.min(parseFloat(discount) || 0, subtotal);
  const taxable = subtotal - discountAmt;
  const adjTax = taxable * (parseFloat(settings.tax_rate) || 0) / 100;
  const adjTotal = taxable + adjTax;
  const changeDue = payMethod === 'cash' && tendered ? parseFloat(tendered) - adjTotal : null;

  const filteredProducts = (products || []).filter(p => {
    const matchCat = !activeCategory || p.category_id === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  async function handleCheckout() {
    if (!cart.length) return;
    setSubmitting(true);
    setError('');
    try {
      const order = await apiPost('/api/orders', {
        items: cart.map(i => ({
          product_id: i.id,
          product_name: i.name,
          unit_price: i.price,
          quantity: i.quantity,
        })),
        payment_method: payMethod,
        amount_tendered: payMethod === 'cash' ? parseFloat(tendered) || null : null,
        discount: discountAmt,
        note,
      });
      setReceipt(order);
      clearCart();
      setCheckoutOpen(false);
      setTendered('');
      setDiscount('');
      setNote('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Product grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search + category filter */}
        <div className="p-4 bg-white border-b space-y-3">
          <input
            className="input"
            placeholder="Search products..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                !activeCategory ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {(categories || []).map(c => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(activeCategory === c.id ? null : c.id)}
                style={activeCategory === c.id ? { backgroundColor: c.color, color: '#fff' } : {}}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === c.id ? '' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredProducts.map(p => {
              const inCart = cart.find(i => i.id === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="card p-3 text-left hover:shadow-md hover:border-green-300 transition-all active:scale-95 relative"
                >
                  {inCart && (
                    <span className="absolute top-2 right-2 bg-green-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                      {inCart.quantity}
                    </span>
                  )}
                  <div
                    className="w-8 h-8 rounded-lg mb-2 flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: p.category_color || '#6366f1' }}
                  >
                    {p.name[0]}
                  </div>
                  <p className="text-sm font-medium leading-tight">{p.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{p.category_name || 'Uncategorized'}</p>
                  <p className="text-sm font-semibold text-green-600 mt-1">{fmt(sym, p.price)}</p>
                </button>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="col-span-4 text-center py-16 text-gray-400">
                <Package className="mx-auto mb-2 opacity-30" size={40} />
                <p className="text-sm">No products found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cart */}
      <div className="w-72 lg:w-80 bg-white border-l flex flex-col shrink-0">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm">Current Order</h2>
        </div>

        <div className="flex-1 overflow-y-auto divide-y">
          {cart.length === 0 && (
            <div className="p-8 text-center text-gray-400">
              <ShoppingCartIcon className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Cart is empty</p>
            </div>
          )}
          {cart.map(item => (
            <div key={item.id} className="p-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-gray-500">{fmt(sym, item.price)} each</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="btn-ghost p-1 rounded">
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="btn-ghost p-1 rounded">
                  <Plus size={14} />
                </button>
              </div>
              <p className="text-sm font-semibold w-14 text-right">{fmt(sym, item.price * item.quantity)}</p>
              <button onClick={() => removeFromCart(item.id)} className="btn-ghost p-1 rounded text-red-400 hover:text-red-600">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t p-4 space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span><span>{fmt(sym, subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>Tax ({settings.tax_rate}%)</span><span>{fmt(sym, tax)}</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t">
            <span>Total</span><span className="text-green-600">{fmt(sym, total)}</span>
          </div>
          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={!cart.length}
            className="btn-primary w-full mt-2"
          >
            <ReceiptText size={16} /> Charge {fmt(sym, total)}
          </button>
          {cart.length > 0 && (
            <button onClick={clearCart} className="btn-ghost w-full text-xs text-gray-400">
              Clear order
            </button>
          )}
        </div>
      </div>

      {/* Checkout modal */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Checkout">
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setPayMethod(id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-xs font-medium transition-colors ${
                    payMethod === id ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {payMethod === 'cash' && (
            <div>
              <label className="label">Amount Tendered</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={tendered}
                onChange={e => setTendered(e.target.value)}
              />
              {tendered && changeDue !== null && (
                <p className={`text-sm mt-1 font-medium ${changeDue >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {changeDue >= 0 ? `Change: ${fmt(sym, changeDue)}` : `Insufficient: ${fmt(sym, -changeDue)} short`}
                </p>
              )}
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {[1, 5, 10, 20, 50, 100].map(v => (
                  <button key={v} onClick={() => setTendered(String(v))}
                    className="btn-secondary text-xs py-1.5">${v}</button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="label flex items-center gap-1"><Tag size={12} /> Discount</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={discount}
              onChange={e => setDiscount(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Note (optional)</label>
            <input className="input" placeholder="Order note..." value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(sym, subtotal)}</span></div>
            {discountAmt > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>-{fmt(sym, discountAmt)}</span></div>}
            <div className="flex justify-between text-gray-600"><span>Tax</span><span>{fmt(sym, adjTax)}</span></div>
            <div className="flex justify-between font-bold text-base pt-1 border-t mt-1"><span>Total</span><span className="text-green-600">{fmt(sym, adjTotal)}</span></div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleCheckout}
            disabled={submitting || (payMethod === 'cash' && tendered && changeDue < 0)}
            className="btn-primary w-full py-3 text-base"
          >
            {submitting ? 'Processing...' : `Complete Sale · ${fmt(sym, adjTotal)}`}
          </button>
        </div>
      </Modal>

      {/* Receipt modal */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Receipt">
        {receipt && (
          <div className="p-5 space-y-4 font-mono text-sm">
            <div className="text-center">
              <p className="font-bold text-base">{settings.business_name}</p>
              <p className="text-gray-500 text-xs">{new Date(receipt.created_at).toLocaleString()}</p>
              <p className="text-gray-500 text-xs">{receipt.order_number}</p>
            </div>
            <div className="divide-y">
              {receipt.items.map(i => (
                <div key={i.id} className="flex justify-between py-1">
                  <span>{i.quantity}x {i.product_name}</span>
                  <span>{fmt(sym, i.line_total)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t pt-2">
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmt(sym, receipt.subtotal)}</span></div>
              {receipt.discount > 0 && <div className="flex justify-between text-red-500"><span>Discount</span><span>-{fmt(sym, receipt.discount)}</span></div>}
              <div className="flex justify-between text-gray-600"><span>Tax</span><span>{fmt(sym, receipt.tax)}</span></div>
              <div className="flex justify-between font-bold text-base border-t pt-1"><span>Total</span><span>{fmt(sym, receipt.total)}</span></div>
              {receipt.payment_method === 'cash' && receipt.change_due != null && (
                <div className="flex justify-between text-green-600"><span>Change</span><span>{fmt(sym, receipt.change_due)}</span></div>
              )}
            </div>
            <p className="text-center text-gray-400 text-xs capitalize">Paid via {receipt.payment_method}</p>
            {settings.receipt_footer && (
              <p className="text-center text-gray-500 text-xs border-t pt-3">{settings.receipt_footer}</p>
            )}
            <button onClick={() => setReceipt(null)} className="btn-primary w-full">Done</button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ShoppingCartIcon({ className }) {
  return (
    <svg className={className} width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-1.35 2.7A1 1 0 007 17h10m0 0a2 2 0 110 4 2 2 0 010-4m-10 0a2 2 0 110 4 2 2 0 010-4" />
    </svg>
  );
}
