/**
 * IntelligenceFeed — the owner's morning briefing (S9-04).
 *
 * Rendered as the POS landing view for owners/managers (cashiers go straight
 * to the register). Yesterday's numbers vs last week, today's outlook, alerts,
 * the single AI insight, prep checklist, and reorder ETAs — plus a big
 * "Start taking orders →" button that switches to the category tiles.
 */

import { useQuery } from '@tanstack/react-query';
import {
  Sun, ArrowUpRight, ArrowDownRight, AlertTriangle, Info, CheckCircle2,
  Bot, ClipboardList, Package, ArrowRight, Users,
} from 'lucide-react';
import { clsx } from 'clsx';
import { ai } from '../../lib/api';
import { getLocationId, getStoredUser } from '../../lib/session';

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtFull = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function IntelligenceFeed({ onStartOrders }: { onStartOrders: () => void }) {
  const user = getStoredUser();
  const firstName = user?.firstName ?? 'there';
  const dayName = new Date().toLocaleDateString([], { weekday: 'long' });

  const { data: intel, isLoading, isError } = useQuery({
    queryKey: ['ai', 'daily-intelligence', getLocationId()],
    queryFn: () => ai.dailyIntelligence(getLocationId()),
    staleTime: 15 * 60_000,
    retry: 1,
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Greeting + start button */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {firstName}! <Sun size={20} className="text-amber-400" />
          </h1>
          <p className="text-sm text-gray-400">Here&apos;s what you need to know for {dayName}.</p>
        </div>
        <button onClick={onStartOrders}
          className="flex items-center gap-2 px-5 py-3 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary-dark active:scale-[0.98] transition-all shadow-md shadow-primary/20">
          Start taking orders <ArrowRight size={16} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Preparing your daily briefing…</p>
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError || !intel ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-sm text-gray-500">AI insights temporarily unavailable.</p>
          <p className="text-xs text-gray-400 mt-1">Your register works as usual — check back in a few minutes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* AI insight highlight */}
          <div className="bg-primary text-white rounded-xl p-4 flex items-start gap-3 shadow-sm">
            <Bot size={20} className="shrink-0 mt-0.5 text-white/90" />
            <p className="text-sm leading-relaxed font-medium">{intel.aiInsight}</p>
          </div>

          {/* Yesterday cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400">Yesterday&apos;s revenue</p>
              <p className="text-lg font-bold text-gray-900">{fmt(intel.yesterday.revenue)}</p>
              {intel.yesterday.revenueVsLastWeek !== 0 && (
                <p className={clsx('text-xs font-medium flex items-center gap-0.5',
                  intel.yesterday.revenueVsLastWeek > 0 ? 'text-green-600' : 'text-red-600')}>
                  {intel.yesterday.revenueVsLastWeek > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {Math.abs(intel.yesterday.revenueVsLastWeek)}% vs last {dayName}
                </p>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400">Orders</p>
              <p className="text-lg font-bold text-gray-900">{intel.yesterday.orders}</p>
              <p className="text-xs text-gray-400">avg ticket {fmtFull(intel.yesterday.avgTicket)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400">Best seller</p>
              <p className="text-sm font-bold text-gray-900 truncate">{intel.yesterday.bestItem?.name ?? '—'}</p>
              {intel.yesterday.bestItem && <p className="text-xs text-gray-400">{intel.yesterday.bestItem.count} sold</p>}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs text-gray-400">Today&apos;s outlook</p>
              <p className="text-sm font-bold text-gray-900">
                {intel.today.forecastRevenueHigh > 0
                  ? `${fmt(intel.today.forecastRevenueLow)} – ${fmt(intel.today.forecastRevenueHigh)}`
                  : '—'}
              </p>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Users size={10} />
                {intel.today.staffScheduled > 0
                  ? `${intel.today.staffScheduled} scheduled${intel.today.staffRecommended > 0 ? ` (rec: ${intel.today.staffRecommended})` : ''}${intel.today.staffScheduled >= intel.today.staffRecommended ? ' ✅' : ''}`
                  : intel.today.staffRecommended > 0 ? `recommended staff: ${intel.today.staffRecommended}` : '—'}
              </p>
            </div>
          </div>

          {/* Alerts */}
          {intel.alerts.length > 0 && (
            <div className="space-y-2">
              {intel.alerts.map((a, i) => (
                <div key={i} className={clsx('rounded-lg px-3.5 py-2.5 text-sm flex items-start gap-2 border',
                  a.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : a.type === 'success' ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-blue-50 border-blue-200 text-blue-800')}>
                  {a.type === 'warning' ? <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                    : a.type === 'success' ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                    : <Info size={15} className="shrink-0 mt-0.5" />}
                  {a.message}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Prep checklist */}
            {intel.today.prepChecklist.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5 mb-2">
                  <ClipboardList size={13} className="text-primary" /> Today&apos;s prep checklist
                </p>
                <ul className="space-y-1.5">
                  {intel.today.prepChecklist.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-gray-300">□</span> {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reorder */}
            {intel.reorderNeeded.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5 mb-2">
                  <Package size={13} className="text-amber-500" /> Reorder needed
                </p>
                <div className="space-y-1.5">
                  {intel.reorderNeeded.map((r) => (
                    <div key={r.productName} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{r.productName}</span>
                      <span className={clsx('text-xs font-medium shrink-0 ml-2',
                        r.daysUntilStockout <= 2 ? 'text-red-600' : 'text-amber-600')}>
                        {r.daysUntilStockout} day{r.daysUntilStockout === 1 ? '' : 's'} left
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
