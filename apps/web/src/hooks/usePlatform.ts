/**
 * usePlatform — detect the visitor's device, browser, and the best way to run
 * Taproot on it (App Store / Play Store / desktop download / web browser).
 *
 * Pure client-side UA + capability sniffing. No deps, no network. Used by
 * PlatformDetect (banner/card/inline) and DownloadPage to recommend the right
 * distribution channel and highlight the detected platform.
 */

export type PlatformOS =
  | 'ios' | 'android' | 'macos'
  | 'windows' | 'linux' | 'unknown';

export type PlatformRecommendation =
  | 'app-store' | 'play-store'
  | 'desktop-mac' | 'desktop-win'
  | 'web-browser';

export interface Platform {
  os: PlatformOS;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTauri: boolean;
  isPWA: boolean;
  browser: 'safari' | 'chrome' | 'firefox' | 'edge' | 'other';
  recommendation: PlatformRecommendation;
}

export function usePlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();

  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  // iPadOS 13+ reports as "macintosh" but is a touch device — disambiguate via maxTouchPoints.
  const isIPad = /ipad/.test(ua) ||
    (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isMobile = (isIOS && !isIPad) ||
    (isAndroid && /mobile/.test(ua));
  const isTablet = isIPad ||
    (isAndroid && !/mobile/.test(ua));
  const isMacOS = /macintosh|mac os x/.test(ua) && !isIOS && !isIPad;
  const isWindows = /windows/.test(ua);
  const isLinux = /linux/.test(ua) && !isAndroid;
  const isDesktop = !isMobile && !isTablet;

  const isTauri = typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined';

  const isPWA =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  let os: PlatformOS = 'unknown';
  if (isIOS || isIPad) os = 'ios';
  else if (isAndroid) os = 'android';
  else if (isMacOS) os = 'macos';
  else if (isWindows) os = 'windows';
  else if (isLinux) os = 'linux';

  let browser: Platform['browser'] = 'other';
  if (/edg\//.test(ua)) browser = 'edge';
  else if (/chrome|chromium/.test(ua)) browser = 'chrome';
  else if (/firefox|fxios/.test(ua)) browser = 'firefox';
  else if (/safari/.test(ua)) browser = 'safari';

  let recommendation: PlatformRecommendation = 'web-browser';
  if (os === 'ios') recommendation = 'app-store';
  else if (os === 'android') recommendation = 'play-store';
  else if (os === 'macos') recommendation = 'desktop-mac';
  else if (os === 'windows') recommendation = 'desktop-win';

  return {
    os, isMobile, isTablet, isDesktop,
    isTauri, isPWA, browser, recommendation,
  };
}

export default usePlatform;
