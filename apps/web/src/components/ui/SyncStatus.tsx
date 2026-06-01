import { useState } from 'react';
import { Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { usePOSStore } from '../../store/pos.store';
import { clsx } from 'clsx';

export function SyncStatus() {
  const isOffline        = usePOSStore((s) => s.isOffline);
  const pendingSyncCount = usePOSStore((s) => s.pendingSyncCount);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
          isOffline
            ? 'bg-red-50 text-red-700 hover:bg-red-100'
            : 'bg-green-50 text-green-700 hover:bg-green-100',
        )}
        aria-label={isOffline ? 'Offline mode' : 'Online — synced'}
      >
        {isOffline ? (
          <WifiOff size={13} className="shrink-0" />
        ) : (
          <Wifi size={13} className="shrink-0" />
        )}
        <span className="hidden sm:inline">
          {isOffline
            ? `Offline${pendingSyncCount > 0 ? ` — ${pendingSyncCount} queued` : ''}`
            : 'Synced'}
        </span>
        {/* dot indicator for compact view */}
        <span
          className={clsx(
            'sm:hidden w-1.5 h-1.5 rounded-full',
            isOffline ? 'bg-red-500' : 'bg-green-500 animate-pulse-green',
          )}
        />
        {pendingSyncCount > 0 && (
          <ChevronDown size={11} className={clsx('transition-transform', expanded && 'rotate-180')} />
        )}
      </button>

      {expanded && pendingSyncCount > 0 && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-md shadow-lg border border-gray-100 p-3 z-50 animate-fade-in">
          <p className="text-xs font-semibold text-gray-700 mb-1">Pending sync</p>
          <p className="text-xs text-gray-500">
            {pendingSyncCount} payment{pendingSyncCount !== 1 ? 's' : ''} will sync when back online.
          </p>
        </div>
      )}
    </div>
  );
}
