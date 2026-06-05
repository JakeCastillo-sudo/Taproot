/**
 * Layout store — dashboard layout config for the POS register.
 *
 * Persists to localStorage (instant load on next visit).
 * Fetches fresh from API on demand (call fetchLayout() in useEffect).
 *
 * Safe-default rule: if dashboardLayout is null, the POS falls back
 * to its built-in defaults. Missing config NEVER breaks the register.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { settings as settingsApi, DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from '../lib/api';

export interface LayoutStore {
  /** Current dashboard layout — null = not yet loaded, use defaults */
  dashboardLayout: DashboardLayout | null;
  isLoading:       boolean;
  isSaving:        boolean;
  lastError:       string | null;

  /** Fetch layout from API and update store. */
  fetchLayout:     () => Promise<void>;
  /** Save layout to API and update store. */
  saveLayout:      (layout: DashboardLayout) => Promise<void>;
  /** Reset to built-in defaults (clears saved config). */
  resetLayout:     () => Promise<void>;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      dashboardLayout: null,
      isLoading:       false,
      isSaving:        false,
      lastError:       null,

      fetchLayout: async () => {
        set({ isLoading: true, lastError: null });
        try {
          const layout = await settingsApi.getDashboardLayout();
          set({ dashboardLayout: layout ?? null, isLoading: false });
        } catch (err) {
          // Non-fatal — POS still works with defaults
          set({
            isLoading: false,
            lastError: err instanceof Error ? err.message : 'Failed to load layout',
          });
        }
      },

      saveLayout: async (layout) => {
        set({ isSaving: true, lastError: null });
        try {
          await settingsApi.saveDashboardLayout(layout);
          set({ dashboardLayout: layout, isSaving: false });
        } catch (err) {
          set({
            isSaving:  false,
            lastError: err instanceof Error ? err.message : 'Failed to save layout',
          });
          throw err; // re-throw so caller can show error toast
        }
      },

      resetLayout: async () => {
        const defaultLayout = { ...DEFAULT_DASHBOARD_LAYOUT };
        set({ isSaving: true });
        try {
          await settingsApi.saveDashboardLayout(defaultLayout);
          set({ dashboardLayout: null, isSaving: false });
        } catch (err) {
          set({ isSaving: false });
          throw err;
        }
      },
    }),
    {
      name:    'taproot-dashboard-layout',
      storage: createJSONStorage(() => localStorage),
      // Only persist the layout config (not loading/error state)
      partialize: (state) => ({ dashboardLayout: state.dashboardLayout }),
    },
  ),
);
