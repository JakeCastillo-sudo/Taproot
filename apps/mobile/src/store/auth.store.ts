/**
 * Auth store — session state for the device.
 *
 * Tokens are persisted in SecureStore via the api client; this store holds the
 * decoded user + a status the navigator gates on. On 401-with-no-refresh the
 * client invokes our unauthorized handler, which drops us back to 'guest'.
 */
import { create } from 'zustand';
import {
  hydrateTokens,
  setTokens,
  clearTokens,
  setUnauthorizedHandler,
  getAccessToken,
} from '../api/client';
import { authApi, type AuthEmployee } from '../api/endpoints';
import { secureGet, secureSet } from '../utils/storage';
import { USER_KEY } from '../api/config';

type Status = 'loading' | 'guest' | 'authed';

interface AuthState {
  status: Status;
  user: AuthEmployee | null;
  /** Active location for all location-scoped API calls. */
  locationId: string | null;
  /** Toggles the PIN switch-user screen over the authed shell. */
  switchingUser: boolean;

  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  pinLogin: (employeeId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  setSwitchingUser: (v: boolean) => void;
}

function applySession(set: (p: Partial<AuthState>) => void, employee: AuthEmployee) {
  set({
    status: 'authed',
    user: employee,
    locationId: employee.locationIds[0] ?? null,
    switchingUser: false,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  locationId: null,
  switchingUser: false,

  hydrate: async () => {
    // Register the handler once so a failed refresh boots us to the login screen.
    setUnauthorizedHandler(() => {
      set({ status: 'guest', user: null, locationId: null, switchingUser: false });
    });

    await hydrateTokens();
    if (!getAccessToken()) {
      set({ status: 'guest' });
      return;
    }
    const raw = await secureGet(USER_KEY);
    if (!raw) {
      set({ status: 'guest' });
      return;
    }
    try {
      const user = JSON.parse(raw) as AuthEmployee;
      applySession(set, user);
    } catch {
      set({ status: 'guest' });
    }
  },

  login: async (email, password) => {
    const res = await authApi.login(email, password);
    await setTokens(res.accessToken, res.refreshToken);
    await secureSet(USER_KEY, JSON.stringify(res.employee));
    applySession(set, res.employee);
  },

  pinLogin: async (employeeId, pin) => {
    const locationId = get().locationId ?? undefined;
    const res = await authApi.pinLogin(employeeId, pin, locationId);
    await setTokens(res.accessToken, res.refreshToken);
    await secureSet(USER_KEY, JSON.stringify(res.employee));
    applySession(set, res.employee);
  },

  logout: async () => {
    await clearTokens();
    set({ status: 'guest', user: null, locationId: null, switchingUser: false });
  },

  setSwitchingUser: (v) => set({ switchingUser: v }),
}));
