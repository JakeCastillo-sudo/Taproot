/**
 * useCapabilities — read the org's v2.0 capability spine for gated rendering.
 *
 * FAIL OPEN: while loading, on error, or before the backend route/migration exist,
 * this returns the food_service default so the app renders EXACTLY like today's
 * restaurant POS. A capability is only ever HIDDEN when the backend explicitly says
 * it is off — never because of a fetch failure. Restaurant owners see zero change.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Capabilities } from '@taproot/shared';
import { capabilities as capabilitiesApi } from '../lib/api';

// Default-on mirror of the backend DEFAULT_CAPABILITIES. Used whenever the real
// value is unavailable (loading / error / endpoint unwired / pre-migration).
export const DEFAULT_CAPABILITIES: Capabilities = {
  food_service: true,
  studio: false,
  retail: false,
  billing_models: {
    drop_in: false,
    class_packs: false,
    free_trial: false,
    memberships: false,
    classpass: false,
  },
};

export interface UseCapabilitiesResult {
  capabilities: Capabilities;
  isLoading: boolean;
  /** Top-level capability check; defaults to true for food_service when unknown. */
  hasCapability: (key: 'food_service' | 'studio' | 'retail') => boolean;
}

export function useCapabilities(): UseCapabilitiesResult {
  const { data, isLoading } = useQuery({
    queryKey: ['capabilities'],
    queryFn: capabilitiesApi.get,
    staleTime: 5 * 60_000,
    retry: false, // never hammer; fail open immediately to defaults
  });

  // Fail OPEN: any absence of data → restaurant defaults.
  const caps = data ?? DEFAULT_CAPABILITIES;

  return {
    capabilities: caps,
    isLoading,
    hasCapability: (key) => Boolean(caps[key]),
  };
}

/**
 * Page-level guard for studio-only pages (v2.1+). Redirects to the register once
 * capabilities have loaded and `studio` is off — so a non-studio org that hits a
 * studio URL directly is bounced cleanly. Waits for load (never redirects while
 * unknown) to avoid bouncing a studio org before its capabilities resolve.
 * Returns { ready, allowed } so the page can render a loading state until ready.
 */
export function useRequireStudio(): { ready: boolean; allowed: boolean } {
  const { hasCapability, isLoading } = useCapabilities();
  const navigate = useNavigate();
  const allowed = hasCapability('studio');
  useEffect(() => {
    if (!isLoading && !allowed) navigate('/', { replace: true });
  }, [isLoading, allowed, navigate]);
  return { ready: !isLoading, allowed };
}
