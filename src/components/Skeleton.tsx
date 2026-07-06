/** Building blocks for the route-level loading screens. */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Title + subtitle placeholder matching the page headers. */
export function SkeletonHeading() {
  return (
    <div>
      <SkeletonBlock className="h-8 w-44" />
      <SkeletonBlock className="mt-3 h-4 w-64 max-w-full" />
    </div>
  );
}

/** A stack of card-height placeholders. */
export function SkeletonCards({
  count,
  className = "",
  cardClassName = "h-24",
}: {
  count: number;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} className={cardClassName} />
      ))}
    </div>
  );
}
