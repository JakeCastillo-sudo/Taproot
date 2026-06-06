import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Check, X, Loader2, AlertCircle, Leaf } from 'lucide-react';
import { clsx } from 'clsx';
import { apiFetch, TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY, clearTokens } from '../lib/api';
import { analytics } from '../lib/analytics';

// ─── Types ────────────────────────────────────────────────────────────────────

type BusinessType = 'restaurant' | 'cafe' | 'bar' | 'retail' | 'food_truck' | 'other';
type ReferralSource = 'legalzoom' | 'google' | 'reddit' | 'facebook' | 'referral' | 'review_site' | 'other';

const BUSINESS_TYPES: { value: BusinessType; label: string; emoji: string }[] = [
  { value: 'restaurant', label: 'Restaurant',  emoji: '🍽️' },
  { value: 'cafe',       label: 'Café',        emoji: '☕' },
  { value: 'bar',        label: 'Bar',         emoji: '🍺' },
  { value: 'food_truck', label: 'Food Truck',  emoji: '🚚' },
  { value: 'retail',     label: 'Retail',      emoji: '🛍️' },
  { value: 'other',      label: 'Other',       emoji: '📦' },
];

// ─── Password strength ────────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 10)          score++;
  if (pw.length >= 14)          score++;
  if (/[A-Z]/.test(pw))         score++;
  if (/[0-9]/.test(pw))         score++;
  if (/[^A-Za-z0-9]/.test(pw))  score++;

  if (score <= 1) return { score, label: 'Weak',   color: 'bg-red-400' };
  if (score <= 2) return { score, label: 'Fair',   color: 'bg-orange-400' };
  if (score <= 3) return { score, label: 'Good',   color: 'bg-yellow-400' };
  return                  { score, label: 'Strong', color: 'bg-green-500' };
}

// ─── RegisterPage ─────────────────────────────────────────────────────────────

