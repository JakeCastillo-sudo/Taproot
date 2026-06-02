/**
 * useOnboardingResume
 *
 * Shows a resume banner when an owner returns mid-onboarding.
 * Banner is dismissible for 24 hours.
 */

import { useState, useEffect } from 'react';
import { USER_KEY } from '../lib/api';
import { useOnboardingStore } from '../store/onboarding.store';

const DISMISS_KEY      = 'taproot_onboarding_resume_dismissed_until';
const DISMISS_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface ResumeState {
  showBanner:    boolean;
  businessName:  string;
  dismiss:       () => void;
}

export function useOnboardingResume(): ResumeState {
  const { isComplete, currentStep, businessInfo, startedAt } = useOnboardingStore();
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Only show for owners who started but didn't finish
    try {
      const raw  = localStorage.getItem(USER_KEY);
      const user = raw ? (JSON.parse(raw) as { role?: string }) : null;
      if (user?.role !== 'owner') return;
    } catch {
      return;
    }

    if (isComplete) return;
    if (currentStep === 'welcome') return; // hasn't really started yet

    // Check dismiss cooldown
    const dismissedUntil = localStorage.getItem(DISMISS_KEY);
    if (dismissedUntil && Date.now() < Number(dismissedUntil)) return;

    // Only show if onboarding was actually started (startedAt > 5 min ago means they left)
    const started = new Date(startedAt).getTime();
    if (Date.now() - started < 5 * 60 * 1000) return; // too recent

    setShowBanner(true);
  }, [isComplete, currentStep, startedAt]);

  const dismiss = () => {
    setShowBanner(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION));
  };

  return {
    showBanner,
    businessName: businessInfo.name || 'your business',
    dismiss,
  };
}
