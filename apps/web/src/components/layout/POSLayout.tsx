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
  LayoutGrid, UserCog, Grid3x3, Utensils, CalendarClock, Sparkles, Network, MonitorSmartphone, TrendingUp, CalendarDays, Pencil,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { usePOSStore, type CartItem, type AppliedModifier } from '../../store/pos.store';
import { useUIStore } from '../../store/ui.store';
import { products as productsApi, categories as categoriesApi, settings as settingsApi, discounts as discountsApi, franchise as franchiseApi, type ProductWithModifiers } from '../../lib/api';
import { setPosTaxRate } from '../../store/pos.store';
import { initDisplayBroadcast, openCustomerDisplay } from '../../lib/displayChannel';
import { canAccessSettings } from '../../lib/session';
import { useCapabilities } from '../../hooks/useCapabilities';
import { allergenConflicts, allergenLabel, buildAllergenNote, ALLERGEN_NOTE_PREFIX } from '../../lib/allergens';
import { IntelligenceFeed } from '../ai/IntelligenceFeed';
import { customers as customersApi, timeclock as timeclockApi } from '../../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { QK } from '../../lib/queryClient';
import { CustomerSearch } from '../pos/CustomerSearch';
import { CategoryTileGrid } from '../pos/CategoryTileGrid';
import { WaitTimeCard } from '../pos/WaitTimeCard';
import { InventoryAlertCard } from '../pos/InventoryAlertCard';
import { DayPartToggle } from '../pos/DayPartToggle';
import { ModifierSheet, type ModifierSheetProduct } from '../pos/ModifierSheet';
import { EmployeeSelect } from '../pos/EmployeeSelect';
import { CashDrawerWidget } from '../pos/CashDrawerWidget';
import { SplitCheckModal } from '../pos/SplitCheckModal';
import { TableView } from '../pos/TableView';
import { OnlineOrdersBell } from '../pos/OnlineOrdersBell';
import { LocationSwitcher } from '../pos/LocationSwitcher';
import { PaymentSheet } from '../pos/PaymentSheet';
import { MobileCart } from '../pos/MobileCart';
import { SyncStatus } from '../ui/SyncStatus';
import { CommandPalette, type CommandAction } from '../ui/CommandPalette';
import { useBarcode } from '../../hooks/useBarcode';
import { useOfflineSync } from '../../hooks/useOfflineSync';
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

function CartLine({ item, onEdit }: { item: CartItem; onEdit?: () => void }) {
  const updateQuantity = usePOSStore((s) => s.updateQuantity);
  const removeFromCart = usePOSStore((s) => s.removeFromCart);

  return (
    <div className="flex items-start gap-2 py-3 border-b border-gray-50 last:border-0 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
          {item.notes?.startsWith(ALLERGEN_NOTE_PREFIX) && (
            <AlertTriangle size={12} className="text-red-500 shrink-0" aria-label="Allergen alert" />
          )}
          <span className="truncate">{item.name}</span>
          {onEdit && (
            <button
              onClick={onEdit}
              className="shrink-0 p-0.5 text-gray-300 hover:text-primary transition-colors"
              aria-label={`Edit ${item.name}`}
              title="Edit modifiers"
            >
              <Pencil size={14} />
            </button>
          )}
        </p>
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
  /** Short (≤8 char) label shown under the icon when the sidebar is collapsed. */
  short?: string;
  path:  string;
  /**
   * v2.0 capability gate. If set, this item only renders when the org has that
   * capability on. Items with NO `cap` (all of today's restaurant nav) always
   * render → default-on, so existing behavior is unchanged. Studio/retail nav
   * attaches here in v2.1+.
   */
  cap?:  'studio' | 'retail';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'pos',       icon: <ShoppingCart size={18} />, label: 'Register',  path: '/' },
  { id: 'orders',    icon: <FileText size={18} />,     label: 'Orders',    path: '/orders' },
  { id: 'inventory', icon: <Package size={18} />,      label: 'Inventory', short: 'Menu',    path: '/inventory' },
  { id: 'reports',   icon: <BarChart3 size={18} />,    label: 'Reports',   path: '/reports' },
  { id: 'analytics', icon: <TrendingUp size={18} />,   label: 'Analytics', path: '/analytics' },
  { id: 'insights',  icon: <Sparkles size={18} />,     label: 'Insights',  short: 'AI',      path: '/insights' },
  { id: 'kitchen',   icon: <Utensils size={18} />,     label: 'Kitchen',   path: '/kitchen' },
  { id: 'schedule',  icon: <CalendarDays size={18} />, label: 'Schedule',  path: '/schedule' },
  { id: 'reserve',   icon: <CalendarClock size={18} />,label: 'Reservations', short: 'Reserve', path: '/reservations' },
  { id: 'customers', icon: <User size={18} />,         label: 'Customers', path: '/customers' },
  { id: 'import',    icon: <Upload size={18} />,       label: 'Import',    path: '/import' },
  { id: 'migrate',   icon: <ArrowRightLeft size={18}/>,label: 'Migrate',   path: '/migrate' },
  { id: 'settings',  icon: <Settings size={18} />,     label: 'Settings',  path: '/settings' },
  { id: 'customize', icon: <LayoutGrid size={18} />,   label: 'Customize', short: 'Layout',  path: '/settings/dashboard' },
  // ── v2.1+ capability-gated nav SEAM (kept commented until those features land) ──
  // These render only when the org has the matching capability (see the gate in
  // the Sidebar navItems memo). Example shape — DO NOT uncomment until built:
  // { id: 'classes',     icon: <Dumbbell size={18} />,   label: 'Classes',     path: '/studio/classes',     cap: 'studio' },
  // { id: 'members',     icon: <Users size={18} />,      label: 'Members',     path: '/studio/members',     cap: 'studio' },
  // { id: 'retail',      icon: <ShoppingBag size={18} />, label: 'Retail',     path: '/retail',             cap: 'retail' },
];

