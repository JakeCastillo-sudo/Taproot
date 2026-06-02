import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import {
  CheckCircle, ArrowLeft, Loader2, Shield, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { apiFetch } from '../lib/api';
import { analytics } from '../lib/analytics';

// ─── Stripe setup ─────────────────────────────────────────────────────────────

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '');

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize:        '14px',
      color:           '#1f2937',
      fontFamily:      'Inter, system-ui, sans-serif',
      '::placeholder': { color: '#9ca3af' },
    },
    invalid: { color: '#ef4444' },
  },
};

// ─── Plan features ────────────────────────────────────────────────────────────

const FEATURES = [
  'Unlimited orders & payments',
  'AI menu import & migration',
  'Recipe costing & inventory',
  'Customer loyalty & gift cards',
  'Analytics & reporting',
  'Unlimited team members',
  'PWA — works on any device',
  'Email & chat support',
];

// ─── Inner form (must be inside <Elements>) ───────────────────────────────────

function UpgradeForm() {
  const stripe   = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError(null);
    setLoading(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      // Create a payment method from the card details
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (pmError) {
        setError(pmError.message ?? 'Card error');
        return;
      }

      // Start subscription on backend
      await apiFetch('/api/v1/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({ paymentMethodId: paymentMethod.id }),
      });

      analytics.subscriptionStarted();
      setSuccess(true);

      // Redirect to app after short delay
      setTimeout(() => navigate('/'), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center py-10 animate-scale-in">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <CheckCircle size={32} className="text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">You&apos;re all set!</h2>
        <p className="text-sm text-gray-500">Subscription activated — redirecting you to the app…</p>
        <Loader2 size={18} className="animate-spin text-primary mt-4" />
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
      {/* Card input */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Card details
        </label>
        <div className="border border-gray-200 rounded-lg px-3 py-3 bg-gray-50 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/60 transition-all">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <X size={14} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!stripe || loading}
        className={clsx(
          'w-full h-12 flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all',
          'bg-primary text-white hover:bg-primary-dark active:scale-[0.98]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Processing…</>
          : 'Start Subscription — $199/mo'}
      </button>

      {/* Trust signals */}
      <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <Shield size={11} className="text-gray-400" />
          Secured by Stripe
        </span>
        <span>·</span>
        <span>Cancel anytime</span>
        <span>·</span>
        <span>No contracts</span>
      </div>
    </form>
  );
}

// ─── UpgradePage ──────────────────────────────────────────────────────────────

export function UpgradePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-2">
      <div className="max-w-xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 text-gray-500 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Upgrade to Taproot</h1>
            <p className="text-sm text-gray-400">Your trial has ended — subscribe to continue</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Plan card */}
          <div className="bg-white rounded-xl border border-primary/20 shadow-sm p-5">
            <div className="mb-4">
              <h2 className="text-base font-bold text-gray-900">Taproot Starter</h2>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-extrabold text-gray-900">$199</span>
                <span className="text-sm text-gray-400">/ month per location</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Billed monthly · Cancel anytime</p>
            </div>

            <ul className="space-y-2">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle size={13} className="text-primary shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <Shield size={11} className="text-green-600" />
                30-day money-back guarantee
              </p>
            </div>
          </div>

          {/* Payment form */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Payment details</h2>
            <Elements stripe={stripePromise}>
              <UpgradeForm />
            </Elements>
          </div>
        </div>

        {/* Support note */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Questions?{' '}
          <a
            href="mailto:support@taprootpos.com"
            className="text-primary hover:underline"
          >
            support@taprootpos.com
          </a>
        </p>

      </div>
    </div>
  );
}
