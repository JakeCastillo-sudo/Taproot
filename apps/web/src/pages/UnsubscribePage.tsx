import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Leaf, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * UnsubscribePage — public (no auth) at /unsubscribe?token=…
 * Verifies the HMAC token, confirms intent, then records the opt-out. Uses raw
 * fetch (recipient has no session); endpoints are public.
 */
const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;
const SUPPORT_EMAIL = 'support@taproot-pos.com';

export function UnsubscribePage() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [verifying, setVerifying] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { if (!cancelled) { setEmail(null); setVerifying(false); } return; }
      try {
        const res = await fetch(`${BASE}/unsubscribe/verify?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as { valid: boolean; email?: string };
        if (!cancelled) setEmail(data.valid ? data.email ?? null : null);
      } catch {
        if (!cancelled) setEmail(null);
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleUnsubscribe = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { success?: boolean }).success) {
        throw new Error((data as { error?: string }).error ?? 'Could not unsubscribe.');
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="h-screen overflow-y-auto bg-white flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary shadow-md mb-4">
            <Leaf size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Taproot POS</h1>
        </div>
        {children}
      </div>
    </div>
  );

  if (verifying) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
          <Loader2 size={18} className="animate-spin" /> Checking your link…
        </div>
      </Shell>
    );
  }

  if (!email) {
    return (
      <Shell>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 text-center">
          <AlertCircle size={22} className="text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-amber-800">This unsubscribe link is invalid or expired.</p>
          <p className="text-xs text-amber-700 mt-1">
            Email <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a> if you need help.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-6 text-center">
          <CheckCircle2 size={28} className="text-primary mx-auto mb-2" />
          <p className="text-base font-semibold text-gray-900">You've been unsubscribed.</p>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">
            You'll still receive important account emails (receipts, password resets, security alerts)
            but no more marketing or tips emails.
          </p>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          Changed your mind?{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary font-semibold hover:underline">Email us →</a>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="text-xl font-bold text-gray-900 text-center">Unsubscribe from Taproot marketing emails?</h2>
      <p className="text-sm text-gray-500 mt-2 text-center">
        For <span className="font-medium text-gray-700">{email}</span>
      </p>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mt-5">
          <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700 leading-snug">{error}</p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        <button
          onClick={() => void handleUnsubscribe()}
          disabled={submitting}
          className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          {submitting ? 'Unsubscribing…' : 'Yes, unsubscribe'}
        </button>
        <button
          onClick={() => navigate('/login', { replace: true })}
          className="w-full h-11 flex items-center justify-center border border-gray-200 text-gray-700 rounded-md text-sm font-semibold hover:bg-gray-50 transition-colors"
        >
          No, keep me subscribed
        </button>
      </div>

      <p className="text-center text-xs text-gray-400 mt-6">
        Account emails (receipts, password resets, security alerts) are always sent regardless.
      </p>
      <p className="text-center text-xs text-gray-400 mt-3">
        <Link to="/" className="hover:underline">← Back to home</Link>
      </p>
    </Shell>
  );
}

export default UnsubscribePage;
