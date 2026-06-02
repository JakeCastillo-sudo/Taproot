/**
 * useHaptic — Vibration API wrapper for tactile feedback on mobile POS.
 *
 * Falls back silently on devices/browsers that don't support
 * navigator.vibrate (iOS, desktop). Never throws.
 *
 * Usage:
 *   const haptic = useHaptic();
 *   haptic.light();     // button tap
 *   haptic.success();   // payment complete
 *   haptic.error();     // card declined
 */

import { useCallback } from 'react';

function vibrate(pattern: number | number[]) {
  try {
    navigator?.vibrate?.(pattern);
  } catch {
    // Not supported — ignore silently
  }
}

export interface HapticFeedback {
  /** Very brief pulse — tap on a button or tile. */
  light:   () => void;
  /** Medium pulse — confirm an action. */
  medium:  () => void;
  /** Strong pulse — heavy action (void order, logout). */
  heavy:   () => void;
  /** Double short pulse — success / payment complete. */
  success: () => void;
  /** Three short pulses — error / card declined. */
  error:   () => void;
  /** Custom pattern, forwarded directly to navigator.vibrate. */
  custom:  (pattern: number | number[]) => void;
}

export function useHaptic(): HapticFeedback {
  const light   = useCallback(() => vibrate(10),           []);
  const medium  = useCallback(() => vibrate(30),           []);
  const heavy   = useCallback(() => vibrate(60),           []);
  const success = useCallback(() => vibrate([15, 50, 15]), []);
  const error   = useCallback(() => vibrate([40, 30, 40, 30, 40]), []);
  const custom  = useCallback((p: number | number[]) => vibrate(p), []);

  return { light, medium, heavy, success, error, custom };
}
