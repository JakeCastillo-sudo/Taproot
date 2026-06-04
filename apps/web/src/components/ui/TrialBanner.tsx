import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { apiFetch } from '../../lib/api';

const DISMISS_KEY = 'taproot_trial_banner_dismissed_session';

interface SubscriptionStatus {
  isTrialing:    boolean;
  daysRemaining: number;
  status:        string;
}

async function fetchSubscriptionStatus(): Promise<SubscriptionStatus | null> {
  try {
    // noRedirect: true — billing check is optional; a 401 here must not force
    // the user to /login (e.g. right after demo login before subscription resolves)
    const data = await apiFetch<SubscriptionStatus>(
      '/api/v1/billing/subscription', {}, true, { noRedirect: true },
    );
    return data;
  } catch {
    return null;
  }
}

export function TrialBanner() {
  const navigate  = useNavigate();
  const [status,  setStatus]  = useState<SubscriptionStatus | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already dismissed this session
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    fetchSubscriptionStatus().then((s) => {
      if (s?.isTrialing) {
        setStatus(s);
        setVisible(true);
      }
    });
  }, []);

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(DISMISS_KEY, '1');
  };

  if (!visible || !status) return null;

  const urgent    = status.daysRemaining <= 3;
  const critical  = status.daysRemaining <= 1;
  const dayLabel  = status.daysRemaining === 1 ? 'day' : 'days';

  return (
    <div
      className={clsx(
        'flex items-center justify-between px-4 py-2.5 text-sm font-medium',
        critical ? 'bg-red-600 text-white' :
        urgent   ? 'bg-orange-500 text-white' :
                   'bg-amber-400 text-amber-900',
      )}
      role="banner"
    >
      <div className="flex items-center gap-2">
        <Zap size={14} className="shrink-0" />
        <span>
          {critical
            ? `⚠️ Your free trial ends tomorrow!`
            : urgent
            ? `Your trial ends in ${status.daysRemaining} ${dayLabel} — don't lose access`
            : `14-day free trial — ${status.daysRemaining} ${dayLabel} remaining`
          }
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/billing')}
          className={clsx(
            'px-3 py-1 rounded-md text-xs font-semibold transition-colors',
            critical || urgent
              ? 'bg-white/20 hover:bg-white/30 text-white'
              : 'bg-amber-900/15 hover:bg-amber-900/25 text-amber-900',
          )}
        >
          Upgrade Now
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss trial banner"
          className={clsx(
            'p-1 rounded hover:bg-black/10 transition-colors',
            critical || urgent ? 'text-white/80' : 'text-amber-900/60',
          )}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
