/**
 * SettingsLayout — shared shell for all /settings/* admin pages.
 *
 * Left sidebar nav (desktop) collapses to a horizontal scrollable tab bar on
 * mobile. Renders the active settings page through <Outlet/>.
 *
 * Permission guard: only owner/manager roles may access settings. Cashier /
 * kitchen / readonly are redirected to the register with a toast.
 */

import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Package, FolderTree, SlidersHorizontal, Users, Building2,
  CreditCard, LayoutGrid, ChevronLeft, LayoutDashboard, QrCode, Globe, Star, Gift, Tag, MapPin,
} from 'lucide-react';
import { clsx } from 'clsx';
import { canAccessSettings } from '../../lib/session';
import { showToast } from '../ui/Toast';

interface SettingsNavItem {
  to:    string;
  label: string;
  icon:  React.ReactNode;
}

const NAV: SettingsNavItem[] = [
  { to: '/settings/products',   label: 'Products',   icon: <Package size={17} /> },
  { to: '/settings/categories', label: 'Categories', icon: <FolderTree size={17} /> },
  { to: '/settings/modifiers',  label: 'Modifiers',  icon: <SlidersHorizontal size={17} /> },
  { to: '/settings/employees',  label: 'Employees',  icon: <Users size={17} /> },
  { to: '/settings/business',   label: 'Business',   icon: <Building2 size={17} /> },
  { to: '/settings/locations',  label: 'Locations',  icon: <MapPin size={17} /> },
  { to: '/settings/payments',   label: 'Payments',   icon: <CreditCard size={17} /> },
  { to: '/settings/floor-plan', label: 'Floor Plan', icon: <LayoutDashboard size={17} /> },
  { to: '/settings/qr-codes',   label: 'QR Codes',   icon: <QrCode size={17} /> },
  { to: '/settings/online-ordering', label: 'Online Ordering', icon: <Globe size={17} /> },
  { to: '/settings/loyalty',    label: 'Loyalty',    icon: <Star size={17} /> },
  { to: '/settings/gift-cards', label: 'Gift Cards', icon: <Gift size={17} /> },
  { to: '/settings/discounts',  label: 'Discounts',  icon: <Tag size={17} /> },
  { to: '/settings/dashboard',  label: 'Dashboard',  icon: <LayoutGrid size={17} /> },
];

export function SettingsLayout() {
  const navigate = useNavigate();

  // Permission guard — redirect non-admins to the register.
  useEffect(() => {
    if (!canAccessSettings()) {
      showToast.error("You don't have permission to access settings");
      navigate('/', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="h-screen flex flex-col lg:flex-row overflow-hidden bg-surface-2">
      {/* ── Sidebar (desktop) ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100">
        <div className="px-4 py-4 border-b border-gray-100 shrink-0">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={16} /> Back to Register
          </button>
          <h1 className="mt-3 text-lg font-bold text-gray-900">Settings</h1>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-800',
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Mobile top tab bar ────────────────────────────────────────────── */}
      <div className="lg:hidden shrink-0 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors shrink-0"
            aria-label="Back to register"
          >
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <h1 className="text-base font-bold text-gray-900">Settings</h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 no-scrollbar">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => clsx(
                'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              )}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* ── Active page ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
