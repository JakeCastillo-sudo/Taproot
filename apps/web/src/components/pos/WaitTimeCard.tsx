/**
 * WaitTimeCard — compact, manager/owner-only wait-time row for the POS dashboard
 * (rendered above the daily IntelligenceFeed). Auto-refreshes every 30s. Hidden
 * when wait-time is disabled in settings. NOT shown on the register/cashier view.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Flame } from 'lucide-react';
import { clsx } from 'clsx';
import { waitTime as waitTimeApi } from '../../lib/api';
import { getLocationId } from '../../lib/session';
import { showToast } from '../ui/Toast';

function waitText(mins: number): string {
  if (mins > 30) return 'text-red-600';
  if (mins >= 15) return 'text-amber-600';
  return 'text-green-600';
}

export function WaitTimeCard() {
  const qc = useQueryClient();
  const locationId = getLocationId();

  const { data: cfg } = useQuery({
    queryKey: ['waitTime', 'config', locationId],
    queryFn:  () => waitTimeApi.getConfig(locationId),
    staleTime: 60_000,
    enabled: !!locationId,
  });
  const { data: wait } = useQuery({
    queryKey: ['waitTime', locationId],
    queryFn:  () => waitTimeApi.get(locationId),
    refetchInterval: 30_000,
    enabled: !!locationId,
  });

  const rush = useMutation({
    mutationFn: (enabled: boolean) =>
      waitTimeApi.setRush(locationId, { enabled, extraMinutes: cfg?.rushExtraMinutes ?? 15, durationMinutes: 60 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['waitTime'] }),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Could not update rush mode'),
  });

  const toggleRush = () => {
    if (!wait) return;
    if (!wait.rushMode) {
      if (window.confirm(`Enable Rush Mode? Adds +${cfg?.rushExtraMinutes ?? 15} min to estimates and auto-expires in 60 min.`)) rush.mutate(true);
    } else if (window.confirm('End Rush Mode now?')) {
      rush.mutate(false);
    }
  };

  // Hidden when disabled or before the first estimate loads.
  if (cfg && !cfg.enabled) return null;
  if (!wait) return null;

  return (
    <div className="mx-4 mt-4 bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
      <div className="flex items-center gap-2 shrink-0">
        <Clock size={18} className="text-gray-400" />
        <span className="text-sm font-medium text-gray-600">Current wait</span>
      </div>
      <div className="flex-1 min-w-0">
        <span className={clsx('text-xl font-extrabold', waitText(wait.estimatedMinutes))}>
          {wait.displayText}
        </span>
        <p className="text-xs text-gray-400 mt-0.5">
          Queue: {wait.queueDepth} order{wait.queueDepth !== 1 ? 's' : ''} · {wait.queueItemCount} item{wait.queueItemCount !== 1 ? 's' : ''}
          {wait.rushMode && <span className="ml-1 text-red-600 font-semibold">· Rush on</span>}
        </p>
      </div>
      <button
        onClick={toggleRush}
        disabled={rush.isPending}
        className={clsx('shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 disabled:opacity-50',
          wait.rushMode ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
      >
        <Flame size={13} /> {wait.rushMode ? 'Rush Active' : 'Rush Mode'}
      </button>
    </div>
  );
}
