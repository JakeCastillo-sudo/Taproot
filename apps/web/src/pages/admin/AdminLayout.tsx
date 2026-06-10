/**
 * Admin Portal shell — wraps every /admin/* page (except /admin/login).
 *
 * Guard: if not admin-authenticated → redirect to /admin/login. Renders a dark
 * sidebar (nav + identity + sign out) and an <Outlet/> for the active page.
 */
import { NavLink, Outlet, useNavigate, Navigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  LifeBuoy,
  TrendingUp,
  LogOut,
} from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { useAdminAuthStore } from '../../store/adminAuth.store';

const NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/admin/helpdesk', label: 'Helpdesk', icon: LifeBuoy },
  { to: '/admin/metrics', label: 'Metrics', icon: TrendingUp },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  support: 'Support',
  read_only: 'Read Only',
};

const ROLE_COLOR: Record<string, string> = {
  super_admin: 'bg-primary/20 text-primary-light',
  support: 'bg-blue-500/20 text-blue-300',
  read_only: 'bg-gray-500/20 text-gray-300',
};

export function AdminLayout() {
  const navigate = useNavigate();
  const { isAdminAuthenticated, adminUser, clearAdminAuth } = useAdminAuthStore();

  if (!isAdminAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleSignOut = async () => {
    try {
      await adminApi.auth.logout();
    } catch {
      // Best-effort server revoke — clear locally regardless.
    }
    clearAdminAuth();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-[#111827] text-gray-300 flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white text-sm font-bold">T</span>
          </div>
          <div>
            <div className="text-white text-sm font-semibold leading-tight">Taproot</div>
            <div className="text-[10px] uppercase tracking-wider text-primary-light">Admin</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Identity + sign out */}
        <div className="border-t border-white/10 px-4 py-4">
          <div className="text-[11px] text-gray-500">Logged in as</div>
          <div className="text-sm text-white font-medium truncate">
            {adminUser ? `${adminUser.firstName} ${adminUser.lastName}` : '—'}
          </div>
          <div className="text-[11px] text-gray-500 truncate">{adminUser?.email}</div>
          {adminUser && (
            <span
              className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                ROLE_COLOR[adminUser.role] ?? 'bg-gray-500/20 text-gray-300'
              }`}
            >
              {ROLE_LABEL[adminUser.role] ?? adminUser.role}
            </span>
          )}
          <button
            onClick={() => void handleSignOut()}
            className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-medium text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg py-2 transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto h-screen">
        <Outlet />
      </main>
    </div>
  );
}
