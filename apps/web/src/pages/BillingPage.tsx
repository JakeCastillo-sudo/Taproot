import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard, CheckCircle, AlertCircle, Clock, XCircle,
  ExternalLink, ArrowLeft, Loader2, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { apiFetch } from '../lib/api';
import { QK } from '../lib/queryClient';
import { fmtCurrency } from '../lib/dateRanges';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubscriptionInfo {
  status:             string;
  plan:               string;
  isTrialing:         boolean;
  daysRemaining:      number;
  trialEndsAt:        string | null;
  subscriptionEndsAt: string | null;
  locationCount:      number;
  stripeCustomerId:   string | null;
}

interface Invoice {
  id:           string;
  number:       string;
  amountPaid:   number;
  currency:     string;
  status:       string;
  created:      number;
  invoicePdf:   string | null;
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
    trialing: { label: 'Trial',    icon: <Clock size={12} />,        cls: 'bg-amber-100 text-amber-700' },
    active:   { label: 'Active',   icon: <CheckCircle size={12} />,  cls: 'bg-green-100 text-green-700' },
    past_due: { label: 'Past Due', icon: <AlertCircle size={12} />,  cls: 'bg-orange-100 text-orange-700' },
    cancelled:{ label: 'Cancelled',icon: <XCircle size={12} />,      cls: 'bg-red-100 text-red-700' },
    unpaid:   { label: 'Unpaid',   icon: <XCircle size={12} />,      cls: 'bg-red-100 text-red-700' },
  };
  const s = map[status] ?? { label: status, icon: null, cls: 'bg-gray-100 text-gray-700' };
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full', s.cls)}>
      {s.icon}{s.label}
    </span>
  );
}

// ─── BillingPage ──────────────────────────────────────────────────────────────

export function BillingPage() {
  const navigate     = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: sub, isLoading } = useQuery({
    queryKey: QK.billing(),
    queryFn:  () => apiFetch<SubscriptionInfo>('/billing/subscription'),
    staleTime: 60_000,
  });

  const { data: invoices } = useQuery({
    queryKey: QK.billingInvoices(),
    queryFn:  () => apiFetch<{ invoices: Invoice[] }>('/billing/invoices'),
    enabled:  !!sub?.stripeCustomerId,
    staleTime: 300_000,
  });

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/billing/portal', { method: 'POST' });
      window.location.href = url;
    } catch {
      // fallback: just show an error
      alert('Unable to open billing portal. Please contact support@taproot-pos.com');
    } finally {
      setPortalLoading(false);
    }
  };

  const PLAN_FEATURES = [
    'Unlimited orders & payments',
    'AI menu import & migration',
    'Recipe costing & inventory',
    'Customer loyalty & gift cards',
    'Analytics & reporting',
    'Unlimited team members',
    'PWA — works on any device',
    'Email & chat support',
  ];

  if (isLoading) {
    return (
      <div className="h-screen bg-surface-2 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-surface-2">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 text-gray-500 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Billing</h1>
            <p className="text-sm text-gray-400">Manage your Taproot subscription</p>
          </div>
        </div>

        {/* ── Plan Status ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Current Plan</h2>
            {sub && <StatusBadge status={sub.status} />}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-gray-900">Taproot Starter</p>
              <p className="text-sm text-gray-400">$199 / month per location</p>
            </div>
            <div className="text-right">
              {sub?.isTrialing && (
                <div>
                  <p className="text-sm font-semibold text-amber-600">
                    {sub.daysRemaining > 0
                      ? `${sub.daysRemaining} days remaining`
                      : 'Trial ended'}
                  </p>
                  {sub.trialEndsAt && (
                    <p className="text-xs text-gray-400">
                      Ends {new Date(sub.trialEndsAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
              {sub?.status === 'active' && sub.subscriptionEndsAt && (
                <p className="text-sm text-gray-500">
                  Next bill {new Date(sub.subscriptionEndsAt).toLocaleDateString()}
                </p>
              )}
              {sub?.status === 'past_due' && (
                <p className="text-sm font-semibold text-orange-600">Payment required</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 mt-4 pt-4 border-t border-gray-100">
            {sub?.isTrialing && (
              <button
                onClick={() => navigate('/upgrade')}
                className="flex-1 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark transition-colors"
              >
                Start Subscription
              </button>
            )}
            {sub?.stripeCustomerId && (
              <button
                onClick={() => void openPortal()}
                disabled={portalLoading}
                className="flex-1 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
              >
                {portalLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ExternalLink size={14} />}
                Manage Billing
              </button>
            )}
          </div>
        </div>

        {/* ── Plan Card ── */}
        <div className="bg-white rounded-xl border border-primary/20 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">What&apos;s included</h2>
            </div>
            <span className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
              {sub?.locationCount ?? 1} location{(sub?.locationCount ?? 1) > 1 ? 's' : ''}
            </span>
          </div>
          <ul className="space-y-2">
            {PLAN_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={14} className="text-primary shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* ── Payment Method ── */}
        {sub?.stripeCustomerId && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">Payment Method</h2>
              </div>
              <button
                onClick={() => void openPortal()}
                className="text-xs text-primary font-medium hover:underline"
              >
                Update
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Payment details managed via Stripe Customer Portal.
            </p>
          </div>
        )}

        {/* ── Invoice History ── */}
        {invoices?.invoices && invoices.invoices.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Invoice History</h2>
            <div className="space-y-2">
              {invoices.invoices.slice(0, 6).map((inv: Invoice) => (
                <div key={inv.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm text-gray-800">{inv.number ?? 'Invoice'}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(inv.created * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-800">
                      {fmtCurrency(inv.amountPaid)}
                    </span>
                    {inv.invoicePdf && (
                      <a
                        href={inv.invoicePdf}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary-dark"
                        aria-label="Download invoice"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Usage Stats ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <RefreshCw size={14} className="text-gray-400" />
            Usage
          </h2>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Locations</span>
              <span className="font-medium text-gray-900">{sub?.locationCount ?? 1}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Team members</span>
              <span className="text-green-600 font-medium flex items-center gap-1">
                <CheckCircle size={12} /> Unlimited
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
