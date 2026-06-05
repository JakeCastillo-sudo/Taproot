/**
 * OnlineOrdersBell — POS header indicator for incoming QR/online orders.
 * Polls the order history every 15s; badges the count of open online orders and
 * toasts when a new one arrives. Click → Order History.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { orders as ordersApi } from '../../lib/api';
import { showToast } from '../ui/Toast';

export function OnlineOrdersBell() {
  const navigate = useNavigate();
  const prev = useRef<number | null>(null);

  const { data } = useQuery({
    queryKey: ['orders', 'online-pending'],
    queryFn:  () => ordersApi.history({ limit: 30 }),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const openOnline = (data?.orders ?? []).filter(
    (o) => o.order_type === 'online' && (o.status === 'open' || o.status === 'in_progress'),
  );
  const count = openOnline.length;

  useEffect(() => {
    if (prev.current !== null && count > prev.current) {
      showToast.info(`New online order! (${count} pending)`);
    }
    prev.current = count;
  }, [count]);

  if (count === 0) return null;

  return (
    <button onClick={() => navigate('/orders')} title={`${count} online order(s)`}
      className="relative p-2 rounded-md hover:bg-gray-100 transition-colors shrink-0">
      <Bell size={18} className="text-gray-600" />
      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{count}</span>
    </button>
  );
}
