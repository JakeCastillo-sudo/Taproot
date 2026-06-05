/**
 * TableView — read-only floor plan for table-service POS mode.
 *
 * Renders tables at their saved positions, color-coded by status:
 *   green  = available, amber = occupied (open order), gray = inactive.
 * Tap an available table to start an order for it (sets pos.store table id and
 * switches back to the product grid). Tap an occupied table to see its order.
 * Section tabs filter the view. Polls /tables/status every 10s.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { tables as tablesApi, type TableStatus } from '../../lib/api';
import { getLocationId } from '../../lib/session';
import { usePOSStore } from '../../store/pos.store';
import { showToast } from '../ui/Toast';

function fmt(c: number): string { return `$${(Number(c) / 100).toFixed(2)}`; }

export function TableView({ onStartOrder }: { onStartOrder: () => void }) {
  const locationId = getLocationId();
  const setTable = usePOSStore((s) => s.setTable);
  const [section, setSection] = useState<string>('all');

  const { data: tables, isLoading } = useQuery({
    queryKey: ['tables', 'status', locationId],
    queryFn:  () => tablesApi.status(locationId),
    refetchInterval: 10_000,
  });

  const sections = useMemo(
    () => Array.from(new Set((tables ?? []).map((t) => t.section).filter(Boolean))) as string[],
    [tables],
  );
  const list = (tables ?? []).filter((t) => section === 'all' || t.section === section);

  const handleTap = (t: TableStatus) => {
    if (!t.is_active) return;
    if (t.currentOrder) {
      showToast.info(`${t.name}: order ${t.currentOrder.orderNumber} · ${t.currentOrder.itemCount} items · ${fmt(t.currentOrder.total)} · ${t.currentOrder.minutesOpen}m`);
      return;
    }
    setTable(t.id);
    showToast.success(`Started order for ${t.name}`);
    onStartOrder();
  };

  return (
    <div className="p-3 md:p-4">
      {/* Section tabs */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {['all', ...sections].map((s) => (
          <button key={s} onClick={() => setSection(s)}
            className={clsx('px-3 py-1.5 rounded-full text-xs font-medium capitalize whitespace-nowrap transition-colors',
              section === s ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
            {s === 'all' ? 'All sections' : s}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full ring-2 ring-green-500 ring-offset-1" /> Available</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full ring-2 ring-amber-500 ring-offset-1" /> Occupied</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-10 text-center">Loading floor plan…</p>
      ) : list.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-sm text-gray-400">No tables yet.</p>
          <p className="text-xs text-gray-400 mt-1">Add tables in Settings → Floor Plan.</p>
        </div>
      ) : (
        <div className="relative bg-white rounded-lg border border-gray-200 mx-auto overflow-auto"
          style={{ width: '100%', maxWidth: 920, height: 560, backgroundImage: 'radial-gradient(#f1f5f9 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          {list.map((t) => {
            const occupied = !!t.currentOrder;
            const ring = !t.is_active ? 'ring-gray-300' : occupied ? 'ring-amber-500' : 'ring-green-500';
            return (
              <button key={t.id} onClick={() => handleTap(t)}
                className={clsx('absolute flex flex-col items-center justify-center text-center ring-2 ring-offset-2 transition-all hover:scale-105 active:scale-95',
                  t.shape === 'circle' ? 'rounded-full' : 'rounded-lg', ring,
                  occupied ? 'bg-amber-50' : 'bg-green-50')}
                style={{ left: Number(t.position_x), top: Number(t.position_y), width: Number(t.width), height: Number(t.height) }}>
                <span className="text-xs font-bold text-gray-800">{t.name}</span>
                {occupied ? (
                  <>
                    <span className="text-[10px] font-semibold text-amber-700">{fmt(t.currentOrder!.total)}</span>
                    <span className="text-[9px] text-gray-400">{t.currentOrder!.minutesOpen}m</span>
                  </>
                ) : (
                  <span className="text-[9px] text-gray-400">{t.seats} seats</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
