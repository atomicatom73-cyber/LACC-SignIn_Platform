import {
  SkeletonCards,
  SkeletonHeading,
} from "@/components/Skeleton";

/**
 * Shown instantly inside the officer layout while a tab's data loads, so
 * switching tabs always gives immediate feedback (header + nav stay put).
 */
export default function OfficerLoading() {
  return (
    <div className="anim-fade" aria-busy="true">
      <SkeletonHeading />
      <SkeletonCards
        count={4}
        className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4"
        cardClassName="h-24"
      />
      <SkeletonCards
        count={4}
        className="mt-8 grid gap-4 sm:grid-cols-2"
        cardClassName="h-28"
      />
    </div>
  );
}
