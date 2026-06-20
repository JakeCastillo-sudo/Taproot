/**
 * CapabilitiesSettingsPage — owner/manager edit of the v2.0 capability spine.
 *
 * Toggle which verticals (food service / studio / retail) and billing models the
 * org runs, after onboarding. Reads GET /capabilities, writes PUT /capabilities.
 * Mirrors the DeliverySettingsPage layout + the standard Toast/mutation pattern.
 *
 * Renders inside SettingsLayout (owner/manager guarded there). If the backend route
 * is unwired (pre-review) the GET fails open to defaults and the PUT surfaces an
 * error toast — no crash, no trapped state.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import type { Capabilities } from '@taproot/shared';
import { capabilities as capabilitiesApi } from '../lib/api';
import { showToast } from '../components/ui/Toast';
import { DEFAULT_CAPABILITIES } from '../hooks/useCapabilities';

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={clsx('relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-primary' : 'bg-gray-200')}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
          on && 'translate-x-5',
        )}
      />
    </button>
  );
}

function Row({ title, desc, on, onChange }: { title: string; desc: string; on: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

type BillingKey = keyof Capabilities['billing_models'];

const BILLING_LABELS: Record<BillingKey, { title: string; desc: string }> = {
  drop_in:     { title: 'Drop-in', desc: 'Pay-as-you-go single class / visit.' },
  class_packs: { title: 'Class packs', desc: 'Pre-paid bundles of credits.' },
  free_trial:  { title: 'Free trial', desc: 'Intro offer for new members.' },
  memberships: { title: 'Memberships', desc: 'Recurring plans (Taproot-native billing — v2.5).' },
  classpass:   { title: 'ClassPass', desc: 'Third-party marketplace settlement (v2.6+).' },
};

export function CapabilitiesSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['capabilities'],
    queryFn: capabilitiesApi.get,
    staleTime: 60_000,
    retry: false,
  });

  const [form, setForm] = useState<Capabilities>(DEFAULT_CAPABILITIES);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: () => capabilitiesApi.update(form),
    onSuccess: (caps) => {
      showToast.success('Capabilities saved');
      setForm(caps);
      void qc.invalidateQueries({ queryKey: ['capabilities'] });
    },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const toggleTop = (k: 'food_service' | 'studio' | 'retail') =>
    setForm((f) => ({ ...f, [k]: !f[k] }));
  const toggleBilling = (k: BillingKey) =>
    setForm((f) => ({ ...f, billing_models: { ...f.billing_models, [k]: !f.billing_models[k] } }));

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900">Capabilities</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">
          Turn verticals and billing models on or off. Restaurant features stay on by default;
          studio and retail unlock their features as they ship.
        </p>

        {/* Verticals */}
        <div className="border border-gray-200 rounded-xl p-5 mb-5 divide-y divide-gray-100">
          <Row
            title="Food service"
            desc="Menu, kitchen, and restaurant ordering. The default for every org."
            on={form.food_service}
            onChange={() => toggleTop('food_service')}
          />
          <Row
            title="Studio"
            desc="Fitness/studio classes, booking, and members (rolls out v2.1+)."
            on={form.studio}
            onChange={() => toggleTop('studio')}
          />
          <Row
            title="Retail"
            desc="Product-first retail catalog and checkout."
            on={form.retail}
            onChange={() => toggleTop('retail')}
          />
        </div>

        {/* Billing models */}
        <div className="border border-gray-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-gray-900 mb-1">Billing models</p>
          <p className="text-xs text-gray-500 mb-2">
            Which ways members can pay. Applies to studio bookings; off models stay dormant.
          </p>
          <div className="divide-y divide-gray-100">
            {(Object.keys(BILLING_LABELS) as BillingKey[]).map((k) => (
              <Row
                key={k}
                title={BILLING_LABELS[k].title}
                desc={BILLING_LABELS[k].desc}
                on={form.billing_models[k]}
                onChange={() => toggleBilling(k)}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
