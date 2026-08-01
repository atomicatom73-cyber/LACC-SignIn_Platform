"use client";

import { useOptimistic, useState, useTransition } from "react";
import { RichText } from "@/components/RichText";
import { dueLabel } from "@/lib/chores";
import {
  formatStudioDateTime,
  monthLabel,
  studioDateTimeParts,
} from "@/lib/studio";
import type { ChoreInterval } from "@/lib/types";
import { leaveJobNote, setMyChoreSchedule, toggleMyChore } from "./actions";

export type MyChore = {
  id: string;
  month: string; // "YYYY-MM-01"
  status: "pending" | "completed";
  choreName: string;
  choreDescription: string | null;
  choreInterval: ChoreInterval;
  /** This job asks when you'll do it. */
  choreScheduling: boolean;
  /** When you said you'd do it; null until you pick. */
  scheduledAt: string | null;
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
  // Which note box is open: an assignment id for a job, null for the general
  // one, or `undefined` for none. `justDone` softens the prompt right after
  // someone ticks a job off.
  const [note, setNote] = useState<
    { assignmentId: string | null; justDone?: boolean } | undefined
  >(undefined);

  // The card flips instantly; the server settles it (and a failure reverts).
  const [optimisticChores, flipOptimistic] = useOptimistic(
    chores,
    (current, id: string) =>
      current.map((c) =>
        c.id === id
          ? {
              ...c,
              status: c.status === "completed" ? "pending" : "completed",
            }
          : c,
      ),
  );

  function handleToggle(id: string) {
    const completing =
      chores.find((c) => c.id === id)?.status === "pending";
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      flipOptimistic(id);
      const res = await toggleMyChore(id);
      if (res?.error) {
        setError(res.error);
      } else if (completing) {
        // Ticking a job off is the moment people actually have something to
        // report ("the mop head is shot") — so offer the note right there.
        setNote({ assignmentId: id, justDone: true });
      }
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

      {optimisticChores.length === 0 ? (
        !absentThisMonth && (
          <p className="mt-3 text-sm text-muted">
            No jobs assigned right now. Enjoy the wheel! 🏺
          </p>
        )
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {optimisticChores.map((c) => {
            const done = c.status === "completed";
            const carried = c.month < currentMonth;
            return (
              <li
                key={c.id}
                className={`rounded-xl border px-3 py-3 ${
                  done
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className={`text-base font-semibold ${done ? "line-through opacity-70" : ""}`}
                    >
                      {c.choreName}
                    </span>
                    {carried && (
                      <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                        from {monthLabel(c.month)}
                      </span>
                    )}
                    {!done && !carried && (
                      <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {dueLabel(c.choreInterval)}
                      </span>
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
                </div>
                {/* Full width, under the button — on a phone the instructions
                    are unreadable squeezed into the column beside it. */}
                {c.choreDescription && (
                  <RichText
                    value={c.choreDescription}
                    className="mt-1.5 space-y-1 text-sm font-medium text-foreground"
                  />
                )}
                {c.choreScheduling && !done && (
                  <MyScheduleRow
                    assignmentId={c.id}
                    scheduledAt={c.scheduledAt}
                  />
                )}
                {note?.assignmentId === c.id ? (
                  <NoteComposer
                    assignmentId={c.id}
                    hint={
                      note.justDone
                        ? "Nice work. Anything the volunteer coordinator should know?"
                        : "Goes straight to the volunteer coordinator."
                    }
                    onClose={() => setNote(undefined)}
                  />
                ) : (
                  <button
                    onClick={() => setNote({ assignmentId: c.id })}
                    className="mt-2 text-xs font-semibold text-muted underline-offset-2 hover:underline"
                  >
                    ✎ Leave a note
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Always available — "I'm away in August", "can I swap?" — whether or
          not there's a job on the card this month. */}
      {note && note.assignmentId === null ? (
        <NoteComposer
          assignmentId={null}
          hint="Goes straight to the volunteer coordinator."
          onClose={() => setNote(undefined)}
        />
      ) : (
        <button
          onClick={() => setNote({ assignmentId: null })}
          className="mt-3 text-xs font-semibold text-muted underline-offset-2 hover:underline"
        >
          ✎ Note the volunteer coordinator
        </button>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

/**
 * The note box itself. Deliberately plain text and one-way: it's a message to
 * the coordinator, not a thread — the studio settles the rest in person.
 */
function NoteComposer({
  assignmentId,
  hint,
  onClose,
}: {
  assignmentId: string | null;
  hint: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    setError(null);
    startTransition(async () => {
      const res = await leaveJobNote({ body: text, assignmentId });
      if ("error" in res) {
        setError(res.error);
      } else {
        setSent(true);
        setTimeout(onClose, 1500);
      }
    });
  };

  if (sent) {
    return (
      <p className="mt-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-xs">
        Sent to the volunteer coordinator ✓
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="text-xs text-muted">{hint}</p>
      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        placeholder="What's up?"
        className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button
          onClick={send}
          disabled={pending || !text.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-background transition active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send note"}
        </button>
        <button
          onClick={onClose}
          disabled={pending}
          className="rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted transition active:scale-[0.97] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

const SCHEDULE_INPUT =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent";

/**
 * "When will you do it?" — only on jobs an officer marked schedulable. Shows
 * the pick as a line of text once it's made, so the card stays calm; tapping
 * it opens the date and time inputs again.
 */
function MyScheduleRow({
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
      const res = await setMyChoreSchedule(assignmentId, nextDate, nextTime);
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
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="min-w-0 truncate text-xs">
          {scheduledAt ? (
            <>
              <span className="text-muted">You&apos;re doing this</span>{" "}
              <span className="font-medium">
                {formatStudioDateTime(scheduledAt)}
              </span>
            </>
          ) : (
            <span className="text-muted">When will you do this?</span>
          )}
        </span>
        <button
          onClick={() => setOpen(true)}
          className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${
            scheduledAt
              ? "border-border text-muted"
              : "border-accent/40 bg-accent/10 text-accent"
          }`}
        >
          {scheduledAt ? "Change" : "Pick a time"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={SCHEDULE_INPUT}
          aria-label="Date you'll do this job"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className={SCHEDULE_INPUT}
          aria-label="Time you'll do this job"
        />
        <button
          onClick={() => save(date, time)}
          disabled={pending || !date}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-background transition active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? "…" : "Save"}
        </button>
        {scheduledAt && (
          <button
            onClick={() => save("", "")}
            disabled={pending}
            className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
          >
            Clear
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          disabled={pending}
          className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-muted transition active:scale-[0.97] disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
