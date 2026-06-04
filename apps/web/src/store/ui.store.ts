/**
 * UI preferences store.
 *
 * sidebarCollapsed  — persisted to localStorage (user preference)
 * posViewMode       — NOT persisted; always starts as 'categories' on page load
 * selectedCategory* — NOT persisted; always null on page load
 * activeDayPart     — NOT persisted; always 'all' on page load
 *
 * The intentional split means:
 * - POS always lands on category tiles after refresh
 * - Sidebar collapse preference is remembered
 * - Day-part mode resets every session (restaurants open showing all items)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ActiveDayPart = 'all' | 'breakfast' | 'brunch' | 'lunch' | 'dinner';

export interface UIStore {
  // ── Sidebar ─────────────────────────────────────────────────────────────────
  sidebarCollapsed:     boolean;
  toggleSidebar:        () => void;
  setSidebarCollapsed:  (collapsed: boolean) => void;

  // ── POS view mode (never persisted) ─────────────────────────────────────────
  posViewMode:          'categories' | 'items';
  selectedCategoryId:   string | null;
  selectedCategoryName: string | null;

  /**
   * Drill into a specific category (or all items when categoryId is null).
   * Switches posViewMode to 'items'.
   */
  setPosViewItems: (
    categoryId:   string | null,
    categoryName: string | null,
  ) => void;

  /** Return to the category tile grid. */
  resetPosView: () => void;

  // ── Day-part filter (never persisted — always 'all' on page load) ────────────
  /**
   * Active meal period. Products with no day_parts assignment are always shown.
   * Only products explicitly assigned to specific parts are hidden in other modes.
   */
  activeDayPart:    ActiveDayPart;
  setActiveDayPart: (part: ActiveDayPart) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      // sidebar
      sidebarCollapsed:     false,
      toggleSidebar:        () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed:  (c) => set({ sidebarCollapsed: c }),

      // pos view (initial = categories)
      posViewMode:          'categories',
      selectedCategoryId:   null,
      selectedCategoryName: null,

      setPosViewItems: (categoryId, categoryName) => set({
        posViewMode:          'items',
        selectedCategoryId:   categoryId,
        selectedCategoryName: categoryName,
      }),

      resetPosView: () => set({
        posViewMode:          'categories',
        selectedCategoryId:   null,
        selectedCategoryName: null,
      }),

      // day-part (initial = all)
      activeDayPart:    'all',
      setActiveDayPart: (part) => set({ activeDayPart: part }),
    }),
    {
      name:    'taproot-ui-prefs',
      storage: createJSONStorage(() => localStorage),
      // Only persist the sidebar preference.
      // posViewMode and activeDayPart always reset on page load.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
