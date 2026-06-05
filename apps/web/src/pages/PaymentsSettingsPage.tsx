/**
 * PaymentsSettingsPage — /settings/payments
 *
 * Stripe Connect status + onboarding, payment-method toggles, and processing-fee
 * display. Cash is always enabled; card/wallet methods require a connected Stripe
 * account.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, CreditCard, ExternalLink, Banknote } from 'lucide-react';
import { clsx } from 'clsx';
import { settings as settingsApi, stripeConnect } from '../lib/api';
import { getStoredUser } from '../lib/session';
import { showToast } from '../components/ui/Toast';

const METHODS: Array<{ key: string; label: string; requiresStripe: boolean; alwaysOn?: boolean }> = [
  { key: 'cash',           label: 'Cash',              requiresStripe: false, alwaysOn: true },
  { key: 'card',           label: 'Credit / Debit card', requiresStripe: true },
  { key: 'apple_pay',      label: 'Apple Pay',         requiresStripe: true },
  { key: 'google_pay',     label: 'Google Pay',        requiresStripe: true },
  { key: 'gift_card',      label: 'Gift cards',        requiresStripe: false },
  { key: 'account_credit', label: 'Account credit',    requiresStripe: false },
];

export function PaymentsSettingsPage() {
  const qc = useQueryClient();

  const { data: connect, isLoading: loadingConnect } = useQuery({
    queryKey: ['stripe', 'connect-status'],
    queryFn:  () => stripeConnect.status(),
    staleTime: 60_000,
  });

  const { data: payCfg } = useQuery({
    queryKey: ['settings', 'payments'],
    queryFn:  () => settingsApi.getPayments(),
  });

  const [methods, setMethods] = useState<Record<string, boolean>>({});
  useEffect(() => { if (payCfg) setMethods(payCfg.paymentMethods); }, [payCfg]);

  const connected = Boolean(connect?.chargesEnabled);
  const hasAccount = Boolean(connect?.accountId);

  const saveMethods = useMutation({
    mutationFn: (m: Record<string, boolean>) => settingsApi.savePayments(m),
    onSuccess: () => { showToast.success('Payment methods saved'); void qc.invalidateQueries({ queryKey: ['settings', 'payments'] }); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Save failed'),
  });

  const startConnect = useMutation({
    mutationFn: () => {
      const user = getStoredUser();
      return stripeConnect.start({ businessType: 'company', email: user?.email ?? '', country: 'US' });
    },
    onSuccess: (res) => { window.location.assign(res.onboardingUrl); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Could not start Stripe onboarding'),
  });

  const refreshLink = useMutation({
    mutationFn: () => stripeConnect.refreshLink(),
    onSuccess: (res) => { window.location.assign(res.onboardingUrl); },
    onError: (e: unknown) => showToast.error(e instanceof Error ? e.message : 'Could not open Stripe'),
  });

  const toggle = (key: string) => {
    const next = { ...methods, [key]: !methods[key], cash: true };
    setMethods(next);
    saveMethods.mutate(next);
  };

  const maskedAccount = connect?.accountId
    ? `${connect.accountId.slice(0, 8)}…${connect.accountId.slice(-4)}`
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 md:px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Payments</h1>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6 max-w-2xl">
        {/* Stripe Connect */}
        <section className="border border-gray-100 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900">Stripe Connect</h2>
            {loadingConnect ? (
              <span className="text-xs text-gray-400">Checking…</span>
            ) : connected ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600"><CheckCircle2 size={15} /> Connected</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-400"><XCircle size={15} /> Not connected</span>
            )}
          </div>

          {connected ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Account</span><span className="font-mono text-gray-700">{maskedAccount}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Payouts</span><span className={connect?.payoutsEnabled ? 'text-green-600' : 'text-amber-600'}>{connect?.payoutsEnabled ? 'Enabled' : 'Pending'}</span></div>
              <button onClick={() => refreshLink.mutate()} disabled={refreshLink.isPending}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                Manage on Stripe <ExternalLink size={12} />
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 mb-2">Connect Stripe to accept cards, Apple Pay, and Google Pay.</p>
              <ul className="text-xs text-gray-400 mb-3 space-y-0.5 list-disc list-inside">
                <li>Accept cards, Apple Pay &amp; Google Pay</li>
                <li>Fast payouts to your bank</li>
                <li>PCI-compliant — no card data touches your servers</li>
              </ul>
              {hasAccount && connect?.requiresInformation && (
                <p className="text-xs text-amber-600 mb-2">Stripe needs more information to finish onboarding.</p>
              )}
              <button
                onClick={() => (hasAccount ? refreshLink.mutate() : startConnect.mutate())}
                disabled={startConnect.isPending || refreshLink.isPending}
                className="px-4 py-2 bg-[#635BFF] text-white text-sm font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-50">
                {hasAccount ? 'Finish Stripe onboarding' : 'Connect Stripe'}
              </button>
            </div>
          )}
        </section>

        {/* Payment methods */}
        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Payment methods</h2>
          <div className="space-y-2">
            {METHODS.map((m) => {
              const disabled = m.alwaysOn || (m.requiresStripe && !connected);
              const on = m.alwaysOn ? true : Boolean(methods[m.key]);
              return (
                <div key={m.key} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    {m.key === 'cash' ? <Banknote size={16} className="text-gray-400" /> : <CreditCard size={16} className="text-gray-400" />}
                    <span className="text-sm text-gray-700">{m.label}</span>
                    {m.requiresStripe && !connected && <span className="text-[11px] text-gray-400">(requires Stripe)</span>}
                  </div>
                  <button
                    onClick={() => !disabled && toggle(m.key)}
                    disabled={disabled}
                    className={clsx('relative w-10 h-6 rounded-full transition-colors',
                      on ? 'bg-primary' : 'bg-gray-200', disabled && 'opacity-50 cursor-not-allowed')}
                  >
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', on && 'translate-x-4')} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Fees */}
        <section className="border border-gray-100 rounded-lg p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Processing fees</h2>
          <p className="text-sm text-gray-600">Stripe charges <strong>2.7% + $0.05</strong> per in-person transaction.</p>
          <p className="text-sm text-gray-500 mt-1">On a $100 sale, you keep <strong className="text-gray-900">$97.25</strong>.</p>
          <p className="text-xs text-gray-400 mt-3">Payout schedule and bank account are managed in your Stripe dashboard.</p>
        </section>
      </div>
    </div>
  );
}
