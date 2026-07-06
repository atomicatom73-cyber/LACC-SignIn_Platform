"use client";

import { useActionState, useState, useTransition } from "react";
import { assignChore, removeAssignment, setAssignmentStatus } from "./actions";

export type BoardAssignee = {
  assignmentId: string;
  memberId: string;
  memberName: string;
  status: "pending" | "completed";
};

export type BoardChore = {
  id: string;
  name: string;
  description: string | null;
  slots: number;
  active: boolean;
  assignees: BoardAssignee[];
};

export type PickerMember = { id: string; full_name: string };

/** The month's assignments, one card per chore, with inline editing. */
export function ChoreBoard({
  month,
  chores,
  members,
}: {
  month: string; // "YYYY-MM-01"
  chores: BoardChore[];
  members: PickerMember[];
}) {
  if (chores.length === 0) {
    return (
      <p className="text-sm text-muted">
        No chores to show — add some to the catalog below.
      </p>
    );
  }

  return (
    <div className="anim-stagger grid gap-4 sm:grid-cols-2">
      {chores.map((chore) => (
        <ChoreCard key={chore.id} month={month} chore={chore} members={members} />
      ))}
    </div>
  );
}

function ChoreCard({
  month,
  chore,
  members,
}: {
  month: string;
  chore: BoardChore;
  members: PickerMember[];
}) {
  const [assignState, assignAction, assignPending] = useActionState(
    assignChore,
    null,
  );
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error: string } | null>) =>
    startTransition(async () => {
      const result = await fn();
      setRowError(result?.error ?? null);
    });

  const assignedIds = new Set(chore.assignees.map((a) => a.memberId));
  const candidates = members.filter((m) => !assignedIds.has(m.id));
  const filled = chore.assignees.length;

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">
          {chore.name}
          {!chore.active && (
            <span className="ml-2 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              retired
            </span>
          )}
        </h3>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            filled < chore.slots ? "text-danger" : "text-muted"
          }`}
        >
          {filled}/{chore.slots} filled
        </span>
      </div>
      {chore.description && (
        <p className="mt-1 text-xs text-muted">{chore.description}</p>
      )}

      {chore.assignees.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nobody assigned.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {chore.assignees.map((a) => {
            const done = a.status === "completed";
            return (
              <li
                key={a.assignmentId}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                  done
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-surface-2"
                }`}
              >
                <span
                  className={`min-w-0 truncate text-sm font-medium ${done ? "line-through opacity-70" : ""}`}
                >
                  {a.memberName}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => run(() => setAssignmentStatus(a.assignmentId, !done))}
                    disabled={pending}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-60 ${
                      done
                        ? "border border-border bg-surface text-muted"
                        : "bg-success text-background"
                    }`}
                  >
                    {done ? "Undo" : "Done ✓"}
                  </button>
                  <button
                    onClick={() => run(() => removeAssignment(a.assignmentId))}
                    disabled={pending}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <form action={assignAction} className="mt-3 flex gap-2">
          <input type="hidden" name="chore_id" value={chore.id} />
          <input type="hidden" name="month" value={month} />
          <select
            name="member_id"
            required
            defaultValue=""
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              Assign a member…
            </option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={assignPending}
            className="shrink-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-60"
          >
            {assignPending ? "…" : "Assign"}
          </button>
        </form>
      )}

      {(assignState?.error || rowError) && (
        <p className="mt-2 text-sm text-danger">
          {assignState?.error ?? rowError}
        </p>
      )}
    </section>
  );
}
