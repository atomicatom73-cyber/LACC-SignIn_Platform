"use client";

import { useState, useTransition } from "react";
import { resolveSigninConflict } from "./actions";

/**
 * Sign-ins the app refused to guess at, waiting for a person.
 *
 * Each one is a tap taken on a device that couldn't reach the studio, asking
 * for something the record contradicts — a sign-in for someone already signed
 * in, a sign-out for someone who never signed in. The app wrote nothing, so the
 * day is *missing* something rather than showing something invented. Fixing it
 * means editing the shift on this page's log (or the sheet, which the app
 * rewrites from the database either way), then clearing the reminder.
 */
export type ConflictItem = {
  id: string;
  memberName: string;
  /** "Tried to sign in" / "Tried to sign out". */
  action: string;
  /** Already formatted in studio time by the page. */
  when: string;
  device: string;
  reason: string;
};

export function ConflictList({ conflicts }: { conflicts: ConflictItem[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resolve(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await resolveSigninConflict(id);
      if (res && "error" in res && res.error) setError(res.error);
      setBusyId(null);
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-danger/40 bg-danger/5 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-danger">
        {conflicts.length === 1
          ? "1 sign-in needs sorting out"
          : `${conflicts.length} sign-ins need sorting out`}
      </h2>
      <p className="mt-1 text-xs text-muted">
        These were tapped on a device that had lost its connection, and the
        studio&apos;s record says something different. Nothing was written
        either way — check with the member, correct the day if it needs it,
        then clear it.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {conflicts.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-border bg-surface px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-semibold">{c.memberName}</span>
              <span className="text-xs tabular-nums text-muted">
                {c.action} · {c.when} · {c.device}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">{c.reason}</p>
            <button
              onClick={() => resolve(c.id)}
              disabled={pending && busyId === c.id}
              className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending && busyId === c.id ? "…" : "Mark sorted"}
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