// ─── Clock-out button (S9-02) ─────────────────────────────────────────────────
// Shows in the top bar while the logged-in employee has an open time-clock
// entry. Resilient: /timeclock/current returns null pre-migration → hidden.

function ClockOutButton() {
  const qc2 = useQueryClient();
  const { data: entry } = useQuery({
    queryKey: ['timeclock', 'current'],
    queryFn:  timeclockApi.current,
    staleTime: 60_000,
    retry: false,
  });

  if (!entry) return null;

  const startedAt = new Date(entry.clocked_in_at);
  const hours = Math.max(0, (Date.now() - startedAt.getTime()) / 3_600_000);

  const handleClockOut = () => {
    if (!window.confirm(`Clock out now? You've been on the clock ${hours.toFixed(1)}h.`)) return;
    void timeclockApi.clockOut().then((e) => {
      showToast.success(`Clocked out — ${e.hours_worked ?? hours.toFixed(1)}h worked`);
      void qc2.invalidateQueries({ queryKey: ['timeclock'] });
    }).catch((err: unknown) => {
      showToast.error(err instanceof Error ? err.message : 'Clock-out failed');
    });
  };

  return (
    <button
      onClick={handleClockOut}
      title={`On the clock since ${startedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
      className="hidden md:flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-primary/30 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors shrink-0"
    >
      <CalendarClock size={13} />
      Clock out · {hours.toFixed(1)}h
    </button>
  );
}

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

  // Franchise nav item — only for franchisor orgs (S8-01). Non-fatal: hidden on error.
  const { data: frInfo } = useQuery({
    queryKey: ['franchise', 'info'],
    queryFn:  franchiseApi.info,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Restaurant name for the header brand (falls back to "Taproot POS" until loaded).
  const { data: business } = useQuery({
    queryKey: ['settings', 'business'],
    queryFn:  settingsApi.getBusiness,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const orgName      = business?.orgName?.trim() || 'Taproot POS';
  const avatarLetter = (business?.orgName?.trim()?.charAt(0) || 'T').toUpperCase();

  // v2.0 capability spine. Fail-open: unknown/loading/errored → restaurant defaults,
  // so nothing is hidden for existing orgs (caps.studio/retail default false → no
  // capability-gated items exist today anyway).
  const { capabilities: caps } = useCapabilities();

  const navItems = useMemo(() => {
    // Analytics + Schedule are manager/owner only
    let items = canAccessSettings()
      ? [...NAV_ITEMS]
      : NAV_ITEMS.filter((i) => i.id !== 'analytics' && i.id !== 'schedule');
    // v2.0 capability gate: hide items that REQUIRE a capability the org lacks.
    // Items with no `cap` (all of today's restaurant nav) always pass → default-on.
    items = items.filter((i) => !i.cap || Boolean(caps[i.cap]));
    if (frInfo?.orgType === 'franchisor') {
      items = [...items];
      const idx = items.findIndex((i) => i.id === 'import');
      items.splice(idx === -1 ? items.length : idx, 0, {
        id: 'franchise', icon: <Network size={18} />, label: 'Franchise', path: '/franchise',
      });
    }
    return items;
  }, [frInfo?.orgType, caps]);

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
          {/* Letter avatar — placeholder for a future uploaded logo */}
          <div
            className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0"
            title={orgName}
          >
            <span className="text-white text-sm font-bold">{avatarLetter}</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{orgName}</p>
              <LocationSwitcher />
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
      <nav className="flex-1 overflow-y-auto min-h-0 px-2 py-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => { navigate(item.path); onClose?.(); }}
              className={clsx(
                'w-full flex rounded-md text-sm font-medium transition-colors',
                collapsed
                  ? 'flex-col items-center gap-1 px-1 py-2 min-h-[48px]'
                  : 'items-center gap-2.5 px-3 py-2.5 min-h-[40px]',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
              )}
            >
              <span className={clsx('shrink-0', isActive && 'text-primary')}>
                {item.icon}
              </span>
              {collapsed ? (
                // Always show a short label under the icon so the emoji-only nav is legible.
                <span className={clsx(
                  'text-[10px] leading-none text-center truncate max-w-full',
                  isActive ? 'text-primary' : 'text-gray-400',
                )}>
                  {item.short ?? item.label}
                </span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
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
    clearCart, appliedDiscount, setAppliedDiscount, isOffline,
  } = usePOSStore();

  useOfflineSync();

  const handleAddDiscount = useCallback(async () => {
    if (appliedDiscount) { setAppliedDiscount(null); showToast.info('Discount removed'); return; }
    const code = window.prompt('Enter discount code:');
    if (!code?.trim()) return;
    try {
      const v = await discountsApi.validate(code.trim(), subtotal());
      setAppliedDiscount({ code: v.code, amount: v.amount });
      showToast.success(`${v.name} applied — −${fmt(v.amount)}`);
    } catch (e) {
      showToast.error(e instanceof Error ? e.message : 'Invalid code');
    }
  }, [appliedDiscount, setAppliedDiscount, subtotal]);

  const {
    sidebarCollapsed, toggleSidebar,
    posViewMode, selectedCategoryId, selectedCategoryName,
    setPosViewItems, resetPosView,
    activeDayPart, setActiveDayPart,
  } = useUIStore();

  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<ModifierSheetProduct | null>(null);
  // Recipe-aware modifier mode (ingredient system). True only when the open product
  // has recipe_mode=true → drives the /modifiers/pos fetch + 3-section sheet UI.
  const [recipeModeOpen, setRecipeModeOpen] = useState(false);
  // Cart "edit modifiers" context — set when the cashier taps a cart line's pencil.
  const [editCartItemId, setEditCartItemId] = useState<string | null>(null);
  const [editInit, setEditInit] = useState<{ modifiers: AppliedModifier[]; notes: string; quantity: number } | null>(null);
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

  // Mirror cart + payment events to the customer-facing display (S8-02)
  useEffect(() => initDisplayBroadcast(), []);

  // Owner/manager daily intelligence feed as the landing view (S9-04).
  // Cashiers skip it; dismissal sticks for the rest of the day (per tab).
  const [showFeed, setShowFeed] = useState(() => {
    if (!canAccessSettings()) return false;
    try { return sessionStorage.getItem('taproot_feed_dismissed') !== new Date().toISOString().slice(0, 10); }
    catch { return true; }
  });
  const dismissFeed = useCallback(() => {
    try { sessionStorage.setItem('taproot_feed_dismissed', new Date().toISOString().slice(0, 10)); } catch { /* ignore */ }
    setShowFeed(false);
  }, []);

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
    setRecipeModeOpen(product.recipe_mode === true);
    setModifierProduct(pSheet);
    setEditCartItemId(null);
    setEditInit(null);
    setModifierSheetOpen(true);
  }, [setModifierSheetOpen]);

  // Recipe-aware POS modifiers — fetched ONLY for recipe_mode products (ingredient
  // system). recipe_mode=false products never hit this; they use product.modifierGroups.
  const posModifiersQuery = useQuery({
    queryKey: ['pos-modifiers', modifierProduct?.id],
    queryFn:  () => productsApi.posModifiers(modifierProduct!.id),
    enabled:  recipeModeOpen && !!modifierProduct?.id,
    staleTime: 60_000,
  });

  // Product IDs (in the current view) that have modifier groups — used to show the
  // cart edit pencil even on lines that don't yet have a modifier selected.
  const modifierProductIds = useMemo(
    () => new Set(productList.filter((p) => (p.modifierGroups?.length ?? 0) > 0).map((p) => p.id)),
    [productList],
  );

  /** Open the modifier sheet to EDIT an existing cart line (pre-checked + in place). */
  const handleEditCartItem = useCallback((item: CartItem) => {
    const product = productList.find((p) => p.id === item.productId);
    let pSheet: ModifierSheetProduct;
    if (product && (product.modifierGroups?.length ?? 0) > 0) {
      // Full group structure available → cashier can add/remove any option.
      pSheet = {
        id:             product.id,
        variantId:      item.variantId,
        name:           item.name,
        sku:            item.sku,
        basePrice:      item.unitPrice,
        modifierGroups: (product.modifierGroups ?? []).map((g) => ({
          id:            g.id,
          name:          g.name,
          selectionType: g.selectionType,
          minSelections: g.minSelections,
          maxSelections: g.maxSelections,
          sortOrder:     g.sortOrder,
          modifiers:     g.modifiers.map((m) => ({
            id: m.id, name: m.name, priceDelta: m.priceDelta, isDefault: m.isDefault, sortOrder: m.sortOrder,
          })),
        })),
      };
    } else {
      // Product not in the current view (e.g. archived / other category) — reconstruct
      // an editable group from the line's own modifiers so editing still works.
      pSheet = {
        id:        item.productId,
        variantId: item.variantId,
        name:      item.name,
        sku:       item.sku,
        basePrice: item.unitPrice,
        modifierGroups: item.modifiers.length > 0 ? [{
          id:            '__current__',
          name:          'Modifiers',
          selectionType: 'multiple',
          minSelections: 0,
          maxSelections: null,
          sortOrder:     0,
          modifiers: item.modifiers.map((m, i) => ({
            id: m.modifierId, name: m.name, priceDelta: m.priceDelta, isDefault: true, sortOrder: i,
          })),
        }] : [],
      };
    }
    setRecipeModeOpen(product?.recipe_mode === true);
    setModifierProduct(pSheet);
    setEditCartItemId(item.id);
    setEditInit({ modifiers: item.modifiers, notes: item.notes, quantity: item.quantity });
    setModifierSheetOpen(true);
  }, [productList, setModifierSheetOpen]);

  // ── Allergen guard (S8-05) ─────────────────────────────────────────────────
  // When a customer with an allergen profile is attached and a tapped product
  // contains a matching allergen, warn BEFORE the item reaches the cart.
  const cartCustomerId = usePOSStore((s) => s.customerId);
  const { data: attachedCustomer } = useQuery({
    queryKey: ['customer-detail', cartCustomerId],
    queryFn:  () => customersApi.get(cartCustomerId as string),
    enabled:  Boolean(cartCustomerId),
    staleTime: 60_000,
  });
  const [allergenAlert, setAllergenAlert] = useState<{
    productName: string;
    conflicts:   string[];
    proceed:     () => void;
  } | null>(null);

  const addDirectToCart = useCallback((product: Product & { defaultPrice?: number }, notes = '') => {
    const p = product as ProductWithModifiers;
    usePOSStore.getState().addToCart({
      productId: product.id,
      variantId: p.variants?.[0]?.id ?? null,
      name:      product.name,
      sku:       product.sku ?? '',
      quantity:  1,
      unitPrice: product.defaultPrice ?? 0,
      modifiers: [],
      notes,
    });
    showToast.success(`Added: ${product.name}`, { duration: 1200 });
  }, []);

  const handleProductTap = useCallback((product: Product & { defaultPrice?: number }) => {
    const p = product as ProductWithModifiers;
    const groups = p.modifierGroups ?? [];

    const conflicts = allergenConflicts(p.allergens, attachedCustomer?.allergens);
    if (conflicts.length > 0) {
      setAllergenAlert({
        productName: p.name,
        conflicts,
        proceed: () => {
          if (groups.length > 0 || p.recipe_mode) openModifierSheet(p);
          else addDirectToCart(product, buildAllergenNote(conflicts));
        },
      });
      return;
    }

    if (groups.length > 0 || p.recipe_mode) {
      // Has modifier groups, or is a recipe-mode product (show recipe sheet +
      // universal add-ons even if there are no base groups) — open the sheet.
      openModifierSheet(p);
    } else {
      // No modifiers — add directly (fast path)
      addDirectToCart(product);
    }
  }, [openModifierSheet, addDirectToCart, attachedCustomer?.allergens]);

  const handleProductLongPress = useCallback((product: Product & { defaultPrice?: number }) => {
    const p = product as ProductWithModifiers;
    const conflicts = allergenConflicts(p.allergens, attachedCustomer?.allergens);
    if (conflicts.length > 0) {
      setAllergenAlert({ productName: p.name, conflicts, proceed: () => openModifierSheet(p) });
      return;
    }
    // Long-press always opens sheet (even without modifiers — for notes / qty)
    openModifierSheet(p);
  }, [openModifierSheet, attachedCustomer?.allergens]);

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
    <div className="h-screen flex flex-col overflow-hidden bg-surface-2">

      {/* ── Offline banner ────────────────────────────────────────────────── */}
      {isOffline && (
        <div className="shrink-0 bg-red-600 text-white text-xs font-medium text-center py-1.5 flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          Working offline — orders will sync when the connection returns
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">
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

          {/* Clock-out (visible while on the clock, S9-02) */}
          <ClockOutButton />

          {/* Customer display (second screen) */}
          <button
            onClick={openCustomerDisplay}
            title="Open customer display"
            className="hidden md:flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Open customer display"
          >
            <MonitorSmartphone size={14} />
          </button>

          {/* Online orders bell */}
          <OnlineOrdersBell />

          {/* Day-part toggle */}
          <DayPartToggle
            active={activeDayPart}
            onChange={setActiveDayPart}
            compact
          />

          {/* Exit POS → Settings / menu editing (subtle, not a POS action) */}
          <button
            onClick={() => navigate('/settings')}
            title="Settings"
            className="hidden md:flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Settings"
          >
            <Settings size={14} />
            <span className="hidden lg:inline">Settings</span>
          </button>

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
        <div className="flex-1 overflow-y-auto min-h-0">
          {showFeed && floorMode === 'grid' && !searchQuery && posViewMode === 'categories' ? (
            /* ── OWNER DAILY INTELLIGENCE FEED (S9-04) + WAIT TIME (FEAT-WAIT-001) ── */
            <>
              <WaitTimeCard />
              <InventoryAlertCard />
              <IntelligenceFeed onStartOrders={dismissFeed} />
            </>
          ) : floorMode === 'table' ? (
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
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-36 text-center">
              <ShoppingCart size={28} className="text-gray-200 mb-2" />
              <p className="text-sm text-gray-400">Cart is empty</p>
              <p className="text-xs text-gray-300 mt-1">Tap a product to add it</p>
            </div>
          ) : (
            <div>{cart.map((item) => (
              <CartLine
                key={item.id}
                item={item}
                onEdit={
                  (item.modifiers.length > 0 || modifierProductIds.has(item.productId))
                    ? () => handleEditCartItem(item)
                    : undefined
                }
              />
            ))}</div>
          )}
        </div>

        {/* Totals + actions */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-3 shrink-0 space-y-2">
            <button onClick={() => void handleAddDiscount()} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark transition-colors">
              <Tag size={11} /> {appliedDiscount ? `Remove discount (${appliedDiscount.code})` : 'Add discount'}
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
          cartItemId={editCartItemId ?? undefined}
          initialModifiers={editInit?.modifiers}
          initialNotes={editInit?.notes}
          initialQuantity={editInit?.quantity}
          recipeMode={recipeModeOpen}
          posModifierData={recipeModeOpen ? posModifiersQuery.data : undefined}
          onClose={() => { setModifierProduct(null); setModifierSheetOpen(false); setEditCartItemId(null); setEditInit(null); setRecipeModeOpen(false); }}
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

      {/* ── Allergen alert (S8-05) ──────────────────────────────────────────── */}
      {allergenAlert && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto border-2 border-red-400">
            <div className="px-5 py-4 bg-red-50 border-b border-red-200 flex items-center gap-2">
              <AlertTriangle size={20} className="text-red-600 shrink-0" />
              <h2 className="text-base font-bold text-red-700">Allergen Alert</h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-800 leading-relaxed">
                <strong>{usePOSStore.getState().customerName ?? 'This customer'}</strong> has
                a <strong>{allergenAlert.conflicts.map(allergenLabel).join(', ')}</strong> allergy
                on file.
              </p>
              <p className="text-sm text-gray-800 mt-2 leading-relaxed">
                <strong>{allergenAlert.productName}</strong> contains{' '}
                <strong>{allergenAlert.conflicts.map(allergenLabel).join(', ')}</strong>.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 space-y-2">
              <button
                onClick={() => setAllergenAlert(null)}
                className="w-full h-11 bg-gray-800 text-white rounded-md text-sm font-semibold hover:bg-gray-900"
              >
                Remove this item
              </button>
              <button
                onClick={() => { const a = allergenAlert; setAllergenAlert(null); a.proceed(); }}
                className="w-full h-11 border border-red-300 text-red-700 rounded-md text-sm font-semibold hover:bg-red-50"
              >
                Add anyway — customer confirmed safe
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
