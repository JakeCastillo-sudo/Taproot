/**
 * AdminAccountPage — /admin/account
 *
 * Self-service "change password" for the signed-in admin. Calls
 * POST /api/v1/admin/auth/change-password (requires current password, new ≥ 10).
 * The backend revokes ALL of this admin's sessions on success, so after a change
 * we clear local admin auth and send them back to /admin/login.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, KeyRound, Check, AlertCircle } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { useAdminAuthStore } from '../../store/adminAuth.store';

export function AdminAccountPage() {
  const navigate = useNavigate();
  const { adminUser, clearAdminAuth } = useAdminAuthStore();

  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const tooShort      = next.length > 0 && next.length < 10;
  const mismatch      = confirm.length > 0 && next !== confirm;
  const sameAsCurrent = next.length > 0 && current.length > 0 && next === current;
  const canSubmit =
    !!current && next.length >= 10 && next === confirm && next !== current && !loading;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setLoading(true);
    try {
      await adminApi.auth.changePassword(current, next);
      setDone(true);
      // Backend revoked every session — force a fresh sign-in with the new password.
      setTimeout(() => {
        clearAdminAuth();
        navigate('/admin/login', { replace: true });
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-colors';

  if (done) {
    return (
      <div className="p-6 sm:p-10 max-w-md mx-auto">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Check size={26} className="text-primary" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Password changed</h1>
          <p className="text-sm text-gray-500 mt-1">
            All sessions were signed out for security. Redirecting you to sign in…
          </p>
          <Loader2 size={18} className="animate-spin text-primary mx-auto mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10 max-w-md mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
          <KeyRound size={16} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Account security</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Signed in as {adminUser?.email ?? '—'}. Change your admin password below.
      </p>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Change password</h2>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3 mb-5">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-red-700 leading-snug">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'} value={current} autoComplete="current-password"
                onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" className={inputCls}
              />
              <button type="button" onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={show ? 'Hide passwords' : 'Show passwords'}>
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* New */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
            <input
              type={show ? 'text' : 'password'} value={next} autoComplete="new-password"
              onChange={(e) => setNext(e.target.value)} placeholder="At least 10 characters"
              className={inputCls.replace(' pr-10', '')}
            />
            {tooShort && <p className="text-xs text-red-500 mt-1">Must be at least 10 characters.</p>}
            {sameAsCurrent && <p className="text-xs text-red-500 mt-1">Must be different from your current password.</p>}
          </div>

          {/* Confirm */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
            <input
              type={show ? 'text' : 'password'} value={confirm} autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter new password"
              className={inputCls.replace(' pr-10', '')}
            />
            {mismatch && <p className="text-xs text-red-500 mt-1">Passwords don't match.</p>}
          </div>

          <button
            type="submit" disabled={!canSubmit}
            className="w-full h-11 flex items-center justify-center gap-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading ? 'Changing…' : 'Change password'}
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-4">
          Changing your password signs out all admin sessions — you'll sign in again with the new one.
        </p>
      </div>
    </div>
  );
}

export default AdminAccountPage;
