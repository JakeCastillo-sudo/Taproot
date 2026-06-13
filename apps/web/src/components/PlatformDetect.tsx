/**
 * PlatformDetect — surfaces the right "get the app" call-to-action for the
 * visitor's device. Three variants:
 *
 *   banner  — sticky bar (mobile/tablet only); auto-dismisses for 7 days.
 *   card    — bordered card with icon + primary download + "use in browser".
 *   inline  — a single text link ("Download the app for [platform] →").
 *
 * URL + label maps are exported so DownloadPage reuses the same source of truth.
 */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePlatform, type PlatformOS, type PlatformRecommendation } from '../hooks/usePlatform';

// Flip to true once the native apps are live in the stores.
export const APP_STORE_LIVE = false;
export const PLAY_STORE_LIVE = false;

export const STORE_URLS: Record<PlatformRecommendation, string> = {
  'app-store':   'https://apps.apple.com/app/taproot-pos/id000000000',
  'play-store':  'https://play.google.com/store/apps/details?id=com.taproot.pos',
  'desktop-mac': 'https://taproot-pos.com/download/mac',
  'desktop-win': 'https://taproot-pos.com/download/win',
  'web-browser': 'https://taproot-pos.com/login',
};

export const STORE_LABELS: Record<PlatformRecommendation, string> = {
  'app-store':   'Download on the App Store',
  'play-store':  'Get it on Google Play',
  'desktop-mac': 'Download for Mac',
  'desktop-win': 'Download for Windows',
  'web-browser': 'Use in Browser',
};

export const PLATFORM_LABELS: Record<PlatformOS, string> = {
  ios:     'iPhone & iPad',
  android: 'Android',
  macos:   'Mac',
  windows: 'Windows',
  linux:   'Linux',
  unknown: 'your device',
};

const BANNER_DISMISS_KEY = 'taproot_platform_banner_dismissed';
const BANNER_DISMISS_DAYS = 7;

/** A store/download channel that isn't live yet shows "Coming soon" instead of a link. */
function isComingSoon(rec: PlatformRecommendation): boolean {
  if (rec === 'app-store') return !APP_STORE_LIVE;
  if (rec === 'play-store') return !PLAY_STORE_LIVE;
  return false;
}

// Inline green "T" lettermark — no asset fetch.
function AppIcon({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-primary text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      T
    </span>
  );
}

interface PlatformDetectProps {
  variant: 'banner' | 'card' | 'inline';
  /** card only: also show the "or use in browser" fallback (default true). */
  showAll?: boolean;
}

export function PlatformDetect({ variant, showAll = true }: PlatformDetectProps) {
  const platform = usePlatform();
  const { os, recommendation, isMobile, isTablet, isTauri, isPWA } = platform;

  const url = STORE_URLS[recommendation];
  const label = STORE_LABELS[recommendation];
  const platformName = PLATFORM_LABELS[os];
  const comingSoon = isComingSoon(recommendation);

  // ─── Banner ──────────────────────────────────────────────────────────────
  const [bannerVisible, setBannerVisible] = useState(false);
  useEffect(() => {
    if (variant !== 'banner') return;
    if (isTauri || isPWA) return;            // already in the app
    if (!isMobile && !isTablet) return;      // desktop: silent
    try {
      const until = localStorage.getItem(BANNER_DISMISS_KEY);
      if (until && Date.now() < Number(until)) return;
    } catch {
      /* localStorage unavailable — show anyway */
    }
    setBannerVisible(true);
  }, [variant, isTauri, isPWA, isMobile, isTablet]);

  const dismissBanner = () => {
    setBannerVisible(false);
    try {
      localStorage.setItem(
        BANNER_DISMISS_KEY,
        String(Date.now() + BANNER_DISMISS_DAYS * 24 * 60 * 60 * 1000),
      );
    } catch {
      /* non-fatal */
    }
  };

  if (variant === 'banner') {
    if (!bannerVisible) return null;
    return (
      <div className="sticky top-0 z-[60] bg-primary text-white">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3">
          <p className="flex-1 text-sm font-medium leading-snug">
            {comingSoon
              ? `Taproot POS for ${platformName} is coming soon.`
              : `Taproot POS is available for ${platformName}.`}
          </p>
          {comingSoon ? (
            <span className="shrink-0 text-xs font-semibold bg-white/20 rounded-md px-2.5 py-1.5">
              Coming soon
            </span>
          ) : (
            <a
              href={url}
              className="shrink-0 inline-flex items-center gap-1.5 bg-white text-primary-dark text-xs font-semibold rounded-md px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Download size={13} /> {label}
            </a>
          )}
          <button
            onClick={dismissBanner}
            className="shrink-0 p-1 rounded-full hover:bg-white/15 transition-colors"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ─── Inline ──────────────────────────────────────────────────────────────
  if (variant === 'inline') {
    if (comingSoon) {
      return (
        <span className="text-sm text-gray-400">
          Taproot for {platformName} — coming soon
        </span>
      );
    }
    return (
      <a href={url} className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1">
        Download the app for {platformName} →
      </a>
    );
  }

  // ─── Card ────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border-2 border-primary/60 shadow-sm p-6 flex flex-col items-start gap-4">
      <div className="flex items-center gap-3">
        <AppIcon size={48} />
        <div>
          <p className="text-base font-bold text-gray-900">Taproot POS for {platformName}</p>
          <p className="text-sm text-gray-500">Recommended for your device</p>
        </div>
      </div>
      {comingSoon ? (
        <span className="inline-flex items-center text-sm font-semibold text-gray-500 bg-gray-100 rounded-lg px-4 py-2.5">
          Coming soon
        </span>
      ) : (
        <a
          href={url}
          className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-dark text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition-colors"
        >
          <Download size={16} /> {label}
        </a>
      )}
      {showAll && recommendation !== 'web-browser' && (
        <a href="/login" className="text-sm text-primary hover:underline">
          or use in browser →
        </a>
      )}
    </div>
  );
}

export default PlatformDetect;
