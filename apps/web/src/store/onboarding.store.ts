/**
 * Onboarding state machine
 *
 * Tracks wizard progress persistently across page refreshes.
 * Key: taproot_onboarding_{orgId} — cleared when onboarding completes.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { USER_KEY } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OnboardingStep =
  | 'welcome'
  | 'menu_upload'
  | 'menu_review'
  | 'team_setup'
  | 'stripe_connect'
  | 'tax_setup'
  | 'complete';

export const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'menu_upload',
  'menu_review',
  'team_setup',
  'stripe_connect',
  'tax_setup',
  'complete',
];

export function stepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

export function stepProgress(step: OnboardingStep): number {
  return Math.round(((STEP_ORDER.indexOf(step)) / (STEP_ORDER.length - 1)) * 100);
}

export interface OnboardingStore {
  currentStep:    OnboardingStep;
  isComplete:     boolean;
  skippedSteps:   OnboardingStep[];
  startedAt:      string;
  completedAt:    string | null;

  businessInfo: {
    name:         string;
    type:         string;
    locationName: string;
  };

  menuUpload: {
    jobId:     string | null;
    status:    'idle' | 'uploading' | 'parsing' | 'ready' | 'applied' | 'skipped';
    itemCount: number;
    filename:  string | null;
    items:     MenuReviewItem[];
  };

  recipeSetup: {
    status:      'idle' | 'uploading' | 'parsing' | 'ready' | 'applied' | 'skipped';
    recipeCount: number;
  };

  stripeConnect: {
    status:    'idle' | 'pending' | 'connected' | 'skipped';
    accountId: string | null;
  };

  // ── Actions ─────────────────────────────────────────────────────────────────
  setStep:          (step: OnboardingStep) => void;
  skipStep:         (step: OnboardingStep) => void;
  completeOnboarding: () => void;
  updateBusinessInfo: (data: Partial<OnboardingStore['businessInfo']>) => void;
  updateMenuUpload:   (data: Partial<OnboardingStore['menuUpload']>) => void;
  updateRecipeSetup:  (data: Partial<OnboardingStore['recipeSetup']>) => void;
  updateStripeConnect:(data: Partial<OnboardingStore['stripeConnect']>) => void;
  reset: () => void;
}

export interface MenuReviewItem {
  id:          string;  // temp client-side id (not DB id yet)
  name:        string;
  price:       number;  // cents
  category:    string;
  description: string;
  confidence:  number;  // 0-1
  isDemo?:     boolean;
}

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  currentStep:  'welcome' as OnboardingStep,
  isComplete:   false,
  skippedSteps: [] as OnboardingStep[],
  startedAt:    new Date().toISOString(),
  completedAt:  null as string | null,
  businessInfo: { name: '', type: '', locationName: '' },
  menuUpload:   { jobId: null, status: 'idle' as const, itemCount: 0, filename: null, items: [] },
  recipeSetup:  { status: 'idle' as const, recipeCount: 0 },
  stripeConnect:{ status: 'idle' as const, accountId: null },
};

// ─── Org-scoped storage key ───────────────────────────────────────────────────

function getStorageKey(): string {
  try {
    const raw  = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as { orgId?: string }) : null;
    return `taproot_onboarding_${user?.orgId ?? 'anon'}`;
  } catch {
    return 'taproot_onboarding_anon';
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setStep: (step) => set({ currentStep: step }),

      skipStep: (step) => set((s) => ({
        skippedSteps: [...new Set([...s.skippedSteps, step])],
        currentStep:  STEP_ORDER[Math.min(stepIndex(step) + 1, STEP_ORDER.length - 1)],
      })),

      completeOnboarding: () => set({
        isComplete:  true,
        currentStep: 'complete',
        completedAt: new Date().toISOString(),
      }),

      updateBusinessInfo: (data) => set((s) => ({
        businessInfo: { ...s.businessInfo, ...data },
      })),

      updateMenuUpload: (data) => set((s) => ({
        menuUpload: { ...s.menuUpload, ...data },
      })),

      updateRecipeSetup: (data) => set((s) => ({
        recipeSetup: { ...s.recipeSetup, ...data },
      })),

      updateStripeConnect: (data) => set((s) => ({
        stripeConnect: { ...s.stripeConnect, ...data },
      })),

      reset: () => set({ ...DEFAULT_STATE, startedAt: new Date().toISOString() }),
    }),
    {
      name:    getStorageKey(),
      storage: createJSONStorage(() => localStorage),
      // When complete, persist only the completion flag.
      // Previously this returned {} which caused isComplete to reset to false
      // on rehydration (Zustand merges {} with defaults → isComplete: false).
      partialize: (state) => state.isComplete
        ? ({ isComplete: true, completedAt: state.completedAt } as Partial<OnboardingStore>)
        : state,
    },
  ),
);
