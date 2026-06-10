/**
 * Admin Portal login — /admin/login
 *
 * Separate from the org LoginPage: uses adminApi + adminAuth.store, and on
 * success lands on /admin/dashboard. No "forgot password" (internal tool —
 * a super_admin resets via the DB). 5 failed attempts → 15-min lockout
 * (enforced server-side; surfaced here via the 423 ACCOUNT_LOCKED message).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, Loader2 } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { useAdminAuthStore } from '../../store/adminAuth.store';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const setAdminAuth = useAdminAuthStore((s) => s.setAdminAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { accessToken, admin } = await adminApi.auth.login(email.trim(), password);
      setAdminAuth(admin, accessToken);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#111827] px-4">
      <div className="w-full max-w-[400px]">
        {/* Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-3">
            <span className="text-white text-xl font-bold">T</span>
          </div>
          <h1 className="text-white text-xl font-semibold">Taproot POS</h1>
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary-light bg-primary/15 px-2.5 py-1 rounded-full">
            <ShieldCheck size={13} /> Admin Portal
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-7">
          <h2 className="text-lg font-semibold text-gray-900">Sign in</h2>
          <p className="text-xs text-gray-400 mt-1">
            Internal use only. Authorized personnel only.
          </p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                placeholder="admin@taproot-pos.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              Sign in to Admin Portal
            </button>
          </form>

          <p className="text-[11px] text-gray-400 mt-5 leading-relaxed">
            No self-service password reset. Contact a super admin to reset your
            password. After 5 failed attempts the account is locked for 15 minutes.
          </p>
        </div>

        <p className="text-center text-[11px] text-gray-500 mt-5">
          Taproot internal tooling · Not affiliated with customer accounts
        </p>
      </div>
    </div>
  );
}
