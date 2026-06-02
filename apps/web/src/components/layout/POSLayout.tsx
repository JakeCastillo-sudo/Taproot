/**
 * Main POS layout — fully responsive for iPad and iPhone.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * BREAKPOINTS
 * < 768px   (iPhone)         : 2-col grid, bottom nav, floating MobileCart
 * 768-1023px (iPad portrait)  : hamburger + overlay sidebar, 3-col grid,
 *                               MobileCart bottom sheet for cart
 * ≥ 1024px  (iPad landscape+): full 3-column layout (200px / flex / 320px)
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, X, LogOut, ShoppingCart, Package,
  ChevronRight, Plus, Minus, Trash2, Tag,
  FileText, AlertTriangle, User, Layers, BarChart3,
  Upload, ArrowRightLeft, Menu, Terminal,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { usePOSStore, type CartItem } from '../../store/pos.store';
import { products as productsApi, categories as categoriesApi } from '../../lib/api';
import { QK } from '../../lib/queryClient';
import { CustomerSearch } from '../pos/CustomerSearch';
import { ModifierSheet, type ModifierSheetProduct } from '../pos/ModifierSheet';
import { PaymentSheet } from '../pos/PaymentSheet';
import { MobileCart } from '../pos/MobileCart';
import { SyncStatus } from '../ui/SyncStatus';
import { CommandPalette, type CommandAction } from '../ui/CommandPalette';
import { useBarcode } from '../../hooks/useBarcode';
import { useKeyboardShortcuts, ShortcutsOverlay } from '../../hooks/useKeyboardShortcuts';
import { useOrientation } from '../../hooks/useOrientation';
import { useHaptic } from '../../hooks/useHaptic';
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
  product:     Product & { defaultPrice?: number; variants?: Array<{ id: string; name: string }> };
  onTap:       (product: Product & { defaultPrice?: number }) => void;
  onLongPress: (product: Product & { defaultPrice?: number }) => void;
  index:       number;
}

function ProductTile({ product, onTap, onLongPress, index }: ProductTileProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const haptic    = useHaptic();

  const initials   = product.name.slice(0, 2).toUpperCase();
  const colorClass = getInitialColor(product.name);
  const price      = product.defaultPrice ?? 0;

  const handleTouchStart = () => {
    longFired.current = false;
    timerRef.current = setTimeout(() => {
      longFired.current = true;
      haptic.medium();
      onLongPress(product);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!longFired.current) { haptic.light(); onTap(product); }
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
      className="bg-white rounded-lg border border-gray-100 p-3 flex flex-col gap-2 hover:border-primary/30 hover:shadow-sm active:scale-[0.97] transition-all cursor-pointer text-left focus-ring"
      aria-label={`Add ${product.name} — ${fmt(price)}`}
    >
      {/* Image / avatar */}
      <div className={clsx('w-full aspect-square rounded-md flex items-center justify-center text-lg font-bold', colorClass)}>
        {initials}
      </div>
      <div className="text-xs font-medium text-gray-800 line-clamp-2 leading-tight">{product.name}</div>
      <div className="text-sm font-bold text-gray-900">{fmt(price)}</div>
      {!product.track_inventory ? null : (
        <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded-full self-start">In stock</span>
      )}
    </button>
  );
}

// ─── Cart Line Item ───────────────────────────────────────────────────────────

