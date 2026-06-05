/**
 * BusinessSettingsPage — /settings/business
 *
 * Tabs: General | Tax | Receipt | Hours.
 * Tax rates are stored in locations.tax_config and drive the server-side tax
 * calculation on order create (replacing the legacy hardcoded 8.5%).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import {
  settings as settingsApi, auth as authApi,
  type LocationAddress, type TaxRateConfig, type ReceiptConfig,
} from '../lib/api';
import { showToast } from '../components/ui/Toast';

const TABS = ['General', 'Tax', 'Receipt', 'Hours'] as const;
type Tab = typeof TABS[number];

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'Europe/London', 'UTC',
];
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD'];

function fieldCls() {
  return 'w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
}
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-gray-600 mb-1">{children}</label>;
}

// ─── General tab ────────────────────────────────────────────────────────────

function GeneralTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'business'], queryFn: () => settingsApi.getBusiness() });

  const [form, setForm] = useState({
    name: '', locationName: '', website: '', logoUrl: '',
    phone: '', timezone: 'America/New_York', currency: 'USD',
    address: {} as LocationAddress,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.orgName, website: data.website, logoUrl: data.logoUrl,
      locationName: data.location?.name ?? '',
      phone: data.location?.phone ?? '',
      timezone: data.location?.timezone ?? 'America/New_York',
      currency: data.location?.currency ?? 'USD',
      address: data.location?.address ?? {},
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.saveBusiness({
      name: form.name, website: form.website, logoUrl: form.logoUrl,
      locationName: form.locationName, phone: form.phone,
      timezone: form.timezone, currency: form.currency, address: form.address,
    }),
    onSuccess: () => { showToast.success('Business settings saved'); void qc.invalidateQueries({ queryKey: ['settings', 'business'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const addr = (k: keyof LocationAddress, v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));

  if (isLoading) return <div className="p-6"><div className="h-40 bg-gray-100 rounded animate-shimmer" /></div>;

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><Label>Restaurant name</Label>
          <input className={fieldCls()} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
        <div><Label>Location name</Label>
          <input className={fieldCls()} value={form.locationName} onChange={(e) => setForm((f) => ({ ...f, locationName: e.target.value }))} /></div>
      </div>

      <div><Label>Address line 1</Label>
        <input className={fieldCls()} value={form.address.line1 ?? ''} onChange={(e) => addr('line1', e.target.value)} placeholder="123 Main St" /></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><Label>City</Label><input className={fieldCls()} value={form.address.city ?? ''} onChange={(e) => addr('city', e.target.value)} /></div>
        <div><Label>State</Label><input className={fieldCls()} value={form.address.state ?? ''} onChange={(e) => addr('state', e.target.value)} /></div>
        <div><Label>ZIP</Label><input className={fieldCls()} value={form.address.zip ?? ''} onChange={(e) => addr('zip', e.target.value)} /></div>
        <div><Label>Country</Label><input className={fieldCls()} value={form.address.country ?? ''} onChange={(e) => addr('country', e.target.value)} placeholder="US" /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><Label>Phone</Label><input className={fieldCls()} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
        <div><Label>Website</Label><input className={fieldCls()} value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} placeholder="https://" /></div>
      </div>

      <div><Label>Logo URL</Label>
        <input className={fieldCls()} value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…/logo.png" /></div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><Label>Timezone</Label>
          <select className={fieldCls() + ' bg-white'} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select></div>
        <div><Label>Currency</Label>
          <select className={fieldCls() + ' bg-white'} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
      </div>

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>

      <ChangePasswordSection />
    </div>
  );
}

function ChangePasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: () => {
      if (next.length < 8) throw new Error('New password must be at least 8 characters');
      if (next !== confirm) throw new Error('Passwords do not match');
      return authApi.changePassword(current, next);
    },
    onSuccess: () => { showToast.success('Password changed'); setCurrent(''); setNext(''); setConfirm(''); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Change failed'),
  });

  return (
    <div className="mt-6 pt-6 border-t border-gray-100">
      <h3 className="text-sm font-bold text-gray-900 mb-3">Change password</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
        <div><Label>Current</Label><input type="password" className={fieldCls()} value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div><Label>New</Label><input type="password" className={fieldCls()} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div><Label>Confirm</Label><input type="password" className={fieldCls()} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      </div>
      <button onClick={() => change.mutate()} disabled={change.isPending || !current || !next}
        className="mt-3 px-4 py-2 border border-gray-200 text-sm font-semibold text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50">
        {change.isPending ? 'Updating…' : 'Update password'}
      </button>
    </div>
  );
}

// ─── Tax tab ────────────────────────────────────────────────────────────────

function TaxTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'tax'], queryFn: () => settingsApi.getTax() });

  const [rates, setRates] = useState<TaxRateConfig[]>([]);
  const [inclusive, setInclusive] = useState(false);

  useEffect(() => {
    if (!data) return;
    setRates(data.taxRates);
    setInclusive(data.taxInclusive);
  }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.saveTax({ taxRates: rates, taxInclusive: inclusive }),
    onSuccess: () => { showToast.success('Tax settings saved'); void qc.invalidateQueries({ queryKey: ['settings', 'tax'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const totalRate = rates.reduce((s, r) => s + (Number(r.rate) || 0), 0);
  const previewCents = inclusive ? 1000 : Math.round(1000 * (1 + totalRate));

  if (isLoading) return <div className="p-6"><div className="h-40 bg-gray-100 rounded animate-shimmer" /></div>;

  return (
    <div className="max-w-2xl space-y-4">
      {rates.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-700">
          <AlertTriangle size={16} /> No tax rate configured — orders will be charged $0 tax.
        </div>
      )}

      {rates.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 p-3 border border-gray-100 rounded-md">
          <div className="flex-1 min-w-[140px]"><Label>Name</Label>
            <input className={fieldCls()} value={r.name}
              onChange={(e) => setRates((rs) => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              placeholder="Sales Tax" /></div>
          <div className="w-28"><Label>Rate %</Label>
            <input className={fieldCls()} inputMode="decimal" value={(r.rate * 100).toString()}
              onChange={(e) => { const pct = parseFloat(e.target.value) || 0; setRates((rs) => rs.map((x, j) => j === i ? { ...x, rate: pct / 100 } : x)); }}
              placeholder="8.25" /></div>
          <div className="w-36"><Label>Applies to</Label>
            <select className={fieldCls() + ' bg-white'} value={r.appliesTo}
              onChange={(e) => setRates((rs) => rs.map((x, j) => j === i ? { ...x, appliesTo: e.target.value as TaxRateConfig['appliesTo'] } : x))}>
              <option value="all">All</option><option value="food">Food</option>
              <option value="alcohol">Alcohol</option><option value="merchandise">Merchandise</option>
            </select></div>
          <button onClick={() => setRates((rs) => rs.filter((_, j) => j !== i))}
            className="p-2 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
        </div>
      ))}

      <button onClick={() => setRates((rs) => [...rs, { name: '', rate: 0, appliesTo: 'all' }])}
        className="flex items-center gap-1.5 text-sm text-primary hover:underline"><Plus size={15} /> Add tax rate</button>

      <label className="flex items-center gap-2 cursor-pointer pt-2">
        <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} className="w-4 h-4 accent-primary" />
        <span className="text-sm text-gray-700">Tax-inclusive pricing (tax already included in the listed price)</span>
      </label>

      <div className="p-3 bg-gray-50 rounded-md text-sm text-gray-600">
        Preview: On a $10.00 item, customer pays <strong className="text-gray-900">${(previewCents / 100).toFixed(2)}</strong>
        {' '}({(totalRate * 100).toFixed(3)}% total{inclusive ? ', inclusive' : ''})
      </div>

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
        {save.isPending ? 'Saving…' : 'Save tax settings'}
      </button>
    </div>
  );
}

// ─── Receipt tab ────────────────────────────────────────────────────────────

function ReceiptTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings', 'receipt'], queryFn: () => settingsApi.getReceipt() });
  const [cfg, setCfg] = useState<ReceiptConfig>({});

  useEffect(() => { if (data) setCfg(data.receiptConfig ?? {}); }, [data]);

  const save = useMutation({
    mutationFn: () => settingsApi.saveReceipt(cfg),
    onSuccess: () => { showToast.success('Receipt settings saved'); void qc.invalidateQueries({ queryKey: ['settings', 'receipt'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const toggle = (k: keyof ReceiptConfig) => setCfg((c) => ({ ...c, [k]: !c[k] }));

  if (isLoading) return <div className="p-6"><div className="h-40 bg-gray-100 rounded animate-shimmer" /></div>;

  return (
    <div className="max-w-2xl space-y-4">
      <div><Label>Custom receipt message</Label>
        <textarea className={fieldCls() + ' resize-none'} rows={2} value={cfg.message ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, message: e.target.value }))} placeholder="Thank you for visiting!" /></div>
      <div><Label>Footer text</Label>
        <textarea className={fieldCls() + ' resize-none'} rows={2} value={cfg.footerText ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, footerText: e.target.value }))} placeholder="Returns accepted within 30 days" /></div>

      <div className="space-y-2 pt-1">
        {([['showLogo', 'Show logo'], ['showAddress', 'Show address'], ['showPhone', 'Show phone'], ['showWebsite', 'Show website']] as Array<[keyof ReceiptConfig, string]>).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(cfg[k])} onChange={() => toggle(k)} className="w-4 h-4 accent-primary" />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-50">
        {save.isPending ? 'Saving…' : 'Save receipt settings'}
      </button>
    </div>
  );
}

// ─── Hours tab (placeholder) ────────────────────────────────────────────────

function HoursTab() {
  return (
    <div className="max-w-2xl">
      <div className="p-6 bg-gray-50 rounded-lg text-center">
        <p className="text-sm font-medium text-gray-500">Business hours editor coming soon</p>
        <p className="text-xs text-gray-400 mt-1">Per-day open/close times will be configurable here.</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BusinessSettingsPage() {
  const [tab, setTab] = useState<Tab>('General');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 pt-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900 mb-3">Business</h1>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {tab === 'General' && <GeneralTab />}
        {tab === 'Tax' && <TaxTab />}
        {tab === 'Receipt' && <ReceiptTab />}
        {tab === 'Hours' && <HoursTab />}
      </div>
    </div>
  );
}
