"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDuration } from "@/lib/time";
import { toggleShift } from "./actions";

export function ClockCard({
  openSince,
}: {
  /** ISO timestamp of the open shift, or null if clocked out. */
  openSince: string | null;
}) {
  const isIn = openSince !== null;
  const [pending, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!openSince) return;
    const start = new Date(openSince).getTime();
    const tick = () => setElapsed(formatDuration(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [openSince]);

  return (
    <div
      className={`rounded-3xl border p-6 text-center transition-colors ${
        isIn ? "border-success/40 bg-success/10" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-center gap-2 text-sm font-medium">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            isIn ? "bg-success animate-pulse" : "bg-muted"
          }`}
        />
        {isIn ? "You're clocked in" : "You're clocked out"}
      </div>

      {isIn && (
        <div className="mt-2 font-mono text-4xl font-bold tabular-nums">
          {elapsed || "0m"}
        </div>
      )}

      <button
        onClick={() => startTransition(() => toggleShift())}
        disabled={pending}
        className={`mt-5 w-full rounded-2xl px-6 py-5 text-lg font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          isIn
            ? "bg-danger text-background"
            : "bg-accent text-background"
        }`}
      >
        {pending ? "…" : isIn ? "Clock out" : "Clock in"}
      </button>
    </div>
  );
}
