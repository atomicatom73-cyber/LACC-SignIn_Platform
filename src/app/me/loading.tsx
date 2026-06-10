/** Instant skeleton shown while the dynamic /me data streams in. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <div className="flex items-center justify-between">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-surface" />
        <div className="h-4 w-12 animate-pulse rounded bg-surface" />
      </div>

      <div className="mt-8 h-8 w-44 animate-pulse rounded-lg bg-surface" />

      <div className="mt-5 h-40 animate-pulse rounded-3xl bg-surface" />

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="h-[88px] animate-pulse rounded-2xl bg-surface" />
        <div className="h-[88px] animate-pulse rounded-2xl bg-surface" />
      </div>

      <div className="mt-8 flex flex-col gap-2">
        <div className="mb-1 h-4 w-16 animate-pulse rounded bg-surface" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[58px] animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
    </main>
  );
}
