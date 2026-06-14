/**
 * API configuration.
 *
 * Mobile talks directly to the Railway API (no dev proxy like the web app's Vite
 * proxy). Override the host at build time with EXPO_PUBLIC_API_URL (inlined by
 * Expo). Default targets production.
 */
const HOST =
  process.env.EXPO_PUBLIC_API_URL ??
  'https://taproot-production-3d63.up.railway.app';

export const API_BASE = `${HOST}/api/v1`;

// SecureStore keys (mirrors the web localStorage keys, namespaced for mobile).
export const ACCESS_KEY = 'taproot_access';
export const REFRESH_KEY = 'taproot_refresh';
export const USER_KEY = 'taproot_user';
