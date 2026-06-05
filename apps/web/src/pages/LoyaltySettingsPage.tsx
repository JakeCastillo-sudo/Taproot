/**
 * LoyaltySettingsPage — /settings/loyalty
 *
 * Points earning/redemption rates + tier thresholds. Points accrue automatically
 * on order completion when a customer is attached (see payment.service).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settings as settingsApi, type LoyaltyConfig } from '../lib/api';
import { showToast } from '../components/ui/Toast';

export function LoyaltySettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'loyalty'], queryFn: () => settingsApi.getLoyalty() });
  const [cfg, setCfg] = useState<LoyaltyConfig | null>(null);
  useEffect(() => { if (data) setCfg(data); }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.saveLoyalty(cfg!),
    onSuccess: () => { showToast.success('Loyalty settings saved'); void qc.invalidateQueries({ queryKey: ['settings', 'loyalty'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
  if (isLoading || !cfg) return <div className="flex-1 p-6"><div className="h-40 max-w-xl bg-gray-100 rounded animate-shimmer" /></div>;

  const setTier = (k: keyof LoyaltyConfig['tiers'], v: number) => setCfg((c) => c ? { ...c, tiers: { ...c.tiers, [k]: v } } : c);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Loyalty</h1>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        <div className="max-w-xl space-y-5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="w-4 h-4 accent-primary" />
            <span className="text-sm font-medium text-gray-700">Loyalty program enabled</span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Points per $1 spent</label>
              <input type="number" min={0} step="0.1" className={field} value={cfg.pointsPerDollar}
                onChange={(e) => setCfg({ ...cfg, pointsPerDollar: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Redeem value (¢ per point)</label>
              <input type="number" min={0} step="0.1" className={field} value={(cfg.redeemRate * 100).toFixed(1)}
                onChange={(e) => setCfg({ ...cfg, redeemRate: (parseFloat(e.target.value) || 0) / 100 })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Minimum points to redeem</label>
            <input type="number" min={0} className={field} value={cfg.minimumRedemption}
              onChange={(e) => setCfg({ ...cfg, minimumRedemption: parseInt(e.target.value, 10) || 0 })} />
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-900 mb-2">Tier thresholds (points)</h3>
            <div className="grid grid-cols-3 gap-3">
              {(['silver', 'gold', 'platinum'] as const).map((t) => (
                <div key={t}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1 capitalize">{t}</label>
                  <input type="number" min={0} className={field} value={cfg.tiers[t]} onChange={(e) => setTier(t, parseInt(e.target.value, 10) || 0)} />
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400">Points accrue automatically when an order with an attached customer is paid in full.</p>

          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
