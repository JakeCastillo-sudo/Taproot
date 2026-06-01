/**
 * Main 3-column POS layout.
 *
 * LEFT  240px  — Category nav + employee footer
 * CENTER flex  — Search bar + product grid
 * RIGHT  380px — Order summary panel
 *
 * Mobile (< 768px): single column, floating cart button
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, LogOut, ShoppingCart, Package,
  ChevronRight, Plus, Minus, Trash2, Tag,
  FileText, AlertTriangle, User, Layers, BarChart3,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { usePOSStore, type CartItem } from '../../store/pos.store';
import { products as productsApi, categories as categoriesApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { CustomerSearch } from '../pos/CustomerSearch';
import { ModifierSheet, type ModifierSheetProduct } from '../pos/ModifierSheet';
import { PaymentSheet } from '../pos/PaymentSheet';
import { SyncStatus } from '../ui/SyncStatus';
import { useBarcode } from '../../hooks/useBarcode';
import { useKeyboardShortcuts, ShortcutsOverlay } from '../../hooks/useKeyboardShortcuts';
import { showToast } from '../ui/Toast';
import { clearTokens } from '../../lib/api';
import type { Product } from '@taproot/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface POSUser {
  firstName:   string;
  lastName:    string;
  role:        string;
  locationIds: string[];
}

interface POSLayoutProps {
  user: POSUser;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getInitialColor(name: string): string {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-purple-100 text-purple-700',
    'bg-pink-100 text-pink-700',
    'bg-indigo-100 text-indigo-700',
    'bg-amber-100 text-amber-700',
    'bg-teal-100 text-teal-700',
    'bg-rose-100 text-rose-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Product Tile ─────────────────────────────────────────────────────────────

interface ProductTileProps {
  product:      Product & { defaultPrice?: number; variants?: Array<{ id: string; name: string }> };
  onTap:        (product: Product & { defaultPrice?: number }) => void;
  onLongPress:  (product: Product & { defaultPrice?: number }) => void;
  index:        number;
}

function ProductTile({ product, onTap, onLongPress, index }: ProductTileProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const initials   = product.name.slice(0, 2).toUpperCase();
  const colorClass = getInitialColor(product.name);
  const price      = product.defaultPrice ?? 0;

  const handleTouchStart = () => {
    longFired.current = false;
    timerRef.current = setTimeout(() => {
      longFired.current = true;
      onLongPress(product);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!longFired.current) onTap(product);
  };
  const handleClick = () => {
    if (!longFired.current) onTap(product);
  };

  return (
    <button
      data-product-tile
      data-index={index}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
      onClick={handleClick}
      className="bg-white rounded-lg border border-gray-100 p-3 flex flex-col gap-2 hover:border-primary/30 hover:shadow-sm active:scale-[0.97] transition-all cursor-pointer text-left tap-highlight active-scale focus-ring"
      aria-label={`Add ${product.name} — ${fmt(price)}`}
    >
      {/* Image / avatar */}
      <div className={clsx('w-full aspect-square rounded-md flex items-center justify-center text-lg font-bold', colorClass)}>
        {initials}
      </div>

      {/* Name */}
      <div className="text-xs font-medium text-gray-800 line-clamp-2 leading-tight">{product.name}</div>

      {/* Price */}
      <div className="text-sm font-bold text-gray-900">{fmt(price)}</div>

      {/* Stock badge */}
      {!product.track_inventory ? null : (
        <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded-full self-start">In stock</span>
      )}
    </button>
  );
}

// ─── Cart Line Item ───────────────────────────────────────────────────────────

interface CartLineProps {
  item: CartItem;
}

function CartLine({ item }: CartLineProps) {
  const updateQuantity = usePOSStore((s) => s.updateQuantity);
  const removeFromCart = usePOSStore((s) => s.removeFromCart);

  return (
    <div className="flex items-start gap-2 py-3 border-b border-gray-50 last:border-0 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
        {item.modifiers.length > 0 && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {item.modifiers.map((m) => m.name).join(', ')}
          </p>
        )}
        {item.notes && (
          <p className="text-xs text-gray-400 italic truncate">{item.notes}</p>
        )}
        <p className="text-xs text-gray-400 mt-0.5">{fmt(item.unitPrice)} each</p>
      </div>

      {/* Qty stepper */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => updateQuantity(item.id, item.quantity - 1)}
          className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 transition-colors"
          aria-label="Decrease"
        >
          <Minus size={11} />
        </button>
        <span className="w-6 text-center text-xs font-semibold text-gray-800">{item.quantity}</span>
        <button
          onClick={() => updateQuantity(item.id, item.quantity + 1)}
          className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 transition-colors"
          aria-label="Increase"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Line total */}
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-gray-900">{fmt(item.lineTotal)}</p>
        <button
          onClick={() => removeFromCart(item.id)}
          className="mt-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-400 transition-all"
          aria-label="Remove item"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Category nav ─────────────────────────────────────────────────────────────