function CartLine({ item }: { item: CartItem }) {
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

function CategoryNav({ categories, selected, onSelect, onClose }: {
  categories: Category[];
  selected:   string | null;
  onSelect:   (id: string | null) => void;
  onClose?:   () => void;
}) {
  const handleSelect = (id: string | null) => {
    onSelect(id);
    onClose?.(); // close drawer on mobile after selection
  };
  return (
    <nav className="flex flex-col gap-0.5">
      <button
        onClick={() => handleSelect(null)}
        className={clsx(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] text-left',
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
          onClick={() => handleSelect(cat.id)}
          className={clsx(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] text-left',
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

// ─── Sidebar content (shared between inline and overlay) ──────────────────────

function SidebarContent({ user, allCats, selectedCategory, setCategory, onClose, productCount }: {
  user:              POSUser;
  allCats:           Category[];
  selectedCategory:  string | null;
  setCategory:       (id: string | null) => void;
  onClose?:          () => void;
  productCount:      number;
}) {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearTokens();
    window.location.href = '/login';
  };

  return (
    <>
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white text-sm font-bold">T</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Taproot POS</p>
              <p className="text-[11px] text-gray-400">Location 1</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 transition-colors lg:hidden">
              <X size={16} className="text-gray-500" />
            </button>
          )}
        </div>
      </div>

      {/* Sync status */}
      <div className="px-3 py-2 border-b border-gray-50 shrink-0">
        <SyncStatus />
      </div>

      {/* Category list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <CategoryNav
          categories={allCats}
          selected={selectedCategory}
          onSelect={setCategory}
          onClose={onClose}
        />
      </div>

      {/* Nav links */}
      <div className="px-3 py-2 border-t border-gray-50 space-y-0.5 shrink-0">
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
        <button
          onClick={() => navigate('/import')}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
        >
          <Upload size={15} className="shrink-0 text-gray-400" />
          Import
        </button>
        {productCount < 10 && (
          <button
            onClick={() => navigate('/migrate')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <ArrowRightLeft size={15} className="shrink-0 text-gray-400" />
            Migrate
          </button>
        )}
      </div>

      {/* Employee footer */}
      <div className="px-3 py-3 border-t border-gray-100 shrink-0">
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
    </>
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

  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<ModifierSheetProduct | null>(null);
  const [showShortcuts,  setShowShortcuts]  = useState(false);
  const [cmdOpen,        setCmdOpen]        = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { isTablet } = useOrientation();

  useBarcode();

  // ── Command palette actions ────────────────────────────────────────────────
  const cmdActions: CommandAction[] = [
    {
      id: 'nav-register',   group: 'Navigate',
      icon: <Terminal size={15} />,
      label: 'Register',    description: 'POS register',
      onSelect: () => navigate('/'),
    },
    {
      id: 'nav-inventory',  group: 'Navigate',
      icon: <Layers size={15} />,
      label: 'Inventory',   description: 'Stock levels and products',
      onSelect: () => navigate('/inventory'),
    },
    {
      id: 'nav-reports',    group: 'Navigate',
      icon: <BarChart3 size={15} />,
      label: 'Reports',     description: 'Sales analytics',
      onSelect: () => navigate('/reports'),
    },
    {
      id: 'nav-import',     group: 'Navigate',
      icon: <Upload size={15} />,
      label: 'Import',      description: 'Import products via AI',
      onSelect: () => navigate('/import'),
    },
    {
      id: 'cart-charge',    group: 'Cart',
      icon: <ShoppingCart size={15} />,
      label: 'Charge',      description: cart.length > 0 ? `Charge ${fmt(total())}` : 'Cart is empty',
      shortcut: '↵',
      onSelect: () => { if (cart.length > 0) setPaymentSheetOpen(true); },
    },
    {
      id: 'cart-clear',     group: 'Cart',
      icon: <Trash2 size={15} />,
      label: 'Clear cart',  description: 'Remove all items',
      shortcut: '⌘D',
      onSelect: () => { if (cart.length > 0 && window.confirm('Clear cart?')) clearCart(); },
    },
    {
      id: 'focus-search',   group: 'Search',
      icon: <Search size={15} />,
      label: 'Search products',
      shortcut: '/',
      onSelect: () => { searchRef.current?.focus(); },
    },
    {
      id: 'show-shortcuts', group: 'Help',
      icon: <Package size={15} />,
      label: 'Keyboard shortcuts',
      shortcut: '?',
      onSelect: () => setShowShortcuts(true),
    },
  ];

  useKeyboardShortcuts({
    onFocusSearch:        () => searchRef.current?.focus(),
    onOpenPayment:        () => { if (cart.length > 0) setPaymentSheetOpen(true); },
    onShowHelp:           () => setShowShortcuts(true),
    onOpenCommandPalette: () => setCmdOpen(true),
  });

  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: QK.products({ categoryId: selectedCategory, search: searchQuery }),
    queryFn:  () => productsApi.list({ categoryId: selectedCategory ?? undefined, search: searchQuery || undefined, isActive: true, perPage: 100 }),
    staleTime: 30_000,
  });
  const productList = productsData?.products ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 5 * 60_000,
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

  const sub  = subtotal();
  const disc = discountTotal();
  const tax  = taxTotal();
  const ttl  = total();
  const cnt  = itemCount();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex overflow-hidden bg-surface-2">

      {/* ── INLINE SIDEBAR — iPad landscape + desktop (lg+) ───────────────── */}
      <aside className="hidden lg:flex flex-col w-48 xl:w-56 shrink-0 bg-white border-r border-gray-100 overflow-hidden">
        <SidebarContent
          user={user}
          allCats={allCats}
          selectedCategory={selectedCategory}
          setCategory={setCategory}
          productCount={productList.length}
        />
      </aside>

      {/* ── OVERLAY SIDEBAR — iPad portrait (md, not lg) ──────────────────── */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setSidebarOpen(false)}
        >
          <aside
            className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl flex flex-col overflow-hidden animate-slide-in-left"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent
              user={user}
              allCats={allCats}
              selectedCategory={selectedCategory}
              setCategory={setCategory}
              onClose={() => setSidebarOpen(false)}
              productCount={productList.length}
            />
          </aside>
        </div>
      )}

      {/* ── CENTER: Product grid ───────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Search / top bar */}
        <div className="px-3 md:px-4 py-3 bg-white border-b border-gray-100 shrink-0 flex items-center gap-2">

          {/* Hamburger — visible on md (iPad portrait) and smaller */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-md hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu size={18} className="text-gray-600" />
          </button>

          {/* Search box */}
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              id="pos-search"
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isTablet ? 'Search products… (/)' : 'Search…'}
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

          {/* ⌘K command palette hint — desktop only */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-400 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open command palette"
          >
            <Terminal size={13} />
            <kbd className="font-mono">⌘K</kbd>
          </button>
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          {loadingProducts ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-lg bg-gray-100 animate-shimmer" />
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 md:gap-3">
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

        {/* ── MOBILE bottom nav ──────────────────────────────────────────── */}
        <nav
          className="md:hidden shrink-0 bg-white border-t border-gray-100 grid grid-cols-4 bottom-nav"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <button onClick={() => navigate('/')}
            className="flex flex-col items-center gap-1 py-2 text-primary">
            <ShoppingCart size={20} />
            <span className="text-[10px] font-medium">Register</span>
          </button>
          <button onClick={() => navigate('/inventory')}
            className="flex flex-col items-center gap-1 py-2 text-gray-400 hover:text-gray-600">
            <Layers size={20} />
            <span className="text-[10px] font-medium">Inventory</span>
          </button>
          <button onClick={() => navigate('/reports')}
            className="flex flex-col items-center gap-1 py-2 text-gray-400 hover:text-gray-600">
            <BarChart3 size={20} />
            <span className="text-[10px] font-medium">Reports</span>
          </button>
          <button onClick={() => setSidebarOpen(true)}
            className="flex flex-col items-center gap-1 py-2 text-gray-400 hover:text-gray-600">
            <Menu size={20} />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </nav>
      </main>

      {/* ── RIGHT: Order panel — iPad landscape + desktop (lg+) ───────────── */}
      <aside className="hidden lg:flex flex-col w-80 xl:w-96 shrink-0 bg-white border-l border-gray-100 overflow-hidden">
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
            <div>{cart.map((item) => <CartLine key={item.id} item={item} />)}</div>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 shrink-0 space-y-2">
            <button className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark transition-colors">
              <Tag size={11} /> Add discount
            </button>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal ({cnt} item{cnt !== 1 ? 's' : ''})</span>
                <span>{fmt(sub)}</span>
              </div>
              {disc > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span><span>−{fmt(disc)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-500">
                <span>Tax (8.5%)</span><span>{fmt(tax)}</span>
              </div>
            </div>
            <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span><span>{fmt(ttl)}</span>
            </div>
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
            <button
              onClick={() => setPaymentSheetOpen(true)}
              className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <ChevronRight size={18} /> Charge {fmt(ttl)}
            </button>
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

      {/* ── MOBILE cart — shown on < lg (iPhone + iPad portrait) ──────────── */}
      <MobileCart
        open={mobileCartOpen}
        onOpen={() => setMobileCartOpen(true)}
        onClose={() => setMobileCartOpen(false)}
      />

      {/* ── TABLET (md, not lg): floating cart button for iPad portrait ────── */}
      {cnt > 0 && (
        <button
          className="hidden md:flex lg:hidden fixed bottom-6 right-6 z-40 items-center gap-2 bg-primary text-white px-5 py-3 rounded-full shadow-lg active:scale-95 transition-all"
          onClick={() => setMobileCartOpen(true)}
        >
          <ShoppingCart size={18} />
          <span className="font-semibold">{cnt}</span>
          <span className="font-bold text-white/90">{fmt(ttl)}</span>
        </button>
      )}

      {/* ── Modifier sheet ─────────────────────────────────────────────────── */}
      {modifierProduct && (
        <ModifierSheet
          product={modifierProduct}
          onClose={() => { setModifierProduct(null); setModifierSheetOpen(false); }}
        />
      )}

      {/* ── Payment sheet ──────────────────────────────────────────────────── */}
      {isPaymentSheetOpen && (
        <PaymentSheet onClose={() => setPaymentSheetOpen(false)} />
      )}

      {/* ── Command palette ────────────────────────────────────────────────── */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        actions={cmdActions}
      />

      {/* ── Keyboard shortcuts overlay ──────────────────────────────────────── */}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
