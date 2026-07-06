import { SkeletonBlock, SkeletonCards } from "@/components/Skeleton";

/** Instant placeholder for the announcements inbox. */
export default function InboxLoading() {
  return (
    <main
      className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6"
      aria-busy="true"
    >
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-10 w-40" />
        <SkeletonBlock className="h-5 w-14" />
      </div>
      <SkeletonBlock className="mt-6 h-8 w-32" />
      <SkeletonCards
        count={4}
        className="mt-5 flex flex-col gap-3"
        cardClassName="h-24"
      />
    </main>
  );
}
