/**
 * InventoryAlertCard — compact, manager/owner-only stock-alert row for the POS
 * dashboard (rendered below WaitTimeCard, above the IntelligenceFeed). Hidden
 * unless something is out of stock or below reorder. NOT shown to cashiers / on
 * the register. Auto-refreshes every 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { ingredientsApi } from '../../lib/api';
import { canAccessSettings } from '../../lib/session';

export function InventoryAlertCard() {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['inventory', 'alerts'],
    queryFn:  () => ingredientsApi.alerts(),
    refetchInterval: 300_000, // 5 min
    staleTime: 60_000,
    enabled: canAccessSettings(),
  });

  const out = data?.outOfStockCount ?? 0;
  const crit = data?.criticalCount ?? 0;

  // Only surface genuinely urgent states (out of stock / need reorder).
  if (out === 0 && crit === 0) return null;

  const urgent = out > 0; // red when anything is fully out, else amber

  return (
    <div className={clsx('mx-4 mt-4 rounded-xl px-4 py-3 flex items-center gap-3 border',
      urgent ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200')}>
      <AlertTriangle size={18} className={clsx('shrink-0', urgent ? 'text-red-600' : 'text-amber-600')} />
      <p className={clsx('flex-1 min-w-0 text-sm font-medium', urgent ? 'text-red-700' : 'text-amber-700')}>
        {out > 0 && <>🔴 {out} item{out !== 1 ? 's' : ''} out of stock</>}
        {out > 0 && crit > 0 && <span className="mx-1">·</span>}
        {crit > 0 && <>⚠️ {crit} need{crit === 1 ? 's' : ''} reorder</>}
      </p>
      <button
        onClick={() => navigate('/settings/inventory')}
        className={clsx('shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold text-white',
          urgent ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500')}
      >
        View Inventory <ArrowRight size={13} />
      </button>
    </div>
  );
}
