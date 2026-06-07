import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Loader2, AlertCircle, Leaf } from 'lucide-react';
import { auth, TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY, products as productsApi } from '../lib/api';
import { queryClient } from '../lib/queryClient';
import { analytics } from '../lib/analytics';

/**
 * LoginPage — split-screen sign-in (S10-02 polish).
 * Left: dark-green branding panel (desktop only). Right: sign-in form.
 * All auth logic preserved from the prior version.
 */
export function LoginPage() {
  const navigate = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await auth.login(email.trim(), password);

      if (data.requiresMfa) {
        // TODO: MFA step — redirect to /login/mfa
        setError('MFA required — not yet supported in this UI.');
        return;
      }

      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(data.employee));

      // Analytics: sign-in event (S10-04)
      analytics.login();

      // Flush React Query cache so POSLayout fetches fresh data with the new token
      queryClient.clear();

      // Self-heal: if this account already has products (e.g. demo / existing org),
      // mark onboarding complete so no wizard redirect fires after login.
      try {
        const { total } = await productsApi.list({ perPage: 1 });
        if (total >= 5) {
          const { useOnboardingStore } = await import('../store/onboarding.store');
          useOnboardingStore.getState().completeOnboarding();
        }
      } catch {
        // Non-fatal — don't block navigation on products check failure
      }

      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-white md:flex">

      {/* ── Left: branding panel (desktop) ── */}
      <div className="hidden md:flex md:w-1/2 bg-primary text-white flex-col justify-between p-12">
        <Link to="/" className="inline-flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/15">
            <Leaf size={20} className="text-white" />
          </span>
          <span className="text-xl font-bold">Taproot</span>
        </Link>

        <div>
          <h2 className="text-3xl font-extrabold leading-tight">
            The POS built for independent restaurants
          </h2>
          <ul className="mt-8 space-y-3 text-white/90">
            <li className="flex items-center gap-2.5">🌿 <span>No contracts</span></li>
            <li className="flex items-center gap-2.5">💳 <span>$99/month flat</span></li>
            <li className="flex items-center gap-2.5">⚡ <span>Setup in 10 minutes</span></li>
          </ul>
        </div>

        <blockquote className="text-white/90 italic border-l-2 border-white/30 pl-4">
          "Finally a POS that treats me like my business matters."
          <footer className="text-sm text-white/70 not-italic mt-2">— Restaurant owner</footer>
        </blockquote>
      </div>

      {/* ── Right: form ── */}
      <div className="md:w-1/2 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="md:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary shadow-md mb-4">
              <Leaf size={26} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Taproot POS</h1>
          </div>

          <h1 className="text-2xl font-bold text-gray-900">Sign in to your account</h1>
          <p className="text-sm text-gray-400 mt-1 mb-6">Welcome back.</p>

          {error && (
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-5 animate-fade-in">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm font-medium text-red-700 leading-snug">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-600 mb-1">Email address</label>
              <input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-xs font-medium text-gray-600">Password</label>
                <a href="mailto:support@taproot-pos.com?subject=Password%20reset" className="text-xs text-primary hover:underline">Forgot password?</a>
              </div>
              <div className="relative">
                <input
                  id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* Demo credentials */}
          <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-3">
            <p className="text-xs text-gray-400 text-center mb-2">Demo credentials</p>
            <div className="text-xs text-gray-600 font-mono space-y-0.5 text-center">
              <div>demo@taproot.pos</div>
              <div>TaprootDemo2026!</div>
            </div>
            <button
              type="button"
              onClick={() => { setEmail('demo@taproot.pos'); setPassword('TaprootDemo2026!'); }}
              className="w-full mt-2 text-xs font-medium text-primary hover:text-primary-dark transition-colors"
            >
              Fill demo credentials
            </button>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-primary font-semibold hover:underline">Start your free trial →</Link>
          </p>

          <p className="text-center text-xs text-gray-400 mt-4">
            © {new Date().getFullYear()} Taproot POS ·{' '}
            <Link to="/privacy" className="hover:underline">Privacy</Link>{' '}·{' '}
            <Link to="/terms" className="hover:underline">Terms</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
