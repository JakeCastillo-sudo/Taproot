/**
 * MigrationPage — 5-step wizard to import data from Square, Shopify,
 * Toast, Lightspeed, Clover, or a CSV file.
 *
 * Step 1: Choose provider
 * Step 2: Enter credentials (provider-specific form + Test Connection)
 * Step 3: Preview fetched data (counts + options)
 * Step 4: Progress screen (animated steps)
 * Step 5: Complete (summary + error download)
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  ArrowLeft, ArrowRight, CheckCircle2, XCircle,
  RefreshCw, Download, ShieldCheck, Users, Package,
  Tag, Zap, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { migrationsApi, type ImportJob, type MigrationResult } from '../lib/api';
import { showToast } from '../components/ui/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type Provider = 'square' | 'shopify' | 'toast' | 'lightspeed' | 'clover' | 'csv';

interface ProviderMeta {
  id:          Provider;
  label:       string;
  description: string;
  color:       string;
  iconBg:      string;
  fields:      CredentialField[];
}

interface CredentialField {
  key:         string;
  label:       string;
  type:        'text' | 'password';
  placeholder: string;
  required:    boolean;
  hint?:       string;
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface ImportOptions {
  importProducts:      boolean;
  importCustomers:     boolean;
  importLoyaltyPoints: boolean;
  overwriteExisting:   boolean;
}

// ─── Provider definitions ─────────────────────────────────────────────────────

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'square',
    label: 'Square',
    description: 'Import catalog items, categories, and customers from Square POS.',
    color: 'border-green-200 bg-green-50 hover:bg-green-100',
    iconBg: 'bg-black',
    fields: [
      {
        key: 'accessToken', label: 'Access Token', type: 'password',
        placeholder: 'EAAAl…', required: true,
        hint: 'Found in Square Developer → Applications → OAuth',
      },
      {
        key: 'squareLocationId', label: 'Square Location ID (optional)', type: 'text',
        placeholder: 'LXXXXXXXXXXXXXXXX', required: false,
        hint: 'Leave blank to import all locations',
      },
    ],
  },
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Import products, collections, and customers from your Shopify store.',
    color: 'border-lime-200 bg-lime-50 hover:bg-lime-100',
    iconBg: 'bg-[#96bf48]',
    fields: [
      {
        key: 'shopDomain', label: 'Shop Domain', type: 'text',
        placeholder: 'my-shop.myshopify.com', required: true,
        hint: 'Your *.myshopify.com domain',
      },
      {
        key: 'accessToken', label: 'Admin API Access Token', type: 'password',
        placeholder: 'shpat_…', required: true,
        hint: 'Custom app → Admin API access token',
      },
    ],
  },
  {
    id: 'toast',
    label: 'Toast',
    description: 'Import menus, items, and employee data from Toast POS.',
    color: 'border-orange-200 bg-orange-50 hover:bg-orange-100',
    iconBg: 'bg-[#FF6D2B]',
    fields: [
      {
        key: 'clientId', label: 'Client ID', type: 'text',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true,
        hint: 'Toast Developer → Your Integration → Client ID',
      },
      {
        key: 'clientSecret', label: 'Client Secret', type: 'password',
        placeholder: '', required: true,
        hint: 'Toast Developer → Your Integration → Client Secret',
      },
      {
        key: 'restaurantGuid', label: 'Restaurant GUID', type: 'text',
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true,
        hint: 'Toast Management → Restaurant Info → Management GUID',
      },
    ],
  },
  {
    id: 'lightspeed',
    label: 'Lightspeed',
    description: 'Import items and categories from Lightspeed R-Series.',
    color: 'border-red-200 bg-red-50 hover:bg-red-100',
    iconBg: 'bg-[#E63946]',
    fields: [
      {
        key: 'apiKey', label: 'API Key', type: 'password',
        placeholder: '', required: true,
        hint: 'Lightspeed → Settings → API Access',
      },
      {
        key: 'accountId', label: 'Account ID', type: 'text',
        placeholder: '123456', required: true,
        hint: 'Found in your Lightspeed account URL',
      },
    ],
  },
  {
    id: 'clover',
    label: 'Clover',
    description: 'Import inventory items and customers from Clover.',
    color: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
    iconBg: 'bg-[#1EC677]',
    fields: [
      {
        key: 'accessToken', label: 'OAuth Token', type: 'password',
        placeholder: '', required: true,
        hint: 'Clover Developer Dashboard → OAuth Token',
      },
      {
        key: 'merchantId', label: 'Merchant ID', type: 'text',
        placeholder: 'XXXXXXXXXXXXXXXX', required: true,
        hint: 'Found in Clover Dashboard URL: /merchants/{merchantId}',
      },
    ],
  },
  {
    id: 'csv',
    label: 'CSV File',
    description: 'Upload a CSV file with products, customers, or inventory data.',
    color: 'border-blue-200 bg-blue-50 hover:bg-blue-100',
    iconBg: 'bg-blue-600',
    fields: [
      {
        key: 'targetSchema', label: 'Import Type', type: 'text',
        placeholder: 'products', required: true,
        hint: 'One of: products, customers, inventory',
      },
    ],
  },
];

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Choose', 'Connect', 'Preview', 'Importing', 'Done'];

function StepBar({ current }: { current: WizardStep }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const step = (i + 1) as WizardStep;
        const done    = step < current;
        const active  = step === current;
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors',
                  done   ? 'bg-primary border-primary text-white'   :
                  active ? 'bg-white border-primary text-primary'   :
                           'bg-gray-100 border-gray-200 text-gray-400',
                )}
              >
                {done ? <CheckCircle2 size={16} /> : step}
              </div>
              <span className={clsx(
                'text-[10px] font-medium hidden sm:block',
                active ? 'text-primary' : done ? 'text-gray-600' : 'text-gray-300',
              )}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={clsx(
                'flex-1 h-0.5 mx-1 mb-4 transition-colors',
                done ? 'bg-primary' : 'bg-gray-200',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── ProviderIcon ─────────────────────────────────────────────────────────────

function ProviderIcon({ provider, size = 'md' }: { provider: ProviderMeta; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base';
  return (
    <div className={clsx(sz, 'rounded-xl flex items-center justify-center text-white font-bold shrink-0', provider.iconBg)}>
      {provider.label.slice(0, 2)}
    </div>
  );
}

// ─── Step 1 — Choose provider ─────────────────────────────────────────────────

function Step1({ onSelect }: { onSelect: (p: Provider) => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Where are you migrating from?</h2>
      <p className="text-sm text-gray-500 mb-6">
        Select your current POS or upload a CSV file. Your credentials are used only for this
        import and are <strong>never stored</strong>.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={clsx(
              'flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all text-left cursor-pointer',
              p.color,
            )}
          >
            <ProviderIcon provider={p} size="lg" />
            <div>
              <p className="text-sm font-semibold text-gray-900">{p.label}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-tight">{p.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2 — Credentials form ────────────────────────────────────────────────

interface Step2Props {
  provider:   ProviderMeta;
  locationId: string;
  onJobReady: (job: ImportJob, creds: Record<string, string>) => void;
  onBack:     () => void;
}

function Step2({ provider, locationId, onJobReady, onBack }: Step2Props) {
  const [creds,     setCreds]     = useState<Record<string, string>>({});
  const [csvFile,   setCsvFile]   = useState<File | null>(null);
  const [testing,   setTesting]   = useState(false);
  const [testOk,    setTestOk]    = useState<boolean | null>(null);
  const [testMsg,   setTestMsg]   = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: string, val: string) => setCreds((c) => ({ ...c, [key]: val }));

  const canTest = provider.id === 'square' || provider.id === 'shopify' || provider.id === 'clover';

  async function handleTest() {
    setTesting(true);
    setTestOk(null);
    try {
      if (provider.id === 'square') {
        const r = await migrationsApi.testSquare(creds['accessToken'] ?? '');
        setTestOk(r.ok);
        setTestMsg(r.ok ? `Connected — ${r.locationCount} location(s) found` : 'Connection failed');
      } else if (provider.id === 'shopify') {
        const r = await migrationsApi.testShopify(creds['shopDomain'] ?? '', creds['accessToken'] ?? '');
        setTestOk(r.ok);
        setTestMsg(r.ok ? `Connected to "${r.shopName}"` : 'Connection failed');
      } else if (provider.id === 'clover') {
        const r = await migrationsApi.testClover(creds['merchantId'] ?? '', creds['accessToken'] ?? '');
        setTestOk(r.ok);
        setTestMsg(r.ok ? `Connected to "${r.merchantName}"` : 'Connection failed');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      setTestOk(false);
      setTestMsg(msg);
    } finally {
      setTesting(false);
    }
  }

  async function handleStart() {
    setSubmitting(true);
    try {
      let job: ImportJob;
      if (provider.id === 'square') {
        job = await migrationsApi.startSquare(locationId, creds['accessToken'] ?? '', creds['squareLocationId']);
      } else if (provider.id === 'shopify') {
        job = await migrationsApi.startShopify(locationId, creds['shopDomain'] ?? '', creds['accessToken'] ?? '');
      } else if (provider.id === 'toast') {
        job = await migrationsApi.startToast(
          locationId,
          creds['clientId'] ?? '', creds['clientSecret'] ?? '', creds['restaurantGuid'] ?? '',
        );
      } else if (provider.id === 'lightspeed') {
        job = await migrationsApi.startLightspeed(locationId, creds['apiKey'] ?? '', creds['accountId'] ?? '');
      } else if (provider.id === 'clover') {
        job = await migrationsApi.startClover(locationId, creds['accessToken'] ?? '', creds['merchantId'] ?? '');
      } else {
        // CSV
        if (!csvFile) { showToast.error('Please select a CSV file'); setSubmitting(false); return; }
        const rawCsv = await csvFile.text();
        const targetSchema = (creds['targetSchema'] ?? 'products') as 'products' | 'customers' | 'inventory';
        job = await migrationsApi.startCsv(locationId, csvFile.name, targetSchema, rawCsv);
      }
      onJobReady(job, creds);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start migration';
      showToast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const allFilled = provider.fields
    .filter((f) => f.required && f.key !== 'targetSchema')
    .every((f) => (creds[f.key] ?? '').trim().length > 0);

  const canSubmit = provider.id === 'csv' ? (allFilled && csvFile !== null) : allFilled;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ProviderIcon provider={provider} />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Connect to {provider.label}</h2>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <ShieldCheck size={11} className="text-green-500" />
            Your credentials are used only for this import and are never stored.
          </p>
        </div>
      </div>

      <div className="space-y-4 max-w-lg">
        {provider.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label}
              {field.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            <input
              type={field.type}
              value={creds[field.key] ?? ''}
              onChange={(e) => set(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              autoComplete="off"
            />
            {field.hint && (
              <p className="text-xs text-gray-400 mt-1">{field.hint}</p>
            )}
          </div>
        ))}

        {/* CSV file picker */}
        {provider.id === 'csv' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CSV File <span className="text-red-400">*</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2 border-2 border-dashed border-gray-300 rounded-md text-sm text-gray-500 hover:border-primary/50 hover:text-primary transition-colors"
            >
              {csvFile ? csvFile.name : 'Click to select a CSV file'}
            </button>
          </div>
        )}

        {/* Test connection */}
        {canTest && (
          <div>
            <button
              onClick={handleTest}
              disabled={testing || !allFilled}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {testing
                ? <RefreshCw size={14} className="animate-spin" />
                : <Zap size={14} className="text-primary" />}
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            {testOk !== null && (
              <p className={clsx(
                'mt-2 text-sm flex items-center gap-1.5',
                testOk ? 'text-green-600' : 'text-red-500',
              )}>
                {testOk
                  ? <CheckCircle2 size={14} />
                  : <XCircle size={14} />}
                {testMsg}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-8">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          onClick={handleStart}
          disabled={!canSubmit || submitting}
          className="flex items-center gap-1.5 px-5 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 transition-colors font-medium"
        >
          {submitting
            ? <RefreshCw size={14} className="animate-spin" />
            : <ArrowRight size={14} />}
          {submitting ? 'Fetching data…' : 'Fetch & Preview'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 3 — Preview ─────────────────────────────────────────────────────────

interface Step3Props {
  job:      ImportJob;
  provider: ProviderMeta;
  options:  ImportOptions;
  onChange: (opts: ImportOptions) => void;
  onApply:  () => void;
  onBack:   () => void;
}

function Step3({ job, provider, options, onChange, onApply, onBack }: Step3Props) {
  const payload = job.mapping_config as {
    categories?: unknown[];
    products?:   unknown[];
    customers?:  unknown[];
    employees?:  unknown[];
  } | null;

  const catCount  = payload?.categories?.length  ?? 0;
  const prodCount = payload?.products?.length    ?? 0;
  const custCount = payload?.customers?.length   ?? 0;
  const empCount  = payload?.employees?.length   ?? 0;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <ProviderIcon provider={provider} />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Preview import</h2>
          <p className="text-xs text-gray-500 mt-0.5">Review what will be created in Taproot.</p>
        </div>
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        {[
          { label: 'Categories', count: catCount,  icon: Tag,     color: 'text-purple-600 bg-purple-50' },
          { label: 'Products',   count: prodCount, icon: Package, color: 'text-blue-600 bg-blue-50'     },
          { label: 'Customers',  count: custCount, icon: Users,   color: 'text-green-600 bg-green-50'   },
          { label: 'Employees',  count: empCount,  icon: Users,   color: 'text-orange-600 bg-orange-50' },
        ].map(({ label, count, icon: Icon, color }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-xl p-4 text-center">
            <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2', color)}>
              <Icon size={18} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{count.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Options */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-800 mb-1">Import options</p>

        {[
          { key: 'importProducts',      label: 'Import products & categories', disabled: false },
          { key: 'importCustomers',     label: 'Import customers',              disabled: custCount === 0 },
          { key: 'importLoyaltyPoints', label: 'Import loyalty points',         disabled: custCount === 0 },
          { key: 'overwriteExisting',   label: 'Overwrite existing records (by name)', disabled: false },
        ].map(({ key, label, disabled }) => (
          <label
            key={key}
            className={clsx(
              'flex items-center gap-2.5 cursor-pointer select-none',
              disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            <input
              type="checkbox"
              className="w-4 h-4 rounded accent-primary"
              checked={options[key as keyof ImportOptions]}
              disabled={disabled}
              onChange={(e) => onChange({ ...options, [key]: e.target.checked })}
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      {/* Warning if large */}
      {(prodCount + custCount) > 500 && (
        <div className="mt-4 flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            Large import detected ({(prodCount + custCount).toLocaleString()} records). This may
            take a few minutes. The page will update automatically when complete.
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <button
          onClick={onApply}
          disabled={!options.importProducts && !options.importCustomers}
          className="flex items-center gap-1.5 px-5 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 transition-colors font-medium"
        >
          <ChevronRight size={14} /> Start import
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — Progress ────────────────────────────────────────────────────────

const PROGRESS_STEPS = [
  'Creating categories…',
  'Importing products…',
  'Importing customers…',
  'Finalising records…',
];

function Step4({ provider }: { provider: ProviderMeta }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_200);
    return () => clearInterval(t);
  }, []);

  const activeStep = Math.min(tick, PROGRESS_STEPS.length - 1);

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6">
      <ProviderIcon provider={provider} size="lg" />
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-900">Importing from {provider.label}</h2>
        <p className="text-sm text-gray-500 mt-1">Please wait &mdash; don&apos;t close this page.</p>
      </div>

      <div className="w-full max-w-sm space-y-2">
        {PROGRESS_STEPS.map((label, i) => (
          <div key={label} className={clsx(
            'flex items-center gap-3 px-4 py-3 rounded-lg transition-all',
            i < activeStep
              ? 'bg-green-50'
              : i === activeStep
              ? 'bg-primary/5 border border-primary/20'
              : 'bg-gray-50 opacity-40',
          )}>
            {i < activeStep
              ? <CheckCircle2 size={16} className="text-green-500 shrink-0" />
              : i === activeStep
              ? <RefreshCw size={16} className="text-primary animate-spin shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />}
            <span className={clsx(
              'text-sm',
              i < activeStep ? 'text-green-700 font-medium' :
              i === activeStep ? 'text-primary font-semibold' : 'text-gray-400',
            )}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 5 — Complete ────────────────────────────────────────────────────────

interface Step5Props {
  result:   MigrationResult | null;
  provider: ProviderMeta;
  onDone:   () => void;
  onRetry:  () => void;
}

function Step5({ result, provider, onDone, onRetry }: Step5Props) {
  const success = result && result.failed === 0;
  const partial = result && result.failed > 0 && (result.products + result.customers) > 0;

  function downloadErrors() {
    if (!result?.errors?.length) return;
    const blob = new Blob([result.errors.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `migration-errors-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col items-center text-center py-8 gap-5">
      {success || partial ? (
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 size={36} className="text-green-500" />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <XCircle size={36} className="text-red-500" />
        </div>
      )}

      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          {success ? 'Import complete!' : partial ? 'Partial import' : 'Import failed'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {success
            ? `All records from ${provider.label} were imported successfully.`
            : partial
            ? `Some records were imported with errors.`
            : 'The import could not be completed. See errors below.'}
        </p>
      </div>

      {result && (
        <div className="w-full max-w-sm grid grid-cols-2 gap-3 text-left">
          {[
            { label: 'Categories created', count: result.categories },
            { label: 'Products created',   count: result.products   },
            { label: 'Customers created',  count: result.customers  },
            { label: 'Failed records',     count: result.failed, red: true },
          ].map(({ label, count, red }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className={clsx('text-2xl font-bold', red && count > 0 ? 'text-red-500' : 'text-gray-900')}>
                {count.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {result && result.errors.length > 0 && (
        <button
          onClick={downloadErrors}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-red-200 text-red-600 rounded-md hover:bg-red-50 transition-colors"
        >
          <Download size={14} /> Download error log ({result.errors.length})
        </button>
      )}

      <div className="flex items-center gap-3 mt-2">
        {!success && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} /> Try again
          </button>
        )}
        <button
          onClick={onDone}
          className="flex items-center gap-1.5 px-5 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary-dark transition-colors font-medium"
        >
          <CheckCircle2 size={14} /> Go to inventory
        </button>
      </div>
    </div>
  );
}

// ─── MigrationPage ────────────────────────────────────────────────────────────

export function MigrationPage() {
  const navigate = useNavigate();

  const [step,      setStep]     = useState<WizardStep>(1);
  const [provider,  setProvider] = useState<ProviderMeta | null>(null);
  const [job,       setJob]      = useState<ImportJob | null>(null);
  const [result,    setResult]   = useState<MigrationResult | null>(null);
  const [applying,  setApplying] = useState(false);

  // Use the first location from localStorage (demo sets locationId)
  const [locationId] = useState<string>(() => {
    try {
      const u = JSON.parse(localStorage.getItem('taproot_user') ?? '{}');
      return (u.locationIds?.[0] as string | undefined) ?? 'default';
    } catch { return 'default'; }
  });

  const [options, setOptions] = useState<ImportOptions>({
    importProducts:      true,
    importCustomers:     true,
    importLoyaltyPoints: false,
    overwriteExisting:   false,
  });

  // ── Poll for job status while the backend is fetching external data ─────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling(jobId: string, onDone: (j: ImportJob) => void) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 120) {  // 2 min max at 1s
        clearInterval(pollRef.current!);
        showToast.error('Import timed out');
        return;
      }
      try {
        const j = await migrationsApi.getJob(jobId);
        if (j.status === 'awaiting_confirmation' || j.status === 'failed') {
          clearInterval(pollRef.current!);
          onDone(j);
        }
      } catch { /* network glitch — keep polling */ }
    }, 1_500);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleSelectProvider(p: Provider) {
    setProvider(PROVIDERS.find((x) => x.id === p) ?? null);
    setStep(2);
  }

  function handleJobReady(j: ImportJob, _creds: Record<string, string>) {
    setJob(j);
    // If the job comes back instantly awaiting_confirmation, skip polling
    if (j.status === 'awaiting_confirmation') {
      setStep(3);
    } else {
      // Poll until external fetch completes
      startPolling(j.id, (done) => {
        setJob(done);
        if (done.status === 'awaiting_confirmation') setStep(3);
        else showToast.error(done.error_log?.[0]?.message ?? 'Import failed');
      });
    }
  }

  async function handleApply() {
    if (!job) return;
    setStep(4);
    setApplying(true);
    try {
      const r = await migrationsApi.apply(job.id, locationId, options);
      setResult(r);
      setStep(5);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      showToast.error(msg);
      setResult({ categories: 0, products: 0, customers: 0, employees: 0, failed: 1, errors: [msg] });
      setStep(5);
    } finally {
      setApplying(false);
    }
  }

  function handleReset() {
    setStep(1);
    setProvider(null);
    setJob(null);
    setResult(null);
    setApplying(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="text-sm font-bold text-gray-900">Migration Wizard</h1>
          <p className="text-xs text-gray-400">Import your business data in under 10 minutes</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <StepBar current={step} />

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
          {step === 1 && (
            <Step1 onSelect={handleSelectProvider} />
          )}

          {step === 2 && provider && (
            <Step2
              provider={provider}
              locationId={locationId}
              onJobReady={handleJobReady}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && job && provider && (
            <Step3
              job={job}
              provider={provider}
              options={options}
              onChange={setOptions}
              onApply={handleApply}
              onBack={() => setStep(2)}
            />
          )}

          {step === 4 && provider && (
            <Step4 provider={provider} />
          )}

          {step === 5 && provider && (
            <Step5
              result={result}
              provider={provider}
              onDone={() => navigate('/inventory')}
              onRetry={handleReset}
            />
          )}
        </div>
      </div>

      {/* Suppress unused applying warning */}
      {applying && null}
    </div>
  );
}
