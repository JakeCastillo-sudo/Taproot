/**
 * Session helpers — read the logged-in employee from localStorage.
 *
 * The user object is persisted under USER_KEY at login (see LoginPage). These
 * helpers centralize access so settings pages, permission guards and POS code
 * don't each re-implement the same JSON.parse + fallback logic.
 */

import { USER_KEY } from './api';

export interface StoredUser {
  id?:          string;
  firstName?:   string;
  lastName?:    string;
  email?:       string;
  role?:        string;
  orgId?:       string;
  locationIds?: string[];
  permissions?: string[];
}

/** Demo fallback location — matches the seeded demo org's first location. */
export const DEMO_LOCATION_ID = '20000000-0000-0000-0000-000000000001';

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

const ACTIVE_LOCATION_KEY = 'taproot_active_location';

/** The user-selected active location (multi-location switcher), if any. */
export function getActiveLocationId(): string | null {
  try { return localStorage.getItem(ACTIVE_LOCATION_KEY); } catch { return null; }
}

export function setActiveLocationId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_LOCATION_KEY, id);
    else localStorage.removeItem(ACTIVE_LOCATION_KEY);
  } catch { /* ignore */ }
}

/**
 * Active location id for queries: the switcher selection if set, else the
 * logged-in employee's first location, else the demo fallback.
 */
export function getLocationId(): string {
  const active = getActiveLocationId();
  if (active) return active;
  const u = getStoredUser();
  if (u?.locationIds?.[0]) return u.locationIds[0];
  return DEMO_LOCATION_ID;
}

/** Current employee role (lowercased), defaulting to 'cashier'. */
export function getCurrentRole(): string {
  return (getStoredUser()?.role ?? 'cashier').toLowerCase();
}

/** Roles allowed into the settings/admin area. */
export const ADMIN_ROLES = new Set(['owner', 'manager']);

export function canAccessSettings(): boolean {
  return ADMIN_ROLES.has(getCurrentRole());
}
