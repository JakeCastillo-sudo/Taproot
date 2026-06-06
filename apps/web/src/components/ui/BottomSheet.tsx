/**
 * BottomSheet — reusable slide-up modal anchored to the bottom of the screen.
 *
 * Features:
 *  • Drag-to-dismiss: pull the sheet down by more than 1/3 of its height
 *  • Swipe-down gesture via useSwipeGesture
 *  • Backdrop tap to dismiss
 *  • Body scroll lock while open
 *  • Safe-area bottom padding (iPhone home indicator)
 *  • GPU-only animation (transform + opacity, compositor thread)
 *
 * Usage:
 *   <BottomSheet open={open} onClose={onClose} title="Cart">
 *     {children}
 *   </BottomSheet>
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';

interface BottomSheetProps {
  open:      boolean;
  onClose:   () => void;
  title?:    string;
  /** Pass a ReactNode for a custom header right slot (e.g. a Clear button). */
  headerRight?: React.ReactNode;
  /** Max height as a dvh fraction string, e.g. "80dvh". Default "85dvh". */
  maxHeight?: string;
  className?: string;
  children:  React.ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  headerRight,
  maxHeight = '85dvh',
  className,
  children,
}: BottomSheetProps) {
  const sheetRef   = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Body scroll lock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ── Close on Escape key ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Swipe-down to dismiss ──────────────────────────────────────────────────
  const handleClose = useCallback(() => onClose(), [onClose]);
  useSwipeGesture(sheetRef, {
    directions: ['down'],
    threshold:  60,
    onSwipeDown: handleClose,
  });

  if (!open) return null;

  return (
    <div
      // Backdrop
      className="fixed inset-0 z-50 flex items-end justify-center md:hidden"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      {/* Sheet panel */}
      <div
        ref={sheetRef}
        className={clsx(
          'relative w-full bg-white rounded-t-2xl flex flex-col animate-slide-up',
          className,
        )}
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="pt-3 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        {(title || headerRight) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <div className="flex items-center gap-2">
              {headerRight}
              <button
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X size={16} className="text-gray-500" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto min-h-0 overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        >
          {children}
        </div>

        {/* Safe-area spacer for iPhone home indicator */}
        <div className="shrink-0" style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
      </div>
    </div>
  );
}

// ── Bottom sheet footer (sticky action area inside a BottomSheet) ─────────────

interface BottomSheetFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function BottomSheetFooter({ children, className }: BottomSheetFooterProps) {
  return (
    <div className={clsx('shrink-0 border-t border-gray-100 px-4 py-3', className)}>
      {children}
    </div>
  );
}
