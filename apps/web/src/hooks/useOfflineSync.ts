/**
 * useOfflineSync — tracks online/offline state, mirrors it into pos.store, and
 * auto-replays the offline order queue when the connection returns.
 */

import { useEffect } from 'react';
import { usePOSStore } from '../store/pos.store';
import { processQueue, pendingCount } from '../lib/offlineQueue';
import { showToast } from '../components/ui/Toast';

export function useOfflineSync(): void {
  const setOffline = usePOSStore((s) => s.setOffline);
  const setPendingSyncCount = usePOSStore((s) => s.setPendingSyncCount);

  useEffect(() => {
    let cancelled = false;

    const refreshCount = async () => {
      const n = await pendingCount();
      if (!cancelled) setPendingSyncCount(n);
    };

    const sync = async () => {
      const n = await pendingCount();
      if (n === 0) return;
      showToast.info(`Connection restored — syncing ${n} order${n !== 1 ? 's' : ''}…`);
      const synced = await processQueue();
      await refreshCount();
      if (synced > 0) showToast.success(`Synced ${synced} offline order${synced !== 1 ? 's' : ''}`);
    };

    const goOnline = () => { setOffline(false); void sync(); };
    const goOffline = () => { setOffline(true); showToast.warning('Working offline — orders will sync when the connection returns'); };

    setOffline(!navigator.onLine);
    void refreshCount();
    if (navigator.onLine) void sync();

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const interval = setInterval(refreshCount, 30_000);
    return () => { cancelled = true; window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
