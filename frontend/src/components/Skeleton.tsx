/** A shimmering placeholder block — used to build page-shaped skeleton
 * loaders (a row of these roughly matching the real content's layout)
 * instead of a single generic spinner, so a loading page doesn't jump
 * around once real content arrives. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-shimmer rounded-md ${className}`} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
