/**
 * Admin auth store — COMPLETELY separate from the org auth flow.
 *
 * No shared state with org auth: distinct localStorage keys
 * (`taproot_admin_token` / `taproot_admin_user`), distinct persist key
 * (`taproot-admin-auth`). A logged-in restaurant owner has no admin session and
 * vice-versa. The token mirror in localStorage is what `adminApi.ts` reads on
 * each request.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminUser } from '../lib/adminApi';
import { ADMIN_TOKEN_KEY, ADMIN_USER_KEY } from '../lib/adminApi';

interface AdminAuthStore {
  adminUser: AdminUser | null;
  adminToken: string | null;
  isAdminAuthenticated: boolean;
  setAdminAuth: (user: AdminUser, token: string) => void;
  clearAdminAuth: () => void;
}

export const useAdminAuthStore = create<AdminAuthStore>()(
  persist(
    (set) => ({
      adminUser: null,
      adminToken: null,
      isAdminAuthenticated: false,

      setAdminAuth: (user, token) => {
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
        localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
        set({
          adminUser: user,
          adminToken: token,
          isAdminAuthenticated: true,
        });
      },

      clearAdminAuth: () => {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_USER_KEY);
        set({
          adminUser: null,
          adminToken: null,
          isAdminAuthenticated: false,
        });
      },
    }),
    {
      name: 'taproot-admin-auth',
      partialize: (state) => ({
        adminUser: state.adminUser,
        adminToken: state.adminToken,
        isAdminAuthenticated: state.isAdminAuthenticated,
      }),
    },
  ),
);
