/**
 * UI preferences store.
 *
 * sidebarCollapsed  — persisted to localStorage (user preference)
 * posViewMode       — NOT persisted; always starts as 'categories' on page load
 * selectedCategory* — NOT persisted; always null on page load
 *
 * This intentional split means the POS always lands on the category tile view
 * after a refresh, while the sidebar collapse preference is remembered.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
    }),
    {
      name:    'taproot-ui-prefs',
      storage: createJSONStorage(() => localStorage),
      // Only persist the sidebar preference — pos view always resets to 'categories'
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
