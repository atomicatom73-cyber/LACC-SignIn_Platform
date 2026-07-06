import { SkeletonBlock, SkeletonCards } from "@/components/Skeleton";

/** Instant placeholder for the studio calendar while events load. */
export default function CalendarLoading() {
  return (
    <main
      className="anim-fade mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-6"
      aria-busy="true"
    >
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-10 w-40" />
        <SkeletonBlock className="h-5 w-14" />
      </div>
      <SkeletonBlock className="mt-8 h-8 w-52" />
      <div className="mt-5 flex gap-2">
        <SkeletonBlock className="h-9 w-24 rounded-full" />
        <SkeletonBlock className="h-9 w-16 rounded-full" />
      </div>
      <SkeletonCards
        count={4}
        className="mt-6 flex flex-col gap-3"
        cardClassName="h-20"
      />
    </main>
  );
}
