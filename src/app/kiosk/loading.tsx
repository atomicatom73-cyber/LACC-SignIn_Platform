/** Instant skeleton shown while the dynamic kiosk roster streams in. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 py-6">
      <div className="flex items-center justify-between">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-surface" />
        <div className="h-7 w-28 animate-pulse rounded-full bg-surface" />
      </div>

      <div className="mt-6 h-8 w-40 animate-pulse rounded-lg bg-surface" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-2xl bg-surface" />
        ))}
      </div>
    </main>
  );
}
