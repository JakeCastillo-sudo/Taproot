/**
 * ScrollablePage — the canonical scroll shell for app pages.
 *
 * Encapsulates the fixed-shell + inner-scroll pattern used across Taproot
 * (the fix behind BUG-UX-001 / BUG-UX-002 / BUG-IMP-003): a fixed-height
 * outer container that hides overflow, an optional non-scrolling header and
 * footer, and a single scrollable body. Content and action buttons stay
 * reachable on any viewport (including iPad / PWA standalone, where the
 * document body does not scroll).
 *
 *   <ScrollablePage header={<PageHeader/>} footer={<ActionBar/>}>
 *     <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6"> ...content... </div>
 *   </ScrollablePage>
 *
 * Variants:
 *   - "screen" (default): fills the viewport (h-screen). Use for top-level
 *     routed pages.
 *   - "fill": fills its parent flex container (flex-1 / h-full). Use when the
 *     page is nested inside another flex shell, e.g. SettingsLayout's <Outlet/>.
 *
 * The body is full-bleed so the scrollbar sits at the edge — center/pad the
 * content yourself inside `children` (e.g. a max-w-7xl wrapper), matching the
 * existing pages.
 */

import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface ScrollablePageProps {
  /** Scrollable body content. */
  children: ReactNode;
  /** Fixed (non-scrolling) region pinned to the top — header bar, tabs, toolbar. */
  header?: ReactNode;
  /** Fixed (non-scrolling) region pinned to the bottom — e.g. a save/action bar. */
  footer?: ReactNode;
  /**
   * "screen" (default) → h-screen, for top-level routed pages.
   * "fill" → flex-1/h-full, for pages nested in another flex shell.
   */
  variant?: 'screen' | 'fill';
  /** Background utility for the outer container. */
  background?: string;
  /** Extra classes for the outer container. */
  className?: string;
  /** Extra classes for the scrollable body region. */
  bodyClassName?: string;
}

export function ScrollablePage({
  children,
  header,
  footer,
  variant = 'screen',
  background = 'bg-surface-2',
  className,
  bodyClassName,
}: ScrollablePageProps) {
  return (
    <div
      className={clsx(
        'flex flex-col overflow-hidden',
        variant === 'screen' ? 'h-screen' : 'flex-1 h-full min-h-0',
        background,
        className,
      )}
    >
      {header != null && <div className="shrink-0">{header}</div>}

      <div className={clsx('flex-1 overflow-y-auto min-h-0', bodyClassName)}>
        {children}
      </div>

      {footer != null && <div className="shrink-0">{footer}</div>}
    </div>
  );
}
