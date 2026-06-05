/**
 * OnlineOrderingSettingsPage — /settings/online-ordering
 *
 * Toggles online ordering on/off, pickup/delivery, prep time, delivery radius/fee,
 * and minimum order. Drives the public storefront (/order/:slug). Money in dollars
 * in the UI, cents over the wire.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settings as settingsApi, type OnlineOrderingConfig } from '../lib/api';
import { showToast } from '../components/ui/Toast';

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

export function OnlineOrderingSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'online-ordering'], queryFn: () => settingsApi.getOnlineOrdering() });
  const [cfg, setCfg] = useState<OnlineOrderingConfig | null>(null);
  useEffect(() => { if (data) setCfg(data); }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.saveOnlineOrdering(cfg!),
    onSuccess: () => { showToast.success('Online ordering settings saved'); void qc.invalidateQueries({ queryKey: ['settings', 'online-ordering'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const set = (patch: Partial<OnlineOrderingConfig>) => setCfg((c) => c ? { ...c, ...patch } : c);
  const field = 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Online Ordering</h1>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {isLoading || !cfg ? (
          <div className="h-40 bg-gray-100 rounded animate-shimmer max-w-xl" />
        ) : (
          <div className="max-w-xl space-y-5">
            <section className="border border-gray-100 rounded-lg p-4">
              <Toggle on={cfg.enabled} onClick={() => set({ enabled: !cfg.enabled })} label="Accept online orders" />
              <Toggle on={cfg.pickupEnabled} onClick={() => set({ pickupEnabled: !cfg.pickupEnabled })} label="Pickup" />
              <Toggle on={cfg.deliveryEnabled} onClick={() => set({ deliveryEnabled: !cfg.deliveryEnabled })} label="Delivery" />
            </section>

            <section className="border border-gray-100 rounded-lg p-4">
              <Toggle on={cfg.textEnabled ?? false} onClick={() => set({ textEnabled: !(cfg.textEnabled ?? false) })} label="📱 AI text ordering (SMS)" />
              <p className="text-xs text-gray-500 mt-2">Customers text their order to your Twilio number; AI parses it, matches items, and fires the ticket to the POS. Configure the Twilio webhook to <code>/webhook/sms/&lt;your-slug&gt;</code> and set the Twilio env vars on the API.</p>
            </section>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Pickup prep (minutes)</label>
                <input type="number" min={0} className={field} value={cfg.pickupPrepMinutes}
                  onChange={(e) => set({ pickupPrepMinutes: parseInt(e.target.value, 10) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Minimum order ($)</label>
                <input type="number" min={0} step="0.01" className={field} value={(cfg.minOrderCents / 100).toFixed(2)}
                  onChange={(e) => set({ minOrderCents: Math.round((parseFloat(e.target.value) || 0) * 100) })} />
              </div>
            </div>

            {cfg.deliveryEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Delivery radius (miles)</label>
                  <input type="number" min={0} className={field} value={cfg.deliveryRadiusMiles}
                    onChange={(e) => set({ deliveryRadiusMiles: parseInt(e.target.value, 10) || 0 })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Delivery fee ($)</label>
                  <input type="number" min={0} step="0.01" className={field} value={(cfg.deliveryFeeCents / 100).toFixed(2)}
                    onChange={(e) => set({ deliveryFeeCents: Math.round((parseFloat(e.target.value) || 0) * 100) })} />
                </div>
              </div>
            )}

            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
