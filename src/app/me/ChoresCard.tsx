"use client";

import { useState, useTransition } from "react";
import { monthLabel } from "@/lib/studio";
import { toggleMyChore } from "./actions";

export type MyChore = {
  id: string;
  month: string; // "YYYY-MM-01"
  status: "pending" | "completed";
  choreName: string;
  choreDescription: string | null;
};

export function ChoresCard({
  chores,
  currentMonth,
  creditsAvailable,
  absentThisMonth,
}: {
  chores: MyChore[];
  currentMonth: string;
  creditsAvailable: number;
  absentThisMonth: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleToggle(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await toggleMyChore(id);
      if (res?.error) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          My jobs
        </h2>
        {creditsAvailable > 0 && (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent">
            {creditsAvailable} credit{creditsAvailable === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {absentThisMonth && (
        <p className="mt-3 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm">
          You&apos;re marked absent this month — no job for you. 🌿
        </p>
      )}

      {chores.length === 0 ? (
        !absentThisMonth && (
          <p className="mt-3 text-sm text-muted">
            No jobs assigned right now. Enjoy the wheel! 🏺
          </p>
        )
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {chores.map((c) => {
            const done = c.status === "completed";
            const carried = c.month < currentMonth;
            return (
              <li
                key={c.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${
                  done
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-surface-2"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-medium ${done ? "line-through opacity-70" : ""}`}
                    >
                      {c.choreName}
                    </span>
                    {carried && (
                      <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                        from {monthLabel(c.month)}
                      </span>
                    )}
                  </div>
                  {c.choreDescription && (
                    <div className="mt-0.5 text-xs text-muted">
                      {c.choreDescription}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(c.id)}
                  disabled={pending && busyId === c.id}
                  className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60 ${
                    done
                      ? "border border-border bg-surface text-muted"
                      : "bg-success text-background"
                  }`}
                >
                  {pending && busyId === c.id ? "…" : done ? "Undo" : "Done ✓"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
