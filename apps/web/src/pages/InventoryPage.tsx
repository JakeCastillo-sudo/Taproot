/**
 * InventoryPage — 5-tab inventory management view:
 *   Stock Levels | Forecast | Recipes | Variance Reports | Archived
 *
 * Reads locationId from the stored user (first location).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, TrendingDown, ChefHat, FileBarChart2,
  ClipboardList, ArrowLeft, Layers, Archive,
} from 'lucide-react';
import { clsx } from 'clsx';
import { USER_KEY } from '../lib/api';
import { StockLevels }       from '../components/inventory/StockLevels';
import { ForecastDashboard } from '../components/inventory/ForecastDashboard';
import { RecipesManager }    from '../components/inventory/RecipesManager';
import { VarianceReports }   from '../components/inventory/VarianceReports';
import { ArchivedProducts }  from '../components/inventory/ArchivedProducts';
import { StockCountSheet }   from '../components/inventory/StockCountSheet';
import { ToastContainer }    from '../components/ui/Toast';

// ─── Tab config ───────────────────────────────────────────────────────────────

type TabId = 'stock' | 'forecast' | 'recipes' | 'variance' | 'archived';

interface Tab { id: TabId; label: string; icon: React.FC<{ size?: number; className?: string }> }

const TABS: Tab[] = [
  { id: 'stock',    label: 'Stock Levels',      icon: Package       },
  { id: 'forecast', label: 'Forecast',           icon: TrendingDown  },
  { id: 'recipes',  label: 'Recipes',            icon: ChefHat       },
  { id: 'variance', label: 'Variance Reports',   icon: FileBarChart2 },
  { id: 'archived', label: 'Archived',           icon: Archive       },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLocationId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const u = JSON.parse(raw) as { locationIds?: string[] };
      if (u.locationIds?.[0]) return u.locationIds[0];
    }
  } catch { /* ignore */ }
  // Fallback to hardcoded demo location
  return '20000000-0000-0000-0000-000000000001';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const navigate = useNavigate();
  const locationId = getLocationId();

  const [activeTab,       setActiveTab]       = useState<TabId>('stock');
  const [showStockCount,  setShowStockCount]  = useState(false);

  return (
    <div className="min-h-screen bg-surface-2 flex flex-col">

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-gray-100 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          {/* Back to POS */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={14} /> POS
          </button>

          {/* Title */}
          <div className="flex items-center gap-2 ml-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center">
              <Layers size={15} className="text-primary" />
            </div>
            <h1 className="text-base font-bold text-gray-900">Inventory</h1>
          </div>

          <div className="flex-1" />

          {/* Stock count action */}
          {activeTab === 'stock' && (
            <button
              onClick={() => setShowStockCount(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark transition-colors"
            >
              <ClipboardList size={13} /> Stock Count
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-0 border-t border-gray-50">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ── Content ── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'stock' && (
          <StockLevels locationId={locationId} />
        )}
        {activeTab === 'forecast' && (
          <ForecastDashboard locationId={locationId} />
        )}
        {activeTab === 'recipes' && (
          <RecipesManager />
        )}
        {activeTab === 'variance' && (
          <VarianceReports locationId={locationId} />
        )}
        {activeTab === 'archived' && (
          <ArchivedProducts locationId={locationId} />
        )}
      </main>

      {/* Stock count modal */}
      {showStockCount && (
        <StockCountSheet
          locationId={locationId}
          onClose={() => setShowStockCount(false)}
        />
      )}

      <ToastContainer />
    </div>
  );
}
