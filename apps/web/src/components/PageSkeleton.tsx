/**
 * PageSkeleton — Suspense fallback for lazily-loaded heavy pages (S8-06).
 * Simple pulse layout: header bar + content blocks.
 */

export function PageSkeleton() {
  return (
    <div className="h-screen overflow-hidden bg-surface-2 flex flex-col">
      <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-4">
        <div className="h-5 w-40 bg-gray-100 rounded animate-pulse" />
      </div>
      <div className="flex-1 overflow-hidden p-6 space-y-4 max-w-7xl w-full mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
