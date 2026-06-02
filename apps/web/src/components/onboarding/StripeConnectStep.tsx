/**
 * StripeConnectStep — Step 5 (optional)
 *
 * Explains Stripe, initiates Express onboarding, and polls for
 * account status every 5 seconds after the user returns from Stripe.
 */

import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Loader2, Check, ShieldCheck, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { apiFetch } from '../../lib/api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface StripeConnectStepProps {
  onComplete: () => void;
  onSkip:     () => void;
}

// ─── Stripe brand colours ──────────────────────────────────────────────────────

const STRIPE_BLUE = '#635BFF';

// ─── Card logos (SVG inline) ──────────────────────────────────────────────────

function CardLogos() {
  return (
    <div className="flex items-center gap-2">
      {/* Visa */}
      <div className="w-10 h-6 rounded border border-gray-200 bg-white flex items-center justify-center text-[10px] font-extrabold text-blue-800 tracking-tight">
        VISA
      </div>
      {/* Mastercard */}
      <div className="w-10 h-6 rounded border border-gray-200 bg-white flex items-center justify-center">
        <div className="relative w-5 h-3.5">
          <div className="absolute left-0 w-3.5 h-3.5 rounded-full bg-red-500 opacity-90" />
          <div className="absolute right-0 w-3.5 h-3.5 rounded-full bg-yellow-400 opacity-90" />
        </div>
      </div>
      {/* Amex */}
      <div className="w-10 h-6 rounded border border-gray-200 bg-[#2E77BC] flex items-center justify-center text-[9px] font-bold text-white tracking-tighter">
        AMEX
      </div>
      {/* Discover */}
      <div className="w-10 h-6 rounded border border-gray-200 bg-white flex items-center justify-center text-[9px] font-bold text-orange-500">
        DISC
      </div>
      <span className="text-xs text-gray-400">+ more</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'waiting' | 'connected' | 'error';

export function StripeConnectStep({ onComplete, onSkip }: StripeConnectStepProps) {
  const [status,   setStatus]   = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start polling when waiting for the user to return from Stripe
  useEffect(() => {
    if (status !== 'waiting') return;

    const startTs = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startTs > 10 * 60 * 1000) {
        clearInterval(pollRef.current!);
        // Don't error — just stay in waiting state; user can skip
        return;
      }
      try {
        const res = await apiFetch<{ status: string }>(
          '/api/v1/payments/connect/status',
        );
        if (res.status === 'active' || res.status === 'connected') {
          clearInterval(pollRef.current!);
          setStatus('connected');
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status]);

  const handleConnect = async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const res = await apiFetch<{ onboardingUrl: string }>(
        '/api/v1/payments/connect/account',
        { method: 'POST', body: JSON.stringify({ returnPath: '/onboarding' }) },
      );
      // Open Stripe in new tab and start polling
      window.open(res.onboardingUrl, '_blank', 'noopener');
      setStatus('waiting');
    } catch (err) {
      setStatus('error');
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not reach Stripe. Check your connection.',
      );
    }
  };

  // ── Connected state ─────────────────────────────────────────────────────────
  if (status === 'connected') {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4 animate-bounce-in">
          <Check size={28} className="text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Stripe connected!</h2>
        <p className="text-sm text-gray-500 mb-6">
          You can now accept card payments at checkout.
        </p>
        <button
          type="button"
          onClick={onComplete}
          className="w-full py-3 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors"
        >
          Continue →
        </button>
      </div>
    );
  }

  // ── Waiting state ───────────────────────────────────────────────────────────
  if (status === 'waiting') {
    return (
      <div className="text-center py-8">
        <Loader2 size={36} className="animate-spin mx-auto mb-4" style={{ color: STRIPE_BLUE }} />
        <h2 className="text-lg font-bold text-gray-900 mb-2">Waiting for Stripe…</h2>
        <p className="text-sm text-gray-500 mb-1">
          Finish your setup in the Stripe tab, then come back here.
        </p>
        <p className="text-xs text-gray-400 mb-6">We&apos;ll detect when it&apos;s done automatically.</p>
        <div className="w-48 h-1.5 bg-gray-100 rounded-full mx-auto overflow-hidden mb-6">
          <div className="h-full rounded-full animate-pulse" style={{ width: '50%', background: STRIPE_BLUE }} />
        </div>
        <button
          type="button"
          onClick={() => {
            clearInterval(pollRef.current!);
            setStatus('idle');
          }}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Not yet — go back
        </button>
        <div className="mt-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-gray-300 hover:text-gray-500 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ── Idle / error state ──────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">Accept card payments</h2>
      <p className="text-sm text-gray-500 mb-5">
        We use Stripe — the same payment platform trusted by Shopify and Amazon.
      </p>

      {/* Error */}
      {errorMsg && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">
          <p className="text-sm text-red-700">{errorMsg}</p>
        </div>
      )}

      {/* Card logos */}
      <div className="mb-5">
        <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
          Accepted cards
        </p>
        <CardLogos />
      </div>

      {/* Feature bullets */}
      <div className="space-y-2.5 mb-6">
        {[
          { icon: Zap,         text: 'Payouts as fast as next business day' },
          { icon: ShieldCheck, text: 'PCI-compliant — card data never touches our servers' },
          { icon: Check,       text: '2.9% + 30¢ per transaction. No hidden fees.' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Icon size={12} className="text-green-600" />
            </div>
            <p className="text-sm text-gray-700">{text}</p>
          </div>
        ))}
      </div>

      {/* Connect button — Stripe brand colour */}
      <button
        type="button"
        onClick={() => void handleConnect()}
        disabled={status === 'loading'}
        className={clsx(
          'w-full py-3 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2',
          'hover:opacity-90 active:scale-[0.99] disabled:opacity-60',
        )}
        style={{ background: STRIPE_BLUE }}
      >
        {status === 'loading' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ExternalLink size={16} />
        )}
        {status === 'loading' ? 'Opening Stripe…' : 'Connect with Stripe →'}
      </button>

      <p className="text-center text-xs text-gray-400 mt-2">
        Opens in a new tab · You can always do this later
      </p>

      <button
        type="button"
        onClick={onSkip}
        className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip for now — I&apos;ll connect payments later
      </button>
    </div>
  );
}
