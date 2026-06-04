/**
 * useOnboardingGate
 *
 * Determines whether the onboarding wizard should be shown.
 * Criteria:
 *   - Role is 'owner'
 *   - Onboarding not yet complete
 *   - Organization has < 5 products (proxy for "fresh account")
 */

import { useState, useEffect, useRef } from 'react';
import { USER_KEY, products } from '../lib/api';
import { useOnboardingStore } from '../store/onboarding.store';
import type { OnboardingStep } from '../store/onboarding.store';

interface StoredUser {
  role:        string;
  orgId:       string;
  firstName:   string;
  locationIds: string[];
}

function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredUser) : null;
  } catch {
    return null;
  }
}

interface OnboardingGateResult {
  shouldShowOnboarding: boolean;
  onboardingStep:       OnboardingStep;
  isLoading:            boolean;
}

export function useOnboardingGate(): OnboardingGateResult {
  const { isComplete, currentStep } = useOnboardingStore();
  const [productCount, setProductCount] = useState<number | null>(null);
  const [loading,      setLoading]      = useState(true);
  const mounted = useRef(true);

  const user = getStoredUser();
  const isOwner = user?.role === 'owner';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // Short-circuit: non-owners and complete accounts don't need the check
    if (!isOwner || isComplete) {
      if (mounted.current) setLoading(false);
      return;
    }

    let cancelled = false;
    products.list({ perPage: 1 })
      .then((res) => {
        if (!cancelled && mounted.current) setProductCount(res.total);
      })
      .catch(() => {
        if (!cancelled && mounted.current) setProductCount(999); // assume populated on error
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOwner, isComplete]);

  // Only fire when loading is DONE and productCount is a confirmed number
  const shouldShow =
    !loading &&
    isOwner &&
    !isComplete &&
    productCount !== null &&
    productCount < 5;

  return {
    shouldShowOnboarding: shouldShow,
    onboardingStep:       currentStep,
    isLoading:            loading,
  };
}
