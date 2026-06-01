/**
 * Loading state components:
 *  - LoadingSpinner   full-page centered spinner
 *  - InlineSpinner    small spinner for buttons / inline use
 *  - SkeletonCard     generic rectangular skeleton block
 *  - ProductGridSkeleton  matches the POS product grid layout
 *  - TableRowSkeleton     matches inventory / report table rows
 */

import { clsx } from 'clsx';

// ─── Full-page spinner ────────────────────────────────────────────────────────

interface LoadingSpinnerProps {
  message?: string;
  /** Fill the nearest positioned parent instead of the full viewport */
  contained?: boolean;
}

export function LoadingSpinner({ message = 'Loading Taproot…', contained = false }: LoadingSpinnerProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-4',
        contained ? 'h-48' : 'min-h-screen',
      )}
    >
      <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
      {message && (
        <p className="text-sm text-gray-400 animate-pulse">{message}</p>
      )}
    </div>
  );
}

// ─── Inline button spinner ────────────────────────────────────────────────────

interface InlineSpinnerProps {
  size?: number;
  className?: string;
}

export function InlineSpinner({ size = 16, className }: InlineSpinnerProps) {
  return (
    <span
      className={clsx('inline-block rounded-full border-2 border-current/20 border-t-current animate-spin', className)}
      style={{ width: size, height: size, flexShrink: 0 }}
      role="status"
      aria-label="Loading"
    />
  );
}

// ─── Generic skeleton block ───────────────────────────────────────────────────

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div className={clsx('bg-gray-100 rounded-lg animate-pulse', className)} />
  );
}

// ─── Product grid skeleton (4-column) ────────────────────────────────────────

interface ProductGridSkeletonProps {
  count?: number;
}

export function ProductGridSkeleton({ count = 12 }: ProductGridSkeletonProps) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-100 p-3 flex flex-col gap-2">
          <div className="w-full aspect-square rounded-md bg-gray-100 animate-pulse" />
          <div className="h-3 bg-gray-100 rounded animate-pulse" />
          <div className="h-4 w-16 bg-gray-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Table row skeleton ───────────────────────────────────────────────────────

interface TableRowSkeletonProps {
  columns?: number;
  rows?: number;
}

export function TableRowSkeleton({ columns = 5, rows = 8 }: TableRowSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-50">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div
                className="h-3 bg-gray-100 rounded animate-pulse"
                style={{ width: `${60 + ((i * 7 + j * 13) % 40)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
