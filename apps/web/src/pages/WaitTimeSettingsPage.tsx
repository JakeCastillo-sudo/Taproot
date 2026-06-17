/**
 * WaitTimeSettingsPage — /settings/wait-time
 *
 * Live status + tuning for the queue-aware wait-time engine (FEAT-WAIT-001).
 * Owner edits config; manager/owner can toggle rush mode. All values in minutes.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Flame } from 'lucide-react';
import { clsx } from 'clsx';
import { waitTime as waitTimeApi, type WaitTimeConfig } from '../lib/api';
import { getLocationId } from '../lib/session';
import { showToast } from '../components/ui/Toast';

function statusColor(mins: number): string {
  if (mins > 30) return 'text-red-600';
  if (mins >= 15) return 'text-amber-600';
  return 'text-green-600';
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <label className="flex items-center justify-between py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <button onClick={onClick}
        className={`relative w-10 h-6 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

function Slider({ label, hint, value, min, max, step, suffix, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number; suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-sm font-bold text-gray-900">{value}{suffix}</span>
      </div>
      <p className="text-xs text-gray-400 mb-1.5">{hint}</p>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary" />
    </div>
  );
}

export function WaitTimeSettingsPage() {
  const qc = useQueryClient();
  const locationId = getLocationId();

  const { data: serverCfg, isLoading } = useQuery({
    queryKey: ['waitTime', 'config', locationId],
    queryFn:  () => waitTimeApi.getConfig(locationId),
    enabled: !!locationId,
  });
  const { data: live } = useQuery({
    queryKey: ['waitTime', locationId],
    queryFn:  () => waitTimeApi.get(locationId),
    refetchInterval: 30_000,
    enabled: !!locationId,
  });
  const { data: accuracy } = useQuery({
    queryKey: ['waitTime', 'accuracy', locationId],
    queryFn:  () => waitTimeApi.accuracy(locationId),
    enabled: !!locationId,
  });

  const [cfg, setCfg] = useState<WaitTimeConfig | null>(null);
  useEffect(() => { if (serverCfg) setCfg(serverCfg); }, [serverCfg]);
  const set = (patch: Partial<WaitTimeConfig>) => setCfg((c) => c ? { ...c, ...patch } : c);

  const save = useMutation({
    mutationFn: () => waitTimeApi.saveConfig(locationId, {
      enabled: cfg!.enabled,
      basePrepMinutes: cfg!.basePrepMinutes,
      minutesPerItem: cfg!.minutesPerItem,
      rushExtraMinutes: cfg!.rushExtraMinutes,
      maxWaitMinutes: cfg!.maxWaitMinutes,
      showOnPublicMenu: cfg!.showOnPublicMenu,
    }),
    onSuccess: () => {
      showToast.success('Wait time settings saved');
      void qc.invalidateQueries({ queryKey: ['waitTime'] });
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const rush = useMutation({
    mutationFn: (enabled: boolean) =>
      waitTimeApi.setRush(locationId, { enabled, extraMinutes: cfg?.rushExtraMinutes ?? 15, durationMinutes: 60 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['waitTime'] }),
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Could not update rush mode'),
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Wait Time</h1>
        <p className="text-xs text-gray-400 mt-0.5">Queue-aware estimates for your kitchen, online menu, and delivery orders.</p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {isLoading || !cfg ? (
          <div className="h-40 bg-gray-100 rounded animate-shimmer max-w-2xl" />
        ) : (
          <div className="max-w-2xl space-y-5">

            {/* ── Section 1: Live status ───────────────────────────────────── */}
            <section className="border border-gray-100 rounded-lg p-4 bg-white">
              <div className="flex items-center gap-3">
                <Clock size={20} className="text-gray-400" />
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">Right now</p>
                  {live ? (
                    <>
                      <p className={clsx('text-2xl font-extrabold', statusColor(live.estimatedMinutes))}>{live.displayText}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Queue: {live.queueDepth} order{live.queueDepth !== 1 ? 's' : ''}, {live.queueItemCount} items ·
                        {' '}Confidence: <span className="capitalize">{live.confidence}</span>
                        {' '}(based on {live.dataPoints} completed order{live.dataPoints !== 1 ? 's' : ''})
                      </p>
                    </>
                  ) : <p className="text-sm text-gray-400">Loading…</p>}
                </div>
                <button
                  onClick={() => rush.mutate(!(live?.rushMode))}
                  disabled={rush.isPending || !live}
                  className={clsx('shrink-0 px-3.5 py-2 rounded-md text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50',
                    live?.rushMode ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
                >
                  <Flame size={15} /> {live?.rushMode ? 'Rush Active — end' : 'Rush Mode'}
                </button>
              </div>
              {live?.rushMode && (
                <p className="text-xs text-red-600 mt-2">Rush mode adds +{cfg.rushExtraMinutes} min and auto-expires after 60 minutes.</p>
              )}
            </section>

            {/* ── Section 2: Configuration ─────────────────────────────────── */}
            <section className="border border-gray-100 rounded-lg p-4 bg-white">
              <h2 className="text-sm font-bold text-gray-800 mb-1">Wait time settings</h2>
              <Toggle on={cfg.enabled} onClick={() => set({ enabled: !cfg.enabled })} label="Enable wait time estimates" />
              <div className="border-t border-gray-50 my-1" />
              <Slider label="Base prep time" hint="Minimum time for any order, even with an empty kitchen."
                value={cfg.basePrepMinutes} min={5} max={30} step={5} suffix=" min"
                onChange={(v) => set({ basePrepMinutes: v })} />
              <Slider label="Minutes per item" hint="Fallback time added per queued item (used until enough order history accrues)."
                value={cfg.minutesPerItem} min={0.25} max={2} step={0.25} suffix=" min"
                onChange={(v) => set({ minutesPerItem: v })} />
              <Slider label="Rush mode extra time" hint="Added to the estimate while rush mode is on."
                value={cfg.rushExtraMinutes} min={5} max={30} step={5} suffix=" min"
                onChange={(v) => set({ rushExtraMinutes: v })} />
              <Slider label="Maximum wait shown" hint="Caps the displayed estimate so it never looks absurd."
                value={cfg.maxWaitMinutes} min={20} max={90} step={5} suffix=" min"
                onChange={(v) => set({ maxWaitMinutes: v })} />
              <div className="border-t border-gray-50 my-1" />
              <Toggle on={cfg.showOnPublicMenu} onClick={() => set({ showOnPublicMenu: !cfg.showOnPublicMenu })} label="Show current wait time on your online ordering page" />

              <button onClick={() => save.mutate()} disabled={save.isPending}
                className="mt-3 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </section>

            {/* ── Section 3: How it works ──────────────────────────────────── */}
            <section className="border border-gray-100 rounded-lg p-4 bg-white">
              <h2 className="text-sm font-bold text-gray-800 mb-2">How it works</h2>
              <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
                <li>Counts the items in your open kitchen tickets.</li>
                <li>Uses your recent order history to learn how long each item takes on average.</li>
                <li>Adds your base prep time.</li>
                <li>Adds rush-mode time if rush mode is active.</li>
              </ol>
              <p className="text-xs text-gray-400 mt-2">The estimate improves automatically as more orders are completed. Estimates always round up — a longer estimate beats a not-ready order.</p>
              {live && (
                <div className="mt-3 bg-surface-2 rounded-md px-3 py-2 text-xs font-mono text-gray-600">
                  Est. = ({live.queueItemCount} items × {live.avgItemMinutes} min/item) + {cfg.basePrepMinutes} min base
                  {live.rushMode ? ` + ${cfg.rushExtraMinutes} rush` : ''} → {live.displayText}
                </div>
              )}
            </section>

            {/* ── Section 4: Accuracy history ──────────────────────────────── */}
            <section className="border border-gray-100 rounded-lg p-4 bg-white">
              <h2 className="text-sm font-bold text-gray-800 mb-2">Recent prep times (last 7 days)</h2>
              {!accuracy || accuracy.length === 0 ? (
                <p className="text-xs text-gray-400">No completed orders in the last 7 days yet. Accuracy data appears here as you complete orders.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="py-1.5 font-semibold">Date</th>
                      <th className="py-1.5 font-semibold text-right">Actual avg</th>
                      <th className="py-1.5 font-semibold text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accuracy.map((d) => (
                      <tr key={d.date} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 text-gray-700">{d.date}</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{d.actualAvgMinutes} min</td>
                        <td className="py-1.5 text-right text-gray-500">{d.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-gray-400 mt-2">
                If actual prep times run consistently higher than your estimates, raise your base prep time above.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
