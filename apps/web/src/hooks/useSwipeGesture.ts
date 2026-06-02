/**
 * useSwipeGesture — lightweight touch-swipe detector.
 *
 * Fires onSwipe with the direction ('left' | 'right' | 'up' | 'down')
 * when a touch ends past the distance threshold OR the velocity threshold.
 *
 * Only `transform` / `opacity` are animated (compositor-only — no layout).
 *
 * @param ref     Attach gesture listeners to this element.
 * @param options Threshold, velocity, and direction callbacks.
 */

import { useEffect, useRef } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface SwipeOptions {
  /** Minimum travel distance in px to count as a swipe (default 50). */
  threshold?: number;
  /** Minimum velocity in px/ms to fire on short swipes (default 0.3). */
  velocityThreshold?: number;
  /** Only fire for these directions. Default: all. */
  directions?: SwipeDirection[];
  onSwipe?: (dir: SwipeDirection) => void;
  onSwipeLeft?:  () => void;
  onSwipeRight?: () => void;
  onSwipeUp?:    () => void;
  onSwipeDown?:  () => void;
  /** Called every frame with {dx, dy, progress 0-1} while dragging. */
  onMove?: (dx: number, dy: number) => void;
  /** Called when the touch is released, regardless of whether a swipe fired. */
  onRelease?: (committed: boolean) => void;
}

export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  opts: SwipeOptions = {},
) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0, startY = 0, startT = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t  = e.touches[0];
      startX   = t.clientX;
      startY   = t.clientY;
      startT   = Date.now();
    };

    const onTouchMove = (e: TouchEvent) => {
      const { onMove } = optsRef.current;
      if (!onMove) return;
      const t  = e.touches[0];
      onMove(t.clientX - startX, t.clientY - startY);
    };

    const onTouchEnd = (e: TouchEvent) => {
      const t    = e.changedTouches[0];
      const dx   = t.clientX - startX;
      const dy   = t.clientY - startY;
      const dt   = Math.max(1, Date.now() - startT);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vel  = dist / dt;

      const {
        threshold = 50,
        velocityThreshold = 0.3,
        directions,
        onSwipe, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown,
        onRelease,
      } = optsRef.current;

      const passed = dist >= threshold || vel >= velocityThreshold;

      if (!passed) {
        onRelease?.(false);
        return;
      }

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let dir: SwipeDirection;
      if (absDx >= absDy) {
        dir = dx > 0 ? 'right' : 'left';
      } else {
        dir = dy > 0 ? 'down' : 'up';
      }

      if (directions && !directions.includes(dir)) {
        onRelease?.(false);
        return;
      }

      onSwipe?.(dir);
      if (dir === 'left')  onSwipeLeft?.();
      if (dir === 'right') onSwipeRight?.();
      if (dir === 'up')    onSwipeUp?.();
      if (dir === 'down')  onSwipeDown?.();
      onRelease?.(true);
    };

    el.addEventListener('touchstart',  onTouchStart, { passive: true });
    el.addEventListener('touchmove',   onTouchMove,  { passive: true });
    el.addEventListener('touchend',    onTouchEnd,   { passive: true });
    el.addEventListener('touchcancel', onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener('touchstart',  onTouchStart);
      el.removeEventListener('touchmove',   onTouchMove);
      el.removeEventListener('touchend',    onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [ref]);
}
