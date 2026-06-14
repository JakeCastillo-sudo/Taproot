/**
 * Taproot mobile API client.
 *
 * Mirrors apps/web/src/lib/api.ts (apiFetch) but adapted for React Native:
 *  - Tokens live in SecureStore (async), cached in-memory for synchronous reads.
 *  - Auto-attaches the JWT, auto-refreshes once on 401, retries the request.
 *  - On refresh failure it clears tokens and notifies a registered handler so the
 *    auth store can drop the session back to the login screen.
 */
import { secureGet, secureSet, secureDelete } from '../utils/storage';
import { API_BASE, ACCESS_KEY, REFRESH_KEY, USER_KEY } from './config';

// ─── In-memory token cache (hydrated from SecureStore at startup) ───────────────

let _access: string | null = null;
let _refresh: string | null = null;

export async function hydrateTokens(): Promise<void> {
  _access = await secureGet(ACCESS_KEY);
  _refresh = await secureGet(REFRESH_KEY);
}

export function getAccessToken(): string | null {
  return _access;
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  _access = access;
  _refresh = refresh;
  await secureSet(ACCESS_KEY, access);
  await secureSet(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  _access = null;
  _refresh = null;
  await secureDelete(ACCESS_KEY);
  await secureDelete(REFRESH_KEY);
  await secureDelete(USER_KEY);
}

// ─── Unauthorized handler (set by the auth store) ───────────────────────────────

let _onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  _onUnauthorized = fn;
}

// ─── Error type ─────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Token refresh (deduplicated) ───────────────────────────────────────────────

let _refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (!_refresh) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: _refresh }),
    });
    if (!res.ok) {
      await clearTokens();
      return null;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    await setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

function refreshTokens(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = doRefresh().finally(() => {
    _refreshPromise = null;
  });
  return _refreshPromise;
}

// ─── Core fetch ─────────────────────────────────────────────────────────────────

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Taproot-Client': 'mobile',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (_access) headers['Authorization'] = `Bearer ${_access}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    if (retry) return apiFetch<T>(path, init, false);
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }

  if (res.status === 401 && retry) {
    const newToken = await refreshTokens();
    if (newToken) return apiFetch<T>(path, init, false);
    await clearTokens();
    _onUnauthorized?.();
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }

  if (!res.ok) {
    let body: { code?: string; message?: string; details?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* empty */
    }
    throw new ApiError(
      res.status,
      body.code ?? 'API_ERROR',
      body.message ?? `HTTP ${res.status}`,
      body.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
