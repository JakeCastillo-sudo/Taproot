/**
 * useOrientation — Detect device orientation and whether the device is a tablet.
 *
 * Returns:
 *   orientation  'landscape' | 'portrait'
 *   isTablet     true when viewport width >= 768px (iPad mini and larger)
 *   showHint     true when on a tablet in portrait orientation
 *                (show "Rotate for best experience" hint)
 *
 * Uses `window.matchMedia` and the `resize` event (ScreenOrientation API is
 * unreliable on all iOS Safari versions up to 16.x, so we use viewport width).
 */

import { useState, useEffect } from 'react';

export type Orientation = 'landscape' | 'portrait';

export interface OrientationState {
  orientation: Orientation;
  isTablet:    boolean;
  /** True when the user should rotate their tablet for the best POS experience. */
  showHint:    boolean;
}

function getState(): OrientationState {
  const w           = window.innerWidth;
  const h           = window.innerHeight;
  const isTablet    = w >= 768;
  const orientation: Orientation = w >= h ? 'landscape' : 'portrait';
  const showHint    = isTablet && orientation === 'portrait';
  return { orientation, isTablet, showHint };
}

export function useOrientation(): OrientationState {
  const [state, setState] = useState<OrientationState>(getState);

  useEffect(() => {
    const handler = () => setState(getState());
    window.addEventListener('resize',             handler, { passive: true });
    window.addEventListener('orientationchange', handler, { passive: true });
    return () => {
      window.removeEventListener('resize',             handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  return state;
}