export function RegisterPage() {
  const navigate       = useNavigate();
  const [params]       = useSearchParams();
  const ref            = params.get('ref');
  const partnerCode    = params.get('code') ?? '';
  const isLegalZoom    = ref === 'legalzoom';
  const trialDays      = isLegalZoom ? 30 : 14;

  const [step,         setStep]         = useState(1);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [checkingEmail,  setCheckingEmail]  = useState(false);

  // Form state
  const [firstName,     setFirstName]     = useState('');
  const [lastName,      setLastName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [showPw,        setShowPw]        = useState(false);
  const [businessName,  setBusinessName]  = useState('');
  const [businessType,  setBusinessType]  = useState<BusinessType | ''>('');
  const [phone,         setPhone]         = useState('');
  const [referralSource, setReferralSource] = useState<ReferralSource | ''>(
    isLegalZoom ? 'legalzoom' : '',
  );
  const [partnerCodeInput, setPartnerCodeInput] = useState(partnerCode);

  const pwStrength = passwordStrength(password);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  // On mount: if a valid token exists → user is already logged in → go to home.
  // If an expired/invalid token exists → clear it silently so the email-check
  // apiFetch won't send the bad header and trigger a redirect to /login.
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(atob(payloadB64)) as { exp?: number };
      if (typeof payload.exp === 'number' && payload.exp * 1000 > Date.now()) {
        // Token is still valid — this user is already authenticated
        navigate('/', { replace: true });
      } else {
        // Expired token — wipe silently and let registration proceed
        clearTokens();
      }
    } catch {
      // Malformed / non-JWT token — clear it
      clearTokens();
    }
  }, [navigate]);

  // ── Email availability check (debounced 500ms) ─────────────────────────────
  useEffect(() => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailAvailable(null);
      return;
    }
    setCheckingEmail(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ available: boolean }>(
          // apiFetch already prepends BASE (".../api/v1") — path must be BASE-relative.
          // Passing the full "/api/v1/..." here double-prefixes the URL → 404 →
          // emailAvailable stays null → the "Continue" button never enables.
          '/register/check-email',
          { method: 'POST', body: JSON.stringify({ email }) },
        );
        setEmailAvailable(res.available);
      } catch {
        setEmailAvailable(null);
      } finally {
        setCheckingEmail(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [email]);

  const step1Valid = firstName.trim() && lastName.trim() && email &&
    emailAvailable === true && password.length >= 10;

  const step2Valid = businessName.trim() && businessType;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!step1Valid || !step2Valid) return;
    setError(null);
    setLoading(true);
    setStep(3);

    try {
      const data = await apiFetch<{
        accessToken:  string;
        refreshToken: string;
        employee: {
          id: string; email: string; firstName: string; lastName: string;
          role: string; orgId: string; locationIds: string[]; permissions: string[];
        };
        org:      { id: string; name: string; slug: string };
        location: { id: string };
        trialDays: number;
      }>('/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName, lastName, email, password, businessName, businessType,
          phone:         phone           || undefined,
          referralSource:referralSource  || undefined,
          partnerCode:   partnerCodeInput.trim() || undefined,
        }),
      });

      // Store tokens + user
      localStorage.setItem(TOKEN_KEY,         data.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      localStorage.setItem(USER_KEY,          JSON.stringify(data.employee));

      // Update onboarding store with business info
      try {
        const { useOnboardingStore } = await import('../store/onboarding.store');
        useOnboardingStore.getState().updateBusinessInfo({
          name: businessName,
          type: businessType,
        });
      } catch { /* non-blocking */ }

      // Analytics
      analytics.trialStarted(referralSource || undefined);

      // Brief loading delay for animation effect
      await new Promise((r) => setTimeout(r, 1200));
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
      setStep(2);
    } finally {
      setLoading(false);
    }
  }, [step1Valid, step2Valid, firstName, lastName, email, password, businessName,
      businessType, phone, referralSource, partnerCodeInput, navigate]);

  return (
    // m-auto (not items-center/justify-center) so the form centers when it fits but
    // the top stays reachable by scroll when it overflows on small screens.
    <div className="h-screen overflow-y-auto bg-surface-2 flex p-4">
      <div className="w-full max-w-md m-auto py-8">

        {/* LegalZoom welcome banner */}
        {isLegalZoom && (
          <div className="mb-4 flex items-center gap-2.5 px-4 py-3 bg-primary/10 border border-primary/20 rounded-xl text-sm text-primary-dark font-medium">
            <Leaf size={16} className="text-primary shrink-0" />
            Welcome from LegalZoom! You get an exclusive {trialDays}-day free trial.
          </div>
        )}

        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary shadow-md mb-4">
            <span className="text-white text-2xl font-bold">T</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="text-sm text-gray-400 mt-1">
            {trialDays}-day free trial · No credit card required
          </p>
        </div>

        {/* Step indicator */}
        {step < 3 && (
          <div className="flex items-center gap-2 mb-6">
            {[1, 2].map((s) => (
              <div key={s} className={clsx(
                'flex-1 h-1.5 rounded-full transition-colors',
                s <= step ? 'bg-primary' : 'bg-gray-200',
              )} />
            ))}
            <span className="text-xs text-gray-400 ml-1 shrink-0">Step {step} of 2</span>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-5">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          {/* ── Step 1: Account details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-1">Your account</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First name</label>
                  <input
                    type="text" value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Last name</label>
                  <input
                    type="text" value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Smith"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                  />
                </div>
              </div>

              {/* Email with availability check */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
                <div className="relative">
                  <input
                    type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setEmailAvailable(null); }}
                    placeholder="jane@restaurant.com"
                    className={clsx(
                      'w-full px-3 py-2.5 pr-9 text-sm border rounded-md bg-gray-50 focus:outline-none focus:ring-2 transition-colors',
                      emailAvailable === false
                        ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
                        : emailAvailable === true
                        ? 'border-green-300 focus:ring-green-200 focus:border-green-400'
                        : 'border-gray-200 focus:ring-primary/40 focus:border-primary/60',
                    )}
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {checkingEmail ? (
                      <Loader2 size={14} className="animate-spin text-gray-400" />
                    ) : emailAvailable === true ? (
                      <Check size={14} className="text-green-500" />
                    ) : emailAvailable === false ? (
                      <X size={14} className="text-red-500" />
                    ) : null}
                  </div>
                </div>
                {emailAvailable === false && (
                  <p className="text-xs text-red-500 mt-1">
                    This email is already registered. <Link to="/login" className="underline">Sign in?</Link>
                  </p>
                )}
              </div>

              {/* Password with strength meter */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 10 characters"
                    className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[1,2,3,4].map((i) => (
                        <div key={i} className={clsx(
                          'flex-1 h-1 rounded-full transition-colors',
                          i <= pwStrength.score ? pwStrength.color : 'bg-gray-200',
                        )} />
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">{pwStrength.label}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-2"
              >
                Continue →
              </button>

              <p className="text-center text-xs text-gray-400">
                Already have an account?{' '}
                <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
              </p>
            </div>
          )}

          {/* ── Step 2: Business details ── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-1">Your business</h2>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Business name</label>
                <input
                  type="text" value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="The Green Table"
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Business type</label>
                <div className="grid grid-cols-3 gap-2">
                  {BUSINESS_TYPES.map((bt) => (
                    <button
                      key={bt.value}
                      type="button"
                      onClick={() => setBusinessType(bt.value)}
                      className={clsx(
                        'flex flex-col items-center py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors',
                        businessType === bt.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300',
                      )}
                    >
                      <span className="text-lg mb-0.5">{bt.emoji}</span>
                      {bt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Phone number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
              </div>

              {!isLegalZoom && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    How did you hear about us? <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <select
                    value={referralSource}
                    onChange={(e) => setReferralSource(e.target.value as ReferralSource | '')}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                  >
                    <option value="">Select one…</option>
                    <option value="google">Google Search</option>
                    <option value="reddit">Reddit</option>
                    <option value="facebook">Facebook</option>
                    <option value="referral">A friend or colleague</option>
                    <option value="review_site">Review site (Capterra, G2…)</option>
                    <option value="legalzoom">LegalZoom</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              )}

              {/* Partner code (pre-filled from ?code= URL param) */}
              {partnerCodeInput && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-primary/5 border border-primary/20 rounded-md">
                  <Leaf size={14} className="text-primary shrink-0" />
                  <p className="text-xs text-primary font-medium">
                    Partner code <strong>{partnerCodeInput.toUpperCase()}</strong> applied
                  </p>
                </div>
              )}
              {!partnerCodeInput && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Partner code <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={partnerCodeInput}
                    onChange={(e) => setPartnerCodeInput(e.target.value.toUpperCase())}
                    placeholder="e.g. TAPROOT30"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors font-mono uppercase tracking-wider"
                  />
                </div>
              )}

              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => void handleSubmit()}
                  disabled={!step2Valid || loading}
                  className="flex-1 py-2.5 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  Create account
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4 animate-bounce-in">
                <Check size={28} className="text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">You&apos;re in!</h2>
              <p className="text-sm text-gray-400">Setting up your account…</p>
              <div className="mt-4 flex justify-center">
                <Loader2 size={20} className="animate-spin text-primary" />
              </div>
            </div>
          )}

        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          By creating an account you agree to our{' '}
          <Link to="/terms" className="text-primary hover:underline">Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
