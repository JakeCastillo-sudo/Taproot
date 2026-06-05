/**
 * KitchenDisplayPage — /kitchen
 *
 * Full-screen KDS. Polls open tickets every 5s. Each card shows order #, table /
 * type, elapsed time (green <5m, amber 5–10m, red >10m flashing), items with
 * modifiers + special instructions. Tap an item to mark ready; Bump removes the
 * order. Large-text mode for far screens.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ArrowLeft, Type, ChefHat } from 'lucide-react';
import { clsx } from 'clsx';
import { kitchen as kitchenApi, type KitchenTicket } from '../lib/api';
import { getLocationId } from '../lib/session';

function timeColor(mins: number): string {
  if (mins > 10) return 'text-red-600';
  if (mins >= 5) return 'text-amber-600';
  return 'text-green-600';
}

export function KitchenDisplayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const locationId = getLocationId();
  const [big, setBig] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['kitchen', 'tickets', locationId],
    queryFn:  () => kitchenApi.tickets(locationId),
    refetchInterval: 5_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['kitchen', 'tickets', locationId] });

  const itemReady = useMutation({ mutationFn: (id: string) => kitchenApi.itemReady(id), onSuccess: refresh });
  const bump = useMutation({ mutationFn: (id: string) => kitchenApi.bump(id), onSuccess: refresh });

  const now = new Date();
  const tickets = orders ?? [];

  return (
    <div className={clsx('h-screen flex flex-col overflow-hidden bg-gray-900 text-white', big && 'text-lg')}>
      <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-gray-700">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white"><ArrowLeft size={15} /> Exit</button>
        <ChefHat size={20} className="text-primary ml-2" />
        <h1 className="text-lg font-bold">Kitchen</h1>
        <div className="flex-1" />
        <span className="text-2xl font-bold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="ml-3 px-2 py-1 rounded bg-gray-700 text-sm font-semibold">{tickets.length} active</span>
        <button onClick={() => setBig((v) => !v)} className={clsx('ml-2 p-2 rounded hover:bg-gray-700', big && 'bg-gray-700')} title="Large text"><Type size={18} /></button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-center text-gray-400 py-16">Loading tickets…</p>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ChefHat size={48} className="text-gray-700 mb-3" />
            <p className="text-gray-400">No active tickets. All caught up! 🎉</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tickets.map((t) => <TicketCard key={t.id} ticket={t} big={big}
              onItemReady={(id) => itemReady.mutate(id)} onBump={() => bump.mutate(t.id)} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function TicketCard({ ticket, big, onItemReady, onBump }: {
  ticket: KitchenTicket; big: boolean;
  onItemReady: (itemId: string) => void; onBump: () => void;
}) {
  const allReady = ticket.items.length > 0 && ticket.items.every((i) => i.ready);
  return (
    <div className={clsx('bg-gray-800 rounded-lg overflow-hidden flex flex-col border-2', ticket.minutesOpen > 10 ? 'border-red-600 animate-pulse' : 'border-gray-700')}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span className={clsx('font-bold', big ? 'text-xl' : 'text-base')}>{ticket.orderNumber}</span>
        <span className={clsx('text-xs px-2 py-0.5 rounded-full bg-gray-700', big && 'text-sm')}>
          {ticket.tableName ? ticket.tableName : ticket.orderType.replace(/_/g, ' ')}
        </span>
        <span className={clsx('font-bold tabular-nums', timeColor(ticket.minutesOpen), big ? 'text-lg' : 'text-sm')}>{ticket.minutesOpen}m</span>
      </div>
      <div className="flex-1 p-3 space-y-2">
        {ticket.items.map((it) => (
          <button key={it.id} onClick={() => !it.ready && onItemReady(it.id)}
            className={clsx('w-full text-left rounded px-2 py-1.5 transition-colors', it.ready ? 'bg-green-900/40 text-green-300 line-through' : 'hover:bg-gray-700')}>
            <div className="flex items-center gap-2">
              {it.ready && <Check size={14} className="text-green-400 shrink-0" />}
              <span className={clsx('font-semibold', big ? 'text-lg' : 'text-sm')}>{it.quantity}× {it.name.toUpperCase()}</span>
            </div>
            {it.modifiers.filter((m) => m.name).map((m, i) => (
              <div key={i} className={clsx('text-amber-300 ml-4', big ? 'text-sm' : 'text-xs')}>» {m.name}</div>
            ))}
            {it.specialInstructions && <div className={clsx('text-blue-300 ml-4 italic', big ? 'text-sm' : 'text-xs')}>» {it.specialInstructions}</div>}
          </button>
        ))}
      </div>
      <button onClick={onBump}
        className={clsx('w-full py-2.5 font-bold transition-colors', allReady ? 'bg-green-600 hover:bg-green-500' : 'bg-gray-700 hover:bg-gray-600', big ? 'text-lg' : 'text-sm')}>
        BUMP
      </button>
    </div>
  );
}