interface Category { id: string; name: string; color: string | null }

function CategoryNav({ categories, selected, onSelect }: {
  categories: Category[];
  selected:   string | null;
  onSelect:   (id: string | null) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect(null)}
        className={clsx(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-tap text-left',
          selected === null
            ? 'bg-primary text-white'
            : 'text-gray-600 hover:bg-gray-100',
        )}
      >
        <Package size={15} className="shrink-0" />
        All Items
      </button>

      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={clsx(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-tap text-left',
            selected === cat.id
              ? 'bg-primary text-white'
              : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: cat.color ?? '#94A3B8' }}
          />
          <span className="truncate">{cat.name}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── POSLayout ────────────────────────────────────────────────────────────────

export function POSLayout({ user }: POSLayoutProps) {
  const navigate = useNavigate();

  const {
    cart, selectedCategory, searchQuery,
    setCategory, setSearch,
    setPaymentSheetOpen, isPaymentSheetOpen,
    setModifierSheetOpen,
    subtotal, taxTotal, total, discountTotal, itemCount,
    clearCart,
  } = usePOSStore();

  const [mobileCartOpen,   setMobileCartOpen]   = useState(false);
  const [modifierProduct,  setModifierProduct]  = useState<ModifierSheetProduct | null>(null);
  const [showShortcuts,    setShowShortcuts]    = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Activate barcode scanning
  useBarcode();

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onFocusSearch:  () => searchRef.current?.focus(),
    onOpenPayment:  () => { if (cart.length > 0) setPaymentSheetOpen(true); },
    onShowHelp:     () => setShowShortcuts(true),
  });

  // Fetch products
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: QK.products({ categoryId: selectedCategory, search: searchQuery }),
    queryFn:  () => productsApi.list({ categoryId: selectedCategory ?? undefined, search: searchQuery || undefined, isActive: true, perPage: 100 }),
    staleTime: 30_000,
  });

  const productList = productsData?.products ?? [];

  // Fetch real categories from the API
  const { data: categoriesData } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 5 * 60_000, // categories change rarely
  });
  const allCats: Category[] = categoriesData?.categories ?? [];

  const handleProductTap = useCallback((product: Product & { defaultPrice?: number }) => {
    const defaultVariant = (product as Product & { variants?: Array<{ id: string }> }).variants?.[0];
    usePOSStore.getState().addToCart({
      productId: product.id,
      variantId: defaultVariant?.id ?? null,
      name:      product.name,
      sku:       product.sku ?? '',
      quantity:  1,
      unitPrice: product.defaultPrice ?? 0,
      modifiers: [],
      notes:     '',
    });
    // Brief visual feedback
    showToast.success(`Added: ${product.name}`, { duration: 1200 });
  }, []);

  const handleProductLongPress = useCallback((product: Product & { defaultPrice?: number }) => {
    const pSheet: ModifierSheetProduct = {
      id:             product.id,
      variantId:      (product as Product & { variants?: Array<{ id: string }> }).variants?.[0]?.id ?? null,
      name:           product.name,
      sku:            product.sku ?? '',
      basePrice:      product.defaultPrice ?? 0,
      modifierGroups: [],
    };
    setModifierProduct(pSheet);
    setModifierSheetOpen(true);
  }, [setModifierSheetOpen]);

  const handleLogout = () => {
    clearTokens();
    window.location.href = '/login';
  };

  const sub  = subtotal();
  const disc = discountTotal();
  const tax  = taxTotal();
  const ttl  = total();
  const cnt  = itemCount();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex overflow-hidden bg-surface-2">

      {/* ── LEFT: Category sidebar ─────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-white border-r border-gray-100 overflow-hidden">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Taproot POS</p>
              <p className="text-[11px] text-gray-400">Location 1</p>
            </div>
          </div>
        </div>

        {/* Sync status */}
        <div className="px-3 py-2 border-b border-gray-50">
          <SyncStatus />
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <CategoryNav
            categories={allCats}
            selected={selectedCategory}
            onSelect={setCategory}
          />
        </div>

        {/* Bottom nav links */}
        <div className="px-3 py-2 border-t border-gray-50 space-y-0.5">
          <button
            onClick={() => navigate('/inventory')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <Layers size={15} className="shrink-0 text-gray-400" />
            Inventory
          </button>
          <button
            onClick={() => navigate('/reports')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <BarChart3 size={15} className="shrink-0 text-gray-400" />
            Reports
          </button>
        </div>

        {/* Employee footer */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <User size={14} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-[10px] text-gray-400 capitalize">{user.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      {/* ── CENTER: Product grid ───────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar */}
        <div className="px-4 py-3 bg-white border-b border-gray-100 shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              id="pos-search"
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products… (press /)"
              className="w-full pl-9 pr-9 py-2.5 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 transition-colors"
              >
                <X size={13} className="text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loadingProducts ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-lg bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : productList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Package size={32} className="text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-400">No products found</p>
              {searchQuery && (
                <button onClick={() => setSearch('')} className="mt-2 text-xs text-primary hover:underline">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-3">
              {productList.map((product, i) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  onTap={handleProductTap}
                  onLongPress={handleProductLongPress}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ── RIGHT: Order panel ─────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-96 shrink-0 bg-white border-l border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">Current order</h2>
            {cnt > 0 && (
              <button
                onClick={() => window.confirm('Clear order?') && clearCart()}
                className="text-xs text-gray-400 hover:text-danger transition-colors flex items-center gap-1"
              >
                <AlertTriangle size={11} /> Clear
              </button>
            )}
          </div>
          <CustomerSearch />
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-36 text-center">
              <ShoppingCart size={28} className="text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">Cart is empty</p>
              <p className="text-xs text-gray-300 mt-1">Tap a product to add it</p>
            </div>
          ) : (
            <div>
              {cart.map((item) => <CartLine key={item.id} item={item} />)}
            </div>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 shrink-0 space-y-2">
            {/* Discounts row */}
            <button className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark transition-colors">
              <Tag size={11} /> Add discount
            </button>

            {/* Totals */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal ({cnt} item{cnt !== 1 ? 's' : ''})</span>
                <span>{fmt(sub)}</span>
              </div>
              {disc > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>−{fmt(disc)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>Tax (8.5%)</span>
                <span>{fmt(tax)}</span>
              </div>
            </div>
            <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span>{fmt(ttl)}</span>
            </div>

            {/* Notes */}
            <div>
              <button
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => {
                  const n = window.prompt('Order notes:', usePOSStore.getState().orderNotes);
                  if (n !== null) usePOSStore.getState().setOrderNotes(n);
                }}
              >
                <FileText size={11} /> Order notes
              </button>
            </div>

            {/* CHARGE button */}
            <button
              onClick={() => setPaymentSheetOpen(true)}
              className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <ChevronRight size={18} /> Charge {fmt(ttl)}
            </button>

            {/* Secondary actions */}
            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 rounded-md border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                Park order
              </button>
              <button
                onClick={() => window.confirm('Void this order?') && clearCart()}
                className="h-9 rounded-md border border-red-100 text-xs text-danger hover:bg-red-50 transition-colors"
              >
                Void order
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── MOBILE: Floating cart button ─────────────────────────────── */}
      {cnt > 0 && (
        <button
          className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-primary text-white px-6 py-3.5 rounded-full shadow-lg active:scale-95 transition-all"
          onClick={() => setMobileCartOpen(true)}
        >
          <ShoppingCart size={18} />
          <span className="font-semibold">{cnt} item{cnt !== 1 ? 's' : ''}</span>
          <span className="text-white/80">·</span>
          <span className="font-bold">{fmt(ttl)}</span>
        </button>
      )}

      {/* ── MOBILE: Cart bottom sheet ─────────────────────────────────── */}
      {mobileCartOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setMobileCartOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80dvh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Your order</h2>
              <button onClick={() => setMobileCartOpen(false)} className="p-1.5 rounded-full hover:bg-gray-100">
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {cart.map((item) => <CartLine key={item.id} item={item} />)}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 space-y-2">
              <div className="flex justify-between text-sm font-bold text-gray-900">
                <span>Total</span><span>{fmt(ttl)}</span>
              </div>
              <button
                onClick={() => { setMobileCartOpen(false); setPaymentSheetOpen(true); }}
                className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark transition-all"
              >
                Charge {fmt(ttl)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modifier sheet ────────────────────────────────────────────── */}
      {modifierProduct && (
        <ModifierSheet
          product={modifierProduct}
          onClose={() => { setModifierProduct(null); setModifierSheetOpen(false); }}
        />
      )}

      {/* ── Payment sheet ─────────────────────────────────────────────── */}
      {isPaymentSheetOpen && (
        <PaymentSheet onClose={() => setPaymentSheetOpen(false)} />
      )}

      {/* ── Keyboard shortcuts overlay ────────────────────────────────── */}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
