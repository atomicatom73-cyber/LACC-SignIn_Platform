"use client";

import {
  useActionState,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { RichText } from "@/components/RichText";
import { RichTextInput } from "@/components/RichTextInput";
import type { ChoreInterval } from "@/lib/types";
import { INTERVAL_OPTIONS, intervalBadge } from "@/lib/chores";
import { formatStudioDateTime, studioDateTimeParts } from "@/lib/studio";
import { SchedulingToggle } from "./SchedulingToggle";
import {
  assignChore,
  deleteChore,
  duplicateChore,
  removeAssignment,
  setAssignmentSchedule,
  setAssignmentStatus,
  setChorePaused,
  updateChore,
} from "./actions";

export type BoardAssignee = {
  assignmentId: string;
  memberId: string;
  memberName: string;
  status: "pending" | "completed";
  /** When they said they'd do it; only shown for scheduled jobs. */
  scheduledAt: string | null;
};

/**
 * A line penciled into the month's draft — nobody has been told about it, and
 * it's edited in the draft card above, not here.
 */
export type BoardPencil = {
  entryId: string;
  memberId: string | null;
  memberName: string | null;
  scheduledAt: string | null;
};

export type BoardChore = {
  id: string;
  name: string;
  description: string | null;
  slots: number;
  active: boolean;
  paused: boolean;
  interval: ChoreInterval;
  /** Invites whoever holds it to pick a date and time. */
  schedulingEnabled: boolean;
  assignees: BoardAssignee[];
  penciled: BoardPencil[];
};

export type PickerMember = {
  id: string;
  full_name: string;
  officer_status: boolean;
  kiln_team: boolean;
};

/**
 * The month's jobs, one card per job. Each card carries both the month's
 * assignments AND the catalog controls (edit, duplicate, pause, delete) —
 * there's no separate catalog anymore.
 */
export function ChoreBoard({
  month,
  chores,
  members,
}: {
  month: string; // "YYYY-MM-01"
  chores: BoardChore[];
  members: PickerMember[];
}) {
  // What's still open this month, counted the same way the reshuffle draft
  // counts it: slots, and the jobs they're spread across. Paused jobs aren't
  // short-handed, they're switched off.
  const unfilled = chores
    .filter((c) => c.active && !c.paused)
    .map((c) => ({ name: c.name, open: c.slots - c.assignees.length }))
    .filter((c) => c.open > 0);
  const openSlots = unfilled.reduce((sum, c) => sum + c.open, 0);

  // Penciled lines aren't assignments, so they don't close the gap — but
  // saying how many are waiting stops the red banner looking like lost work.
  const penciledTotal = chores.reduce((sum, c) => sum + c.penciled.length, 0);

  if (chores.length === 0) {
    return (
      <p className="text-sm text-muted">
        No jobs yet — add the studio&apos;s recurring jobs at the top of the
        page.
      </p>
    );
  }

  return (
    <>
      {unfilled.length > 0 && (
        <p className="mb-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
          <span className="font-medium">
            Unassigned — {openSlots} slot{openSlots === 1 ? "" : "s"} across{" "}
            {unfilled.length} job{unfilled.length === 1 ? "" : "s"}:
          </span>{" "}
          {unfilled.map((c) => `${c.name} (${c.open})`).join(", ")}
          {penciledTotal > 0 && (
            <span className="text-muted">
              {" "}
              — {penciledTotal} line{penciledTotal === 1 ? " is" : "s are"}{" "}
              penciled into the draft above, waiting to be assigned.
            </span>
          )}
        </p>
      )}
      <div className="anim-stagger grid gap-4 sm:grid-cols-2">
        {chores.map((chore) => (
          <ChoreCard
            key={chore.id}
            month={month}
            chore={chore}
            members={members}
          />
        ))}
      </div>
    </>
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
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(updateChore, null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Delete confirm times out so a stray first tap doesn't linger.
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

  // A saved edit closes the form (the fresh values render on the card).
  // State is adjusted during render, not in an effect: each save returns a
  // fresh `editState` object, so this runs exactly once per success.
  const [closedFor, setClosedFor] = useState<typeof editState>(null);
  if (editState?.success && editState !== closedFor) {
    setClosedFor(editState);
    setEditing(false);
  }

  // Done/Undo flips instantly; the server settles it (a failure reverts).
  const [optimisticAssignees, flipAssignee] = useOptimistic(
    chore.assignees,
    (current, assignmentId: string) =>
      current.map((a) =>
        a.assignmentId === assignmentId
          ? {
              ...a,
              status:
                a.status === "completed"
                  ? ("pending" as const)
                  : ("completed" as const),
            }
          : a,
      ),
  );

  const run = (fn: () => Promise<{ error: string } | null>) =>
    startTransition(async () => {
      const result = await fn();
      setRowError(result?.error ?? null);
    });

  const toggleStatus = (a: BoardAssignee) =>
    startTransition(async () => {
      flipAssignee(a.assignmentId);
      const result = await setAssignmentStatus(
        a.assignmentId,
        a.status !== "completed",
      );
      setRowError(result?.error ?? null);
    });

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    run(() => deleteChore(chore.id));
  };

  const assignedIds = new Set(optimisticAssignees.map((a) => a.memberId));
  const candidates = members.filter((m) => !assignedIds.has(m.id));
  const assigned = optimisticAssignees.length;
  const completed = optimisticAssignees.filter(
    (a) => a.status === "completed",
  ).length;
  const badge = intervalBadge(chore.interval);

  return (
    <section
      className={`flex flex-col rounded-2xl border bg-surface px-4 py-4 ${
        chore.paused ? "border-border border-dashed" : "border-border"
      }`}
    >
      <div className={chore.paused ? "opacity-60" : ""}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-semibold">
            {chore.name}
            {chore.paused && (
              <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                paused
              </span>
            )}
            {!chore.active && (
              <span className="ml-2 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                deleted
              </span>
            )}
          </h3>
          <span className="shrink-0 text-xs tabular-nums">
            <span
              className={completed < assigned ? "text-muted" : "text-success"}
            >
              {completed}/{assigned} completed
            </span>
            <span className="text-muted"> · </span>
            <span
              className={assigned < chore.slots ? "text-danger" : "text-muted"}
            >
              {assigned}/{chore.slots} assigned
            </span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {badge && (
            <span className="inline-block rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {badge}
            </span>
          )}
          {chore.schedulingEnabled && (
            <span className="inline-block rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              🗓 scheduled
            </span>
          )}
        </div>
        {chore.description && (
          <RichText
            value={chore.description}
            className="mt-1 space-y-1 text-sm font-medium text-foreground"
          />
        )}

        {chore.paused ? (
          <p className="mt-3 text-sm text-muted">
            Paused — sits out the reshuffle and can&apos;t be assigned until
            it&apos;s resumed.
          </p>
        ) : optimisticAssignees.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody assigned.</p>
        ) : null}

        {optimisticAssignees.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {optimisticAssignees.map((a) => {
              const done = a.status === "completed";
              return (
                <li
                  key={a.assignmentId}
                  className={`rounded-xl border px-3 py-2 ${
                    done
                      ? "border-success/40 bg-success/10"
                      : "border-border bg-surface-2"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`min-w-0 truncate text-sm font-medium ${done ? "line-through opacity-70" : ""}`}
                    >
                      {a.memberName}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => toggleStatus(a)}
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
                        onClick={() =>
                          run(() => removeAssignment(a.assignmentId))
                        }
                        disabled={pending}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                  {chore.schedulingEnabled && (
                    <ScheduleEditor
                      assignmentId={a.assignmentId}
                      scheduledAt={a.scheduledAt}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Penciled into the draft but not assigned: shown so the card tells
            the whole truth, greyed because nobody has been told. Edited in the
            draft card above — one place to shuffle, so it can't drift. */}
        {chore.penciled.length > 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">
              ✏️ Penciled — not assigned yet
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {chore.penciled.map((p) => (
                <li
                  key={p.entryId}
                  className="truncate text-xs text-muted"
                >
                  {p.memberName ?? "Nobody yet"}
                  {p.scheduledAt && ` · ${formatStudioDateTime(p.scheduledAt)}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!chore.paused && candidates.length > 0 && (
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
                  {m.officer_status
                    ? " · officer"
                    : m.kiln_team
                      ? " · kiln team"
                      : ""}
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
      </div>

      {chore.active && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.97]"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            onClick={() => run(() => duplicateChore(chore.id))}
            disabled={pending}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.97] disabled:opacity-60"
          >
            Duplicate
          </button>
          <button
            onClick={() => run(() => setChorePaused(chore.id, !chore.paused))}
            disabled={pending}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition active:scale-[0.97] disabled:opacity-60 ${
              chore.paused
                ? "border border-accent/40 bg-accent/10 font-semibold text-accent"
                : "border border-border text-muted"
            }`}
          >
            {chore.paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={handleDelete}
            disabled={pending}
            className={`ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium transition active:scale-[0.97] disabled:opacity-60 ${
              confirmingDelete
                ? "bg-danger text-background"
                : "border border-border text-danger"
            }`}
          >
            {confirmingDelete ? "Tap again to delete" : "Delete"}
          </button>
        </div>
      )}

      {editing && (
        <form action={editAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="chore_id" value={chore.id} />
          <input
            name="name"
            required
            autoComplete="off"
            defaultValue={chore.name}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <input
            name="slots"
            type="number"
            min={0}
            max={50}
            required
            defaultValue={chore.slots}
            title="How many members it needs each month"
            className="w-20 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <select
            name="interval"
            defaultValue={chore.interval}
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <RichTextInput
            name="description"
            defaultValue={chore.description ?? ""}
            placeholder="Description (optional) — what needs doing, and how?"
          />
          <SchedulingToggle defaultChecked={chore.schedulingEnabled} />
          <button
            type="submit"
            disabled={editPending}
            className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {editPending ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      {(assignState?.error || editState?.error || rowError) && (
        <p className="mt-2 text-sm text-danger">
          {assignState?.error ?? editState?.error ?? rowError}
        </p>
      )}
    </section>
  );
}

const SCHEDULE_INPUT =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent";

/**
 * When this member will do the job — officers set or clear it here; the member
 * picks their own from /me. Collapsed to a line of text until it's tapped, so
 * a card with four assignees doesn't turn into a wall of date pickers.
 */
function ScheduleEditor({
  assignmentId,
  scheduledAt,
}: {
  assignmentId: string;
  scheduledAt: string | null;
}) {
  const initial = scheduledAt
    ? studioDateTimeParts(scheduledAt)
    : { date: "", time: "" };
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    startTransition(async () => {
      const res = await setAssignmentSchedule(assignmentId, nextDate, nextTime);
      if (res?.error) {
        setError(res.error);
      } else {
        setError(null);
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">
          {scheduledAt
            ? `🗓 ${formatStudioDateTime(scheduledAt)}`
            : "🗓 No time picked yet"}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted transition active:scale-[0.97]"
        >
          {scheduledAt ? "Change" : "Set time"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={SCHEDULE_INPUT}
          aria-label="Date"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={SCHEDULE_INPUT}
          aria-label="Time"
        />
        <button
          onClick={() => save(date, time)}
          disabled={pending || !date}
          className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] font-semibold text-accent transition active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? "…" : "Save"}
        </button>
        {scheduledAt && (
          <button
            onClick={() => save("", "")}
            disabled={pending}
            className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
          >
            Clear
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          disabled={pending}
          className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted transition active:scale-[0.97] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
