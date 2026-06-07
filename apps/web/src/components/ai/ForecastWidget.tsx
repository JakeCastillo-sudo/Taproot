/**
 * ForecastWidget — AI demand forecast for a selected date (S9-01).
 *
 * Featured at the top of /reports: revenue range, expected orders, top-item
 * prep quantities, and an actionable prep checklist. Degrades gracefully —
 * AI failures fall back server-side to a statistical estimate; network
 * failures show a friendly message, never crash.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, TrendingUp, ClipboardList, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { ai } from '../../lib/api';
import { getLocationId } from '../../lib/session';

const fmt = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

function addDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

const DATE_OPTIONS = [
  { label: 'Tomorrow', value: addDays(1) },
  { label: addDays(2), value: addDays(2) },
  { label: addDays(3), value: addDays(3) },
];

export function ForecastWidget() {
  const [date, setDate] = useState(DATE_OPTIONS[0].value);
  const locationId = getLocationId();

  const { data: f, isLoading, isError } = useQuery({
    queryKey: ['ai', 'forecast', date, locationId],
    queryFn: () => ai.forecast(date, locationId),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6 overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3 border-b border-gray-50 flex items-center gap-2 flex-wrap">
        <Sparkles size={16} className="text-primary" />
        <h2 className="text-sm font-bold text-gray-900">
          {date === DATE_OPTIONS[0].value ? "Tomorrow's Forecast" : `Forecast — ${f?.dayOfWeek ?? date}`}
        </h2>
        <div className="ml-auto flex rounded-md border border-gray-200 overflow-hidden">
          {DATE_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setDate(o.value)}
              className={clsx('px-2.5 py-1 text-xs font-medium transition-colors',
                date === o.value ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50')}>
              {o.label === 'Tomorrow' ? 'Tomorrow' : new Date(`${o.value}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="p-5">
          <p className="text-sm text-gray-400 mb-3">Analyzing your sales history…</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />)}
          </div>
        </div>
      ) : isError || !f ? (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-500">AI insights temporarily unavailable.</p>
          <p className="text-xs text-gray-400 mt-1">Check back in a few minutes.</p>
        </div>
      ) : (
        <div className="p-4 sm:p-5">
          {/* Confidence */}
          <p className="text-xs text-gray-400 mb-3">
            {f.confidence > 0.8
              ? `High confidence based on ${f.basedOnDays} days of data`
              : f.confidence >= 0.5
                ? `Medium confidence (${f.basedOnDays} days of data)`
                : 'Building accuracy — check back in 2 weeks'}
            {f.note ? ` · ${f.note}` : f.aiUsed ? ' · AI-generated' : ''}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Revenue range */}
            <div className="bg-surface-2 rounded-lg p-4">
              <p className="text-xs text-gray-400 flex items-center gap-1 mb-1"><TrendingUp size={12} /> Revenue</p>
              <p className="text-xl font-bold text-gray-900">
                {fmt(f.predictedRevenue.low)} — {fmt(f.predictedRevenue.high)}
              </p>
              <p className="text-xs text-gray-500 mb-2">Most likely: ~{fmt(f.predictedRevenue.mid)}</p>
              {/* Range bar */}
              {f.predictedRevenue.high > 0 && (
                <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="absolute inset-y-0 bg-primary/30 rounded-full"
                    style={{
                      left: `${(f.predictedRevenue.low / f.predictedRevenue.high) * 100 * 0.9}%`,
                      right: '0%',
                    }} />
                  <div className="absolute inset-y-0 w-1.5 bg-primary rounded-full"
                    style={{ left: `${Math.min(96, (f.predictedRevenue.mid / f.predictedRevenue.high) * 100 * 0.9)}%` }} />
                </div>
              )}
              <p className="text-sm text-gray-600 mt-3 flex items-center gap-1.5">
                <Users size={13} className="text-gray-400" /> ~{f.predictedOrders} orders expected
              </p>
            </div>

            {/* Top items */}
            <div className="bg-surface-2 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-2">Prep for your top sellers</p>
              {f.predictedTopItems.length === 0 ? (
                <p className="text-sm text-gray-400">No item history yet</p>
              ) : (
                <div className="space-y-1.5">
                  {f.predictedTopItems.map((t) => (
                    <div key={t.name} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 truncate">{t.name}</span>
                      <span className="font-semibold text-gray-900 tabular-nums shrink-0 ml-2">~{t.predictedQuantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prep checklist */}
            <div className="bg-primary/5 border border-primary/15 rounded-lg p-4">
              <p className="text-xs font-semibold text-primary-dark flex items-center gap-1 mb-2">
                <ClipboardList size={12} /> Prep checklist
              </p>
              <ul className="space-y-1.5">
                {f.prepRecommendations.map((r, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-gray-700 leading-snug">
                    <span className="text-primary shrink-0">•</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
