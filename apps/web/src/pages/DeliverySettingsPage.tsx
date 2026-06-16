/**
 * DeliverySettingsPage — /settings/delivery
 *
 * Enable and configure DoorDash / Uber Eats. Orders arrive via webhook and appear
 * in the POS + kitchen display automatically. The webhook secret is write-only
 * (the API never returns it — only a `has_secret` flag).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import { delivery as deliveryApi, type DeliveryProviderConfig } from '../lib/api';
import { showToast } from '../components/ui/Toast';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const PROVIDERS: Array<{ key: string; name: string; portal: string }> = [
  { key: 'doordash', name: 'DoorDash', portal: 'merchant.doordash.com → Settings → Webhooks' },
  { key: 'ubereats', name: 'Uber Eats', portal: 'restaurant.uber.com → Settings → Integrations' },
];

interface FormState {
  isEnabled: boolean;
  storeId: string;
  webhookSecret: string; // only sent when non-empty
}

function ProviderCard({
  meta,
  existing,
  onSaved,
}: {
  meta: { key: string; name: string; portal: string };
  existing: DeliveryProviderConfig | undefined;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>({ isEnabled: false, storeId: '', webhookSecret: '' });
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      isEnabled: existing?.is_enabled ?? false,
      storeId: existing?.store_id ?? '',
      webhookSecret: '',
    });
  }, [existing]);

  const webhookUrl = `${API_BASE}/api/v1/webhooks/${meta.key}`;
  const configured = (existing?.has_secret ?? false) && !!(existing?.store_id);
  const status: 'green' | 'amber' | 'gray' = !form.isEnabled
    ? 'gray'
    : configured || (form.storeId && form.webhookSecret)
      ? 'green'
      : 'amber';
  const statusColor = status === 'green' ? 'bg-green-500' : status === 'amber' ? 'bg-amber-500' : 'bg-gray-300';

  async function save() {
    setSaving(true);
    try {
      await deliveryApi.save(meta.key, {
        isEnabled: form.isEnabled,
        storeId: form.storeId || undefined,
        webhookSecret: form.webhookSecret || undefined,
      });
      showToast.success(`${meta.name} settings saved`);
      onSaved();
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function copyUrl() {
    navigator.clipboard?.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5 mb-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <h3 className="text-lg font-bold text-gray-900">{meta.name}</h3>
        </div>
        <button
          onClick={() => setForm((f) => ({ ...f, isEnabled: !f.isEnabled }))}
          className={`relative w-11 h-6 rounded-full transition-colors ${form.isEnabled ? 'bg-primary' : 'bg-gray-200'}`}
          aria-label={`Toggle ${meta.name}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isEnabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {form.isEnabled && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Store ID</label>
            <input
              value={form.storeId}
              onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
              placeholder="Provider-assigned store ID"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Webhook secret {existing?.has_secret && <span className="text-gray-400">(saved — leave blank to keep)</span>}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={form.webhookSecret}
                onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
                placeholder={existing?.has_secret ? '••••••••' : 'Paste your webhook signing secret'}
                className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Webhook URL (read-only)</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 text-xs bg-gray-100 rounded-md text-gray-700 break-all">{webhookUrl}</code>
              <button onClick={copyUrl} className="shrink-0 p-2 rounded-md hover:bg-gray-100 text-gray-500" aria-label="Copy URL">
                {copied ? <Check size={15} className="text-primary" /> : <Copy size={15} />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Paste this URL in {meta.portal}. Copy the webhook secret shown there into the field above.
            </p>
          </div>

          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Save ${meta.name}`}
          </button>
        </div>
      )}
    </div>
  );
}

export function DeliverySettingsPage() {
  const qc = useQueryClient();
  const { data: providers } = useQuery({ queryKey: ['delivery', 'providers'], queryFn: () => deliveryApi.list() });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Delivery Integrations</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Connect DoorDash and Uber Eats to receive orders directly in your Taproot POS and kitchen display.
      </p>

      {PROVIDERS.map((p) => (
        <ProviderCard
          key={p.key}
          meta={p}
          existing={providers?.find((x) => x.provider === p.key)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['delivery', 'providers'] })}
        />
      ))}
    </div>
  );
}

export default DeliverySettingsPage;
