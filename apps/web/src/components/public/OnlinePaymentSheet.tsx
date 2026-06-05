/**
 * OnlinePaymentSheet — Stripe Elements card payment for the public storefront.
 *
 * Only mounted when the restaurant has a connected Stripe account
 * (menu.online.paymentAvailable). Creates a PaymentIntent on the merchant's
 * connected account, renders the PaymentElement, confirms, then tells the server
 * to record the payment. Untestable on the demo org (no Connect) — degrades to
 * "pay at counter" upstream.
 */

import { useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { X } from 'lucide-react';
import { publicApi, type PublicOrderBody } from '../../lib/api';

interface Props {
  slug: string;
  body: PublicOrderBody;
  onClose: () => void;
  onSuccess: (orderNumber: string, estimatedMinutes: number) => void;
}

export function OnlinePaymentSheet({ slug, body, onClose, onSuccess }: Props) {
  const [intent, setIntent] = useState<{ clientSecret: string; orderId: string; orderNumber: string; amount: number } | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicApi.paymentIntent(slug, body)
      .then((r) => {
        if (cancelled) return;
        setIntent({ clientSecret: r.clientSecret, orderId: r.orderId, orderNumber: r.orderNumber, amount: r.amount });
        setStripePromise(loadStripe(r.publishableKey, { stripeAccount: r.connectedAccountId }));
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start payment'); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Pay {intent ? `$${(intent.amount / 100).toFixed(2)}` : ''}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100"><X size={16} className="text-gray-500" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          {error ? <p className="text-sm text-red-600">{error}</p>
            : !intent || !stripePromise ? <p className="text-sm text-gray-400">Loading payment…</p>
            : (
              <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret }}>
                <PayForm slug={slug} orderId={intent.orderId} orderNumber={intent.orderNumber}
                  estimatedMinutes={15} onSuccess={onSuccess} />
              </Elements>
            )}
        </div>
      </div>
    </div>
  );
}

function PayForm({ slug, orderId, orderNumber, estimatedMinutes, onSuccess }: {
  slug: string; orderId: string; orderNumber: string; estimatedMinutes: number;
  onSuccess: (orderNumber: string, estimatedMinutes: number) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) { setErr(error.message ?? 'Payment failed'); setBusy(false); return; }
    if (paymentIntent && paymentIntent.status === 'succeeded') {
      try {
        await publicApi.confirmPayment(slug, orderId, paymentIntent.id);
        onSuccess(orderNumber, estimatedMinutes);
      } catch (e) { setErr(e instanceof Error ? e.message : 'Could not confirm payment'); }
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <PaymentElement />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button onClick={submit} disabled={!stripe || busy}
        className="w-full h-12 bg-primary text-white rounded-md text-base font-bold hover:bg-primary-dark disabled:opacity-50">
        {busy ? 'Processing…' : 'Pay now'}
      </button>
    </div>
  );
}
