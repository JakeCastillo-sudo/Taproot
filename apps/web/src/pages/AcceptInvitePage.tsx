import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, Leaf, CheckCircle2 } from 'lucide-react';

/**
 * AcceptInvitePage — public (no auth). Deep-link target for employee invite emails
 * (/accept-invite?token=…). Verifies the token, then lets the invitee set a
 * password (+ optional PIN). Uses raw fetch (not apiFetch) since the invitee has
 * no session and these endpoints are public.
 */
const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

interface VerifyResult {
  valid: boolean;
  reason?: string;
  employeeName?: string;
  restaurantName?: string;
  role?: string;
}

const REASON_TEXT: Record<string, string> = {
  missing_token: 'This invitation link is missing its token.',
  not_found: 'This invitation link is invalid.',
  already_used: 'This invitation has already been used.',
  expired: 'This invitation link has expired.',
};

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [verifying, setVerifying] = useState(true);
  const [info, setInfo] = useState<VerifyResult | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) { setInfo({ valid: false, reason: 'missing_token' }); setVerifying(false); }
        return;
      }
      try {
        const res = await fetch(`${BASE}/invite/verify?token=${encodeURIComponent(token)}`);
        const data = (await res.json()) as VerifyResult;
        if (!cancelled) setInfo(data);
      } catch {
        if (!cancelled) setInfo({ valid: false, reason: 'not_found' });
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 3000);
    return () => clearTimeout(t);
  }, [done, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (pin && !/^\d{4,6}$/.test(pin)) { setError('PIN must be 4–6 digits.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/invite/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, pin: pin || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? 'Could not set up your account.');
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
      <div className="w-full max-w-sm">
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
          <Loader2 size={18} className="animate-spin" /> Checking your invitation…
        </div>
      </Shell>
    );
  }

  if (!info?.valid) {
    return (
      <Shell>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-4 text-center">
          <AlertCircle size={22} className="text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-amber-800">
            {REASON_TEXT[info?.reason ?? 'not_found'] ?? 'This invitation link is invalid or has expired.'}
          </p>
          <p className="text-xs text-amber-700 mt-1">Contact your manager to request a new invite.</p>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="text-primary font-semibold hover:underline">Go to Login →</Link>
        </p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-6 text-center">
          <CheckCircle2 size={28} className="text-primary mx-auto mb-2" />
          <p className="text-base font-semibold text-gray-900">Your account is ready!</p>
          <p className="text-sm text-gray-600 mt-1">You can now sign in to Taproot POS.</p>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          Redirecting to sign in…{' '}
          <Link to="/login" className="text-primary font-semibold hover:underline">Go to Login Now →</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-gray-900 text-center">
        Welcome to {info.restaurantName}, {info.employeeName}!
      </h1>
      <p className="text-sm text-gray-400 mt-1 mb-6 text-center">
        You&apos;ve been invited as {info.role}. Set a password to finish.
      </p>

      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-5">
          <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700 leading-snug">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-xs font-medium text-gray-600 mb-1">New password</label>
          <div className="relative">
            <input
              id="password" type={showPw ? 'text' : 'password'} autoComplete="new-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
              className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
            />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm" className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
          <input
            id="confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="pin" className="block text-xs font-medium text-gray-600 mb-1">
            PIN <span className="text-gray-400">(optional — 4–6 digits, for POS login)</span>
          </label>
          <input
            id="pin" type="text" inputMode="numeric" pattern="\d*" maxLength={6}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 2468"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
          />
        </div>

        <button type="submit" disabled={submitting || !password || !confirm}
          className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
          {submitting ? 'Setting up…' : 'Set Up My Account →'}
        </button>
      </form>

      <p className="text-center text-xs text-gray-400 mt-6">
        © {new Date().getFullYear()} Taproot POS
      </p>
    </Shell>
  );
}

export default AcceptInvitePage;
