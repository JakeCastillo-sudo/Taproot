/**
 * Main POS layout — fully responsive for iPad and iPhone.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * BREAKPOINTS
 * < 768px   (iPhone)         : 2-col product grid, bottom nav, floating cart
 * 768-1023px (iPad portrait)  : hamburger + overlay sidebar, center zone,
 *                               floating cart button
 * ≥ 1024px  (iPad landscape+): 3-column layout (sidebar | center | cart)
 *
 * SIDEBAR STATES (lg+ only)
 * Expanded (200px): icon + text label for every nav item
 * Collapsed (56px): icon only, tooltip on hover; toggle at bottom
 *
 * CENTER ZONE MODES
 * categories: CategoryTileGrid — large colorful tiles, default landing
 * items:      ProductGrid — filtered by selected category + breadcrumb
 * Search text always switches to 'items' and searches across all products.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, X, LogOut, ShoppingCart, Package,
  ChevronRight, ChevronLeft, Plus, Minus, Trash2, Tag,
  FileText, AlertTriangle, User, Layers, BarChart3,
  Upload, ArrowRightLeft, Menu, Terminal, Settings,
  LayoutGrid, UserCog, Grid3x3, Utensils, CalendarClock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { usePOSStore, type CartItem } from '../../store/pos.store';
import { useUIStore } from '../../store/ui.store';
import { products as productsApi, categories as categoriesApi, settings as settingsApi, type ProductWithModifiers } from '../../lib/api';
import { setPosTaxRate } from '../../store/pos.store';
import { useQueryClient } from '@tanstack/react-query';
import { QK } from '../../lib/queryClient';
import { CustomerSearch } from '../pos/CustomerSearch';
import { CategoryTileGrid } from '../pos/CategoryTileGrid';
import { DayPartToggle } from '../pos/DayPartToggle';
import { ModifierSheet, type ModifierSheetProduct } from '../pos/ModifierSheet';
import { EmployeeSelect } from '../pos/EmployeeSelect';
import { CashDrawerWidget } from '../pos/CashDrawerWidget';
import { SplitCheckModal } from '../pos/SplitCheckModal';
import { TableView } from '../pos/TableView';
import { OnlineOrdersBell } from '../pos/OnlineOrdersBell';
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
        {(item.modifiers ?? []).length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {(item.modifiers ?? []).map((m, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-gray-400">
                <span className="truncate">+ {m.name}</span>
                {m.priceDelta !== 0 && (
                  <span className={m.priceDelta > 0 ? 'text-gray-400 ml-1 shrink-0' : 'text-green-500 ml-1 shrink-0'}>
                    {m.priceDelta > 0 ? '+' : ''}{(m.priceDelta / 100).toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
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

// ─── Nav items ────────────────────────────────────────────────────────────────

interface NavItem {
  id:    string;
  icon:  React.ReactNode;
  label: string;
  path:  string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'pos',       icon: <ShoppingCart size={18} />, label: 'Register',  path: '/' },
  { id: 'orders',    icon: <FileText size={18} />,     label: 'Orders',    path: '/orders' },
  { id: 'inventory', icon: <Package size={18} />,      label: 'Inventory', path: '/inventory' },
  { id: 'reports',   icon: <BarChart3 size={18} />,    label: 'Reports',   path: '/reports' },
  { id: 'kitchen',   icon: <Utensils size={18} />,     label: 'Kitchen',   path: '/kitchen' },
  { id: 'reserve',   icon: <CalendarClock size={18} />,label: 'Reservations', path: '/reservations' },
  { id: 'import',    icon: <Upload size={18} />,       label: 'Import',    path: '/import' },
  { id: 'migrate',   icon: <ArrowRightLeft size={18}/>,label: 'Migrate',   path: '/migrate' },
  { id: 'settings',  icon: <Settings size={18} />,     label: 'Settings',  path: '/settings' },
  { id: 'customize', icon: <LayoutGrid size={18} />,   label: 'Customize', path: '/settings/dashboard' },
];

// ─── Collapsible Sidebar (desktop lg+) ───────────────────────────────────────

interface SidebarProps {
  user:          POSUser;
  collapsed:     boolean;
  onToggle:      () => void;
  onClose?:      () => void;     // overlay mode only
  onSwitchUser?: () => void;
}

function Sidebar({ user, collapsed, onToggle, onClose, onSwitchUser }: SidebarProps) {
  const navigate  = useNavigate();
  const location  = useLocation();

  const handleLogout = () => {
    clearTokens();
    window.location.href = '/login';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Logo / brand */}
      <div className={clsx(
        'px-3 py-3 border-b border-gray-100 shrink-0 flex items-center',
        collapsed ? 'justify-center' : 'justify-between gap-2',
      )}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">T</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">Taproot POS</p>
              <p className="text-[11px] text-gray-400">Location 1</p>
            </div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors shrink-0 lg:hidden"
          >
            <X size={16} className="text-gray-500" />
          </button>
        )}
      </div>

      {/* Sync status (expanded only) */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-gray-50 shrink-0">
          <SyncStatus />
        </div>
      )}

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.id}
              title={collapsed ? item.label : undefined}
              onClick={() => { navigate(item.path); onClose?.(); }}
              className={clsx(
                'w-full flex items-center rounded-md text-sm font-medium transition-colors min-h-[40px]',
                collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2.5',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
              )}
            >
              <span className={clsx('shrink-0', isActive && 'text-primary')}>
                {item.icon}
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Sidebar collapse toggle (desktop only) */}
      <div className={clsx(
        'px-2 py-2 border-t border-gray-50 shrink-0',
        collapsed ? 'flex justify-center' : '',
      )}>
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={clsx(
            'flex items-center gap-2 rounded-md text-xs text-gray-400 hover:text-gray-600',
            'hover:bg-gray-100 transition-colors min-h-[36px]',
            collapsed ? 'justify-center px-2 py-2 w-full' : 'px-3 py-2 w-full',
          )}
        >
          {collapsed
            ? <ChevronRight size={16} />
            : <><ChevronLeft size={16} /><span>Collapse</span></>
          }
        </button>
      </div>

      {/* Employee footer */}
      <div className={clsx(
        'px-2 py-3 border-t border-gray-100 shrink-0',
        collapsed ? 'flex flex-col items-center gap-2' : '',
      )}>
        {collapsed ? (
          <button
            title={`${user.firstName} ${user.lastName} — Sign out`}
            onClick={handleLogout}
            className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center hover:bg-red-100 transition-colors"
          >
            <User size={14} className="text-primary" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2.5 px-1 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <User size={14} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-gray-400 capitalize">{user.role}</p>
              </div>
            </div>
            {onSwitchUser && (
              <button
                onClick={onSwitchUser}
                className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-md text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
              >
                <UserCog size={13} /> Switch user
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
            >
              <LogOut size={13} /> Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── POSLayout ────────────────────────────────────────────────────────────────

export function POSLayout({ user }: POSLayoutProps) {
  const navigate = useNavigate();
  const qc       = useQueryClient();

  const {
    cart, searchQuery, setSearch,
    setPaymentSheetOpen, isPaymentSheetOpen,
    setModifierSheetOpen,
    subtotal, taxTotal, total, discountTotal, itemCount,
    clearCart,
  } = usePOSStore();

  const {
    sidebarCollapsed, toggleSidebar,
    posViewMode, selectedCategoryId, selectedCategoryName,
    setPosViewItems, resetPosView,
    activeDayPart, setActiveDayPart,
  } = useUIStore();

  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<ModifierSheetProduct | null>(null);
  const [showShortcuts,  setShowShortcuts]  = useState(false);
  const [cmdOpen,        setCmdOpen]        = useState(false);
  const [showEmployeeSelect, setShowEmployeeSelect] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [floorMode, setFloorMode] = useState<'grid' | 'table'>('grid');
  const searchRef = useRef<HTMLInputElement>(null);

  // 5-minute idle → open the employee lock screen so the next person PINs in.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setShowEmployeeSelect(true), 5 * 60_000);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, []);

  const { isTablet } = useOrientation();

  useBarcode();

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: categoriesData, isLoading: loadingCats } = useQuery({
    queryKey: QK.categories(),
    queryFn:  () => categoriesApi.list(),
    staleTime: 5 * 60_000,
  });
  const allCats = categoriesData?.categories ?? [];
  const totalProductCount = allCats.reduce((s, c) => s + c.product_count, 0);

  // Load configured tax rate so the cart preview matches what the server charges.
  const { data: taxData } = useQuery({
    queryKey: ['settings', 'tax'],
    queryFn:  () => settingsApi.getTax(),
    staleTime: 5 * 60_000,
  });
  const exclusiveTaxRate = !taxData || taxData.taxInclusive
    ? 0
    : taxData.taxRates.reduce((s, r) => s + (Number(r.rate) || 0), 0);
  // Keep the pos.store estimate in sync (no-op when unchanged)
  if (taxData) setPosTaxRate(exclusiveTaxRate);
  const taxRatePct = exclusiveTaxRate * 100;

  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: QK.products({ categoryId: selectedCategoryId, search: searchQuery, dayPart: activeDayPart }),
    queryFn:  () => productsApi.list({
      categoryId: selectedCategoryId ?? undefined,
      search: searchQuery || undefined,
      isActive: true,
      perPage: 100,
      dayPart: activeDayPart !== 'all' ? activeDayPart : undefined,
    }),
    staleTime: 30_000,
    // Fetch when in items view, searching, OR when a day-part is active (for accurate tile counts)
    enabled: posViewMode === 'items' || !!searchQuery || activeDayPart !== 'all',
  });
  const productList = productsData?.products ?? [];

  // Background fetch of ALL products for the active day part — used to compute
  // per-category filtered counts shown on category tiles.
  const { data: allDayPartData } = useQuery({
    queryKey: QK.products({ dayPart: activeDayPart, _scope: 'counts' }),
    queryFn:  () => productsApi.list({
      isActive: true,
      perPage: 200,
      dayPart: activeDayPart !== 'all' ? activeDayPart : undefined,
    }),
    staleTime: 30_000,
    enabled: activeDayPart !== 'all',
  });

  // Compute per-category filtered counts when a day part is active
  const filteredCategoryCounts = useMemo(() => {
    if (activeDayPart === 'all' || !allDayPartData) return undefined;
    const counts: Record<string, number> = {};
    for (const p of allDayPartData.products) {
      // Products have category_id from the shared Product type
      const catId = (p as Product & { category_id?: string | null }).category_id ?? '__none__';
      counts[catId] = (counts[catId] ?? 0) + 1;
    }
    return counts;
  }, [allDayPartData, activeDayPart]);

  const filteredTotal = activeDayPart !== 'all' && allDayPartData
    ? allDayPartData.total
    : undefined;

  // ── Search handler: auto-switch to item view ───────────────────────────────

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    if (value) {
      // Switch to item view for search results (across all categories)
      setPosViewItems(null, null);
    } else if (posViewMode === 'items' && !selectedCategoryId) {
      // Clearing search while in "all items" view → back to categories
      resetPosView();
    }
  }, [setSearch, setPosViewItems, resetPosView, posViewMode, selectedCategoryId]);

  const clearSearch = useCallback(() => {
    setSearch('');
    resetPosView();
  }, [setSearch, resetPosView]);

  // ── Product interaction ────────────────────────────────────────────────────

  /** Open the modifier sheet for a product (always, so notes can be added). */
  const openModifierSheet = useCallback((product: ProductWithModifiers) => {
    const pSheet: ModifierSheetProduct = {
      id:             product.id,
      variantId:      product.variants?.[0]?.id ?? null,
      name:           product.name,
      sku:            product.sku ?? '',
      basePrice:      product.defaultPrice ?? 0,
      modifierGroups: (product.modifierGroups ?? []).map((g) => ({
        id:            g.id,
        name:          g.name,
        selectionType: g.selectionType,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        sortOrder:     g.sortOrder,
        modifiers:     g.modifiers.map((m) => ({
          id:         m.id,
          name:       m.name,
          priceDelta: m.priceDelta,
          isDefault:  m.isDefault,
          sortOrder:  m.sortOrder,
        })),
      })),
    };
    setModifierProduct(pSheet);
    setModifierSheetOpen(true);
  }, [setModifierSheetOpen]);

  const handleProductTap = useCallback((product: Product & { defaultPrice?: number }) => {
    const p = product as ProductWithModifiers;
    const groups = p.modifierGroups ?? [];

    if (groups.length > 0) {
      // Has modifier groups — open sheet before adding to cart
      openModifierSheet(p);
    } else {
      // No modifiers — add directly (fast path)
      usePOSStore.getState().addToCart({
        productId: product.id,
        variantId: p.variants?.[0]?.id ?? null,
        name:      product.name,
        sku:       product.sku ?? '',
        quantity:  1,
        unitPrice: product.defaultPrice ?? 0,
        modifiers: [],
        notes:     '',
      });
      showToast.success(`Added: ${product.name}`, { duration: 1200 });
    }
  }, [openModifierSheet]);

  const handleProductLongPress = useCallback((product: Product & { defaultPrice?: number }) => {
    // Long-press always opens sheet (even without modifiers — for notes / qty)
    openModifierSheet(product as ProductWithModifiers);
  }, [openModifierSheet]);

  /** Called from ModifierSheet when cashier taps "Archive Item" */
  const handleArchiveFromPOS = useCallback((productId: string, productName: string) => {
    if (!window.confirm(`Remove "${productName}" from the register?\n\nIt will be hidden until restored in Inventory → Archived.`)) return;
    void productsApi.archive(productId).then(() => {
      void qc.invalidateQueries({ queryKey: QK.products() });
      void qc.invalidateQueries({ queryKey: ['archivedProducts'] });
      setModifierProduct(null);
      setModifierSheetOpen(false);
      showToast.success(`${productName} archived — restore in Inventory`);
    }).catch((err: unknown) => {
      showToast.error(err instanceof Error ? err.message : 'Archive failed');
    });
  }, [qc, setModifierSheetOpen]);

  const sub  = subtotal();
  const disc = discountTotal();
  const tax  = taxTotal();
  const ttl  = total();
  const cnt  = itemCount();

  // ── Command palette ────────────────────────────────────────────────────────

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
      id: 'view-categories', group: 'View',
      icon: <LayoutGrid size={15} />,
      label: 'Browse categories',
      onSelect: () => { setSearch(''); resetPosView(); },
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

  // ── Breadcrumb label ───────────────────────────────────────────────────────

  const breadcrumbLabel = searchQuery
    ? `Search: "${searchQuery}"`
    : selectedCategoryName ?? 'All Items';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex overflow-hidden bg-surface-2">

      {/* ── INLINE SIDEBAR — desktop + iPad landscape (lg+) ───────────────── */}
      <aside
        className={clsx(
          'hidden lg:flex flex-col shrink-0 bg-white border-r border-gray-100',
          'overflow-hidden transition-all duration-200',
          sidebarCollapsed ? 'w-14' : 'w-48 xl:w-56',
        )}
      >
        <Sidebar
          user={user}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onSwitchUser={() => setShowEmployeeSelect(true)}
        />
      </aside>

      {/* ── OVERLAY SIDEBAR — tablet portrait (md to lg) ──────────────────── */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setSidebarOpen(false)}
        >
          <aside
            className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl flex flex-col overflow-hidden animate-slide-in-left"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar
              user={user}
              collapsed={false}
              onToggle={() => {}}
              onClose={() => setSidebarOpen(false)}
              onSwitchUser={() => { setSidebarOpen(false); setShowEmployeeSelect(true); }}
            />
          </aside>
        </div>
      )}

      {/* ── CENTER ZONE ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Search / top bar */}
        <div className="px-3 md:px-4 py-3 bg-white border-b border-gray-100 shrink-0 flex items-center gap-2">
          {/* Hamburger — visible on tablet (md) and smaller */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-md hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu size={18} className="text-gray-600" />
          </button>

          {/* Search */}
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              id="pos-search"
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={isTablet ? 'Search products… (/)' : 'Search…'}
              className="w-full pl-9 pr-9 py-2.5 bg-gray-50 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              autoComplete="off"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 transition-colors"
              >
                <X size={13} className="text-gray-400" />
              </button>
            )}
          </div>

          {/* Grid / Table view toggle */}
          <div className="hidden sm:flex rounded-md border border-gray-200 overflow-hidden shrink-0">
            <button onClick={() => setFloorMode('grid')} title="Grid view"
              className={clsx('px-2.5 py-2 transition-colors', floorMode === 'grid' ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100')}>
              <Grid3x3 size={15} />
            </button>
            <button onClick={() => setFloorMode('table')} title="Table view"
              className={clsx('px-2.5 py-2 transition-colors', floorMode === 'table' ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100')}>
              <Utensils size={15} />
            </button>
          </div>

          {/* Online orders bell */}
          <OnlineOrdersBell />

          {/* Day-part toggle */}
          <DayPartToggle
            active={activeDayPart}
            onChange={setActiveDayPart}
            compact
          />

          {/* ⌘K hint — desktop */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-400 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open command palette"
          >
            <Terminal size={13} />
            <kbd className="font-mono">⌘K</kbd>
          </button>
        </div>

        {/* Breadcrumb — only visible in items mode */}
        {posViewMode === 'items' && (
          <div className="px-3 md:px-4 py-2 bg-white border-b border-gray-50 shrink-0 flex items-center gap-2">
            <button
              onClick={() => { setSearch(''); resetPosView(); }}
              className="flex items-center gap-1 text-sm text-primary hover:text-primary-dark font-medium transition-colors min-h-[36px]"
            >
              <ChevronLeft size={16} />
              <span className="hidden sm:inline">Categories</span>
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-700 font-medium truncate">{breadcrumbLabel}</span>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto">
          {floorMode === 'table' ? (
            <TableView onStartOrder={() => setFloorMode('grid')} />
          ) : posViewMode === 'categories' && !searchQuery ? (
            /* ── CATEGORY TILE VIEW ────────────────────────────────────── */
            <CategoryTileGrid
              categories={allCats}
              totalProductCount={totalProductCount}
              loading={loadingCats}
              onSelectAll={() => setPosViewItems(null, 'All Items')}
              onSelectCategory={(id, name) => setPosViewItems(id, name)}
              activeDayPart={activeDayPart}
              filteredCounts={filteredCategoryCounts}
              filteredTotal={filteredTotal}
            />
          ) : (
            /* ── PRODUCT GRID ──────────────────────────────────────────── */
            <div className="p-3 md:p-4">
              {loadingProducts ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-[3/4] rounded-lg bg-gray-100 animate-shimmer" />
                  ))}
                </div>
              ) : productList.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <Package size={32} className="text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-gray-400">
                    {searchQuery ? `No items match "${searchQuery}"` : 'No products in this category'}
                  </p>
                  {searchQuery ? (
                    <button onClick={clearSearch} className="mt-2 text-xs text-primary hover:underline">
                      Clear search
                    </button>
                  ) : (
                    <button onClick={() => { setSearch(''); resetPosView(); }} className="mt-2 text-xs text-primary hover:underline">
                      ← Back to categories
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

      {/* ── RIGHT: Cart panel — desktop + iPad landscape (lg+) ───────────── */}
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
          <div className="mt-3"><CashDrawerWidget /></div>
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
                <span>Tax ({taxRatePct.toFixed(taxRatePct % 1 === 0 ? 0 : 2)}%)</span><span>{fmt(tax)}</span>
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
            <button
              onClick={() => setShowSplit(true)}
              className="w-full h-9 rounded-md border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Split check
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

      {/* ── MOBILE cart ────────────────────────────────────────────────────── */}
      <MobileCart
        open={mobileCartOpen}
        onOpen={() => setMobileCartOpen(true)}
        onClose={() => setMobileCartOpen(false)}
      />

      {/* ── Tablet floating cart button ────────────────────────────────────── */}
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
          onArchive={handleArchiveFromPOS}
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

      {/* ── Employee PIN lock screen ────────────────────────────────────────── */}
      {showEmployeeSelect && <EmployeeSelect onClose={() => setShowEmployeeSelect(false)} />}

      {/* ── Split check ─────────────────────────────────────────────────────── */}
      {showSplit && cart.length > 0 && <SplitCheckModal onClose={() => setShowSplit(false)} />}
    </div>
  );
}
