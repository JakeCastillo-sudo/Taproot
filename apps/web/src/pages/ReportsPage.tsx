/**
 * ReportsPage — 5-tab reporting and analytics dashboard.
 *
 * Tabs: Dashboard | Sales | Products | Customers | Staff
 *
 * Header: date range picker (presets + custom), export button.
 * NL query bar at top.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, ArrowLeft, LayoutDashboard, ShoppingBag,
  Package, Users, UserCheck, Calendar, ChevronDown, Coins, CalendarDays,
} from 'lucide-react';
import { clsx } from 'clsx';
import { USER_KEY } from '../lib/api';
import {
  PRESETS, presetToRange, toApiParams, fmtDateRange,
  toInputDate, type PresetId,
} from '../lib/dateRanges';
import { NLQueryBar }     from '../components/reports/NLQueryBar';
import { DashboardTab }   from '../components/reports/DashboardTab';
import { SalesTab }       from '../components/reports/SalesTab';
import { ProductsTab }    from '../components/reports/ProductsTab';
import { CustomersTab }   from '../components/reports/CustomersTab';
import { StaffTab }       from '../components/reports/StaffTab';
import { TipsTab }        from '../components/reports/TipsTab';
import { ToastContainer } from '../components/ui/Toast';

// ─── Tab config ───────────────────────────────────────────────────────────────

type TabId = 'dashboard' | 'sales' | 'products' | 'customers' | 'staff' | 'tips';

const TABS: Array<{ id: TabId; label: string; icon: React.FC<{ size?: number; className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sales',     label: 'Sales',     icon: ShoppingBag     },
  { id: 'products',  label: 'Products',  icon: Package         },
  { id: 'customers', label: 'Customers', icon: Users           },
  { id: 'staff',     label: 'Staff',     icon: UserCheck       },
  { id: 'tips',      label: 'Tips',      icon: Coins           },
];

// ─── Location helper ──────────────────────────────────────────────────────────

function getLocationId(): string | undefined {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const u = JSON.parse(raw) as { locationIds?: string[] };
      return u.locationIds?.[0];
    }
  } catch { /* ignore */ }
  return undefined;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const navigate = useNavigate();
  const locationId = getLocationId();

  const [activeTab,    setActiveTab]    = useState<TabId>('dashboard');
  const [presetId,     setPresetId]     = useState<PresetId>('last7');
  const [customFrom,   setCustomFrom]   = useState(toInputDate(presetToRange('last7').from));
  const [customTo,     setCustomTo]     = useState(toInputDate(presetToRange('last7').to));
  const [showPicker,   setShowPicker]   = useState(false);

  const dateRange = presetId === 'custom'
    ? { from: new Date(customFrom), to: new Date(customTo + 'T23:59:59') }
    : presetToRange(presetId);

  const apiParams = {
    ...toApiParams(dateRange),
    locationId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  function selectPreset(id: PresetId) {
    setPresetId(id);
    if (id !== 'custom') {
      setShowPicker(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-2 flex flex-col">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          {/* Back */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} /> POS
          </button>

          {/* Title */}
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
              <BarChart3 size={15} className="text-primary" />
            </div>
            <h1 className="text-base font-bold text-gray-900">Reports</h1>
          </div>

          <div className="flex-1" />

          {/* End of Day shortcut */}
          <button
            onClick={() => navigate('/reports/end-of-day')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors mr-2"
          >
            <CalendarDays size={13} /> End of Day
          </button>

          {/* Date range picker */}
          <div className="relative">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Calendar size={13} className="text-gray-400" />
              <span>{presetId === 'custom' ? fmtDateRange(dateRange) : PRESETS.find((p) => p.id === presetId)?.label}</span>
              <ChevronDown size={12} className="text-gray-400" />
            </button>

            {showPicker && (
              <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPreset(p.id)}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                      presetId === p.id
                        ? 'bg-primary text-white'
                        : 'text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    {p.label}
                  </button>
                ))}

                {/* Custom date inputs */}
                {presetId === 'custom' && (
                  <div className="mt-2 p-2 bg-gray-50 rounded-lg space-y-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">From</label>
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="w-full py-1.5 px-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">To</label>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="w-full py-1.5 px-2 border border-gray-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <button
                      onClick={() => setShowPicker(false)}
                      className="w-full h-8 bg-primary text-white rounded-md text-sm font-medium"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-0 border-t border-gray-50 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {/* NL Query bar — always visible */}
        <NLQueryBar />

        {activeTab === 'dashboard'  && <DashboardTab  params={apiParams} locationId={locationId} />}
        {activeTab === 'sales'      && <SalesTab      params={apiParams} />}
        {activeTab === 'products'   && <ProductsTab   params={apiParams} />}
        {activeTab === 'customers'  && <CustomersTab  params={apiParams} />}
        {activeTab === 'staff'      && <StaffTab      params={apiParams} />}
        {activeTab === 'tips'       && <TipsTab       params={apiParams} />}
      </main>

      <ToastContainer />
    </div>
  );
}
