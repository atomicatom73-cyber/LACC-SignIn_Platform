"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WhenInputs } from "@/components/WhenInputs";
import {
  formatStudioDateTime,
  monthLabel,
  studioDateTimeParts,
  studioToUtcIso,
} from "@/lib/studio";
import {
  discardDraft,
  movePencil,
  nameDraftSlot,
  pencilMember,
  pencilSlot,
  publishDraft,
  setPencilSchedule,
  startDraft,
  unpencil,
} from "./actions";

/**
 * One penciled line. A name with no time, a time with no name, or both —
 * whichever the coordinator settles first.
 */
export type DraftEntry = {
  entryId: string;
  memberId: string | null;
  memberName: string | null;
  scheduledAt: string | null;
};

export type DraftJob = {
  choreId: string;
  choreName: string;
  slots: number;
  /** Invites a date and time per line (open studio, mainly). */
  schedulingEnabled: boolean;
  /** Already assigned and emailed this month — shown here, managed below. */
  published: {
    memberId: string;
    memberName: string;
    scheduledAt: string | null;
  }[];
  entries: DraftEntry[];
};

export type PickerEntry = {
  id: string;
  name: string;
  note: "absent" | "credit" | null;
};

export type Coverage = { id: string; name: string; jobs: number };

export type Exemptions = {
  officers: { id: string; name: string }[];
  kilnTeam: { id: string; name: string }[];
  absent: { id: string; name: string }[];
  creditSpends: { id: string; name: string }[];
  inTheDraw: { id: string; name: string }[];
};

/**
 * Fired by a dated job's card ("✏️ Pencil in sessions") to bring that job's
 * "new session" form up in the draft. Detail: the chore id.
 */
export const PENCIL_SESSIONS_EVENT = "lacc:pencil-sessions";

/** A draft edit, applied to the board the instant it's made. */
type Op =
  | { kind: "add"; choreId: string; entry: DraftEntry }
  | { kind: "name"; entryId: string; memberId: string; memberName: string }
  | { kind: "remove"; entryId: string }
  | { kind: "move"; entryId: string; toChoreId: string }
  | { kind: "schedule"; entryId: string; scheduledAt: string | null };

function applyOp(jobs: DraftJob[], op: Op): DraftJob[] {
  switch (op.kind) {
    case "add":
      // Idempotent: a refresh that already carries the line mustn't double it.
      if (jobs.some((j) => j.entries.some((e) => e.entryId === op.entry.entryId))) {
        return jobs;
      }
      return jobs.map((j) =>
        j.choreId === op.choreId ? { ...j, entries: [...j.entries, op.entry] } : j,
      );
    case "remove":
      return jobs.map((j) => ({
        ...j,
        entries: j.entries.filter((e) => e.entryId !== op.entryId),
      }));
    case "name":
      return jobs.map((j) => ({
        ...j,
        entries: j.entries.map((e) =>
          e.entryId === op.entryId
            ? { ...e, memberId: op.memberId, memberName: op.memberName }
            : e,
        ),
      }));
    case "schedule":
      return jobs.map((j) => ({
        ...j,
        entries: j.entries.map((e) =>
          e.entryId === op.entryId ? { ...e, scheduledAt: op.scheduledAt } : e,
        ),
      }));
    case "move": {
      const moved = jobs
        .flatMap((j) => j.entries)
        .find((e) => e.entryId === op.entryId);
      if (!moved) return jobs;
      return jobs.map((j) => {
        if (j.choreId === op.toChoreId) {
          if (j.entries.some((e) => e.entryId === op.entryId)) return j;
          return { ...j, entries: [...j.entries, moved] };
        }
        return {
          ...j,
          entries: j.entries.filter((e) => e.entryId !== op.entryId),
        };
      });
    }
  }
}

/** A member chip mid-drag: who, where from, and the pointer position. */
type DragState = {
  entryId: string;
  name: string;
  fromChoreId: string;
  started: boolean; // pointer moved past the tap threshold
  x: number;
  y: number;
  startX: number;
  startY: number;
};

const DRAG_THRESHOLD_PX = 6;

/**
 * The month's draft: names penciled against jobs, with a date and time per line
 * where the job wants one. Every edit saves itself, so closing the app or
 * flicking to another month leaves it exactly as it was — and nobody hears a
 * word about it until "Assign officially".
 */
export function DraftCard({
  month,
  months,
  jobs,
  draft,
  exemptions,
  pickerMembers,
}: {
  month: string; // "YYYY-MM-01"
  /** Month keys offered in the picker: this month onwards. */
  months: string[];
  jobs: DraftJob[];
  /** Null when no draft is open for this month. */
  draft: { updatedAt: string; updatedBy: string | null } | null;
  exemptions: Exemptions;
  pickerMembers: PickerEntry[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingReseed, setConfirmingReseed] = useState(false);
  /** Which job has its "add someone" list open, if any. */
  const [pickerChoreId, setPickerChoreId] = useState<string | null>(null);
  /** Which unnamed slot is being given a name, if any. */
  const [namingEntryId, setNamingEntryId] = useState<string | null>(null);
  /** Which dated job has its "add a session" form open, if any. */
  const [composerChoreId, setComposerChoreId] = useState<string | null>(null);
  /** A job card asked for its sessions form; scroll to it once it's drawn. */
  const focusRef = useRef<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  /** A save that failed, shown on the job it belongs to — on a phone the top
   *  of the card is a long scroll away from open studio. */
  const [rowError, setRowError] = useState<{
    choreId: string;
    message: string;
  } | null>(null);
  // Two transitions on purpose. Opening, assigning and throwing away lock the
  // card; pencil edits never do — each one shows at once and saves behind the
  // scenes, so the next session can go in while the last is still saving.
  const [pending, startTransition] = useTransition();
  const [saving, startSave] = useTransition();
  /** Pencil saves, chained so they reach the server in the order they were
   *  made: a time set on a line must not overtake the insert that creates it. */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const [board, apply] = useOptimistic(jobs, applyOp);

  // Live drag data lives in refs — pointer events can outrun React renders,
  // so handlers must not depend on state closures. State mirrors it for the
  // ghost chip / drop highlight only.
  const dragRef = useRef<DragState | null>(null);
  const overRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overChoreId, setOverChoreId] = useState<string | null>(null);

  // "✏️ Pencil in sessions" on a job card below: open that job's form here.
  useEffect(() => {
    const onPencil = (e: Event) => {
      const choreId = (e as CustomEvent<string>).detail;
      focusRef.current = choreId;
      setPickerChoreId(null);
      setComposerChoreId(choreId);
      setFocusNonce((n) => n + 1);
    };
    window.addEventListener(PENCIL_SESSIONS_EVENT, onPencil);
    return () => window.removeEventListener(PENCIL_SESSIONS_EVENT, onPencil);
  }, []);

  // The row only exists once the draft does — which, when the card had to
  // start one, is a refresh after the event. So try again when it arrives.
  useEffect(() => {
    const choreId = focusRef.current;
    if (!choreId || !draft) return;
    const row = document.getElementById(`draft-job-${choreId}`);
    if (!row) return;
    focusRef.current = null;
    row.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft, focusNonce]);

  // Both confirmations time out, so a stray first tap doesn't linger.
  useEffect(() => {
    if (!confirmingPublish) return;
    const id = setTimeout(() => setConfirmingPublish(false), 5000);
    return () => clearTimeout(id);
  }, [confirmingPublish]);
  useEffect(() => {
    if (!confirmingReseed) return;
    const id = setTimeout(() => setConfirmingReseed(false), 5000);
    return () => clearTimeout(id);
  }, [confirmingReseed]);

  /** Run one draft edit: show it at once, let the server settle it. */
  const edit = (
    choreId: string,
    op: Op,
    call: () => Promise<{ error: string } | null>,
  ) =>
    startSave(async () => {
      apply(op);
      const run = saveQueue.current.then(call);
      saveQueue.current = run.catch(() => null);
      const result = await run.catch(() => ({
        error: "Couldn't save that — check the connection and try again.",
      }));
      if (result?.error) {
        setRowError({ choreId, message: result.error });
      } else {
        setRowError((current) =>
          current?.choreId === choreId ? null : current,
        );
      }
    });

  const open = (mode: "blank" | "algorithm") =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setConfirmingReseed(false);
      const result = await startDraft(month, mode);
      setError(result?.error ?? null);
      setNotice(result?.success ?? null);
    });

  const publish = () =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setConfirmingPublish(false);
      const result = await publishDraft(month);
      setError(result?.error ?? null);
      setNotice(result?.success ?? null);
      router.refresh();
    });

  const discard = () =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await discardDraft(month);
      setError(result?.error ?? null);
      if (!result?.error) setNotice("Draft thrown away.");
    });

  // Pointer-based drag (mouse + touch): the chip captures the pointer, so
  // move/up keep firing on it while we hit-test the row under the finger.
  const handleDragStart = (
    e: React.PointerEvent,
    entry: { entryId: string; name: string },
    fromChoreId: string,
  ) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released (fast tap) — dragging just won't follow
      // outside the chip, which is fine.
    }
    const next: DragState = {
      entryId: entry.entryId,
      name: entry.name,
      fromChoreId,
      started: false,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    const started =
      current.started ||
      Math.hypot(e.clientX - current.startX, e.clientY - current.startY) >
        DRAG_THRESHOLD_PX;
    const next = { ...current, started, x: e.clientX, y: e.clientY };
    dragRef.current = next;
    setDrag(next);
    if (!started) return;
    const card = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest("[data-chore-id]");
    overRef.current = card?.getAttribute("data-chore-id") ?? null;
    setOverChoreId(overRef.current);
  };

  const handleDragEnd = (commit: boolean) => {
    const current = dragRef.current;
    const over = overRef.current;
    dragRef.current = null;
    overRef.current = null;
    setDrag(null);
    setOverChoreId(null);
    if (!current?.started || !commit || !over || over === current.fromChoreId) {
      return;
    }
    edit(over, { kind: "move", entryId: current.entryId, toChoreId: over }, () =>
      movePencil(current.entryId, over),
    );
  };

  // The month's first and last day, so a session's date picker opens on the
  // month being planned rather than on today.
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = `${month.slice(0, 8)}${String(
    new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
  ).padStart(2, "0")}`;

  const penciled = board.flatMap((j) => j.entries);
  const namedPenciled = penciled.filter((e) => e.memberId);
  const unnamedSlots = penciled.length - namedPenciled.length;

  // Coverage: everyone in the rotation, plus anyone penciled or assigned who
  // wasn't (an absent member or credit holder put on a job anyway).
  const roster = new Map(exemptions.inTheDraw.map((m) => [m.id, m.name]));
  for (const j of board) {
    for (const p of j.published) roster.set(p.memberId, p.memberName);
    for (const e of j.entries) {
      if (e.memberId) roster.set(e.memberId, e.memberName ?? "Unknown member");
    }
  }
  const coverage: Coverage[] = [...roster].map(([id, name]) => ({
    id,
    name,
    jobs: board.filter(
      (j) =>
        j.published.some((p) => p.memberId === id) ||
        j.entries.some((e) => e.memberId === id),
    ).length,
  }));

  // Jobs still short, counting published and penciled together.
  const unfilled = board
    .map((j) => ({
      choreName: j.choreName,
      open: j.slots - j.published.length - j.entries.length,
    }))
    .filter((u) => u.open > 0);
  const openSlotTotal = unfilled.reduce((sum, u) => sum + u.open, 0);

  /** Who's already on this job, assigned or penciled — not offered again. */
  const onThisJob = (job: DraftJob) =>
    new Set([
      ...job.published.map((p) => p.memberId),
      ...job.entries.flatMap((e) => (e.memberId ? [e.memberId] : [])),
    ]);

  /** Who already holds something this month — penciled or real. */
  const busyElsewhere = (choreId: string) =>
    new Set(
      board
        .filter((j) => j.choreId !== choreId)
        .flatMap((j) => [
          ...j.published.map((p) => p.memberId),
          ...j.entries.flatMap((e) => (e.memberId ? [e.memberId] : [])),
        ]),
    );

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">
          {draft ? "Draft — nobody told yet" : "Plan a month"}
          {saving && (
            <span className="ml-2 text-xs font-normal text-muted">Saving…</span>
          )}
        </h2>
        {!draft && (
          <span className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={() => open("blank")}
              disabled={pending}
              className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "…" : "Start blank"}
            </button>
            <button
              onClick={() => open("algorithm")}
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "Drafting…" : "Fill from rotation"}
            </button>
          </span>
        )}
      </div>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Planning</span>
        <select
          value={month.slice(0, 7)}
          disabled={pending}
          onChange={(e) => router.push(`/officer/chores?month=${e.target.value}`)}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm font-semibold outline-none focus:border-accent disabled:opacity-60 sm:flex-none"
        >
          {months.map((m) => (
            <option key={m} value={m.slice(0, 7)}>
              {monthLabel(m)}
              {m === months[0] ? " · this month" : ""}
            </option>
          ))}
        </select>
      </label>

      {draft ? (
        <p className="mt-2 text-xs text-muted">
          Saved {formatStudioDateTime(draft.updatedAt)}
          {draft.updatedBy ? ` by ${draft.updatedBy}` : ""} — every change saves
          itself, so you can close the app and come back to it. Nothing here is
          emailed, shows on anyone&apos;s phone, or reaches the printed sheet
          until you assign it officially.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          <span className="font-medium text-foreground">Start blank</span> to
          pencil in a few names and times yourself, or{" "}
          <span className="font-medium text-foreground">fill from rotation</span>{" "}
          to let the draw propose the whole month — officers, absent members, and
          credit holders sit out, repeats are avoided, and nobody gets more than
          one job. Either way it&apos;s a pencil draft: it saves as you go and
          tells nobody until you say so.
        </p>
      )}

      <CoverageChart
        rows={coverage}
        heading={
          draft
            ? `Draft + assigned for ${monthLabel(month)}`
            : `Assigned for ${monthLabel(month)}`
        }
      />

      {notice && <p className="mt-3 text-sm text-success">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {draft && (
        <div className="mt-4">
          {unfilled.length > 0 && (
            <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              <span className="font-medium">
                Still short — {openSlotTotal} slot
                {openSlotTotal === 1 ? "" : "s"} across {unfilled.length} job
                {unfilled.length === 1 ? "" : "s"}:
              </span>{" "}
              {unfilled.map((u) => `${u.choreName} (${u.open})`).join(", ")}{" "}
              <span className="text-muted">
                — add someone with ＋, or assign anyway and leave them open.
              </span>
            </p>
          )}

          <p className="mb-2 text-xs text-muted">
            Drag a name onto another job to move it, tap ＋ to add someone. Jobs
            with a 🗓 take one session per line — add as many as you like, with
            a name or without one yet.
          </p>

          <ul className="flex select-none flex-col gap-1.5">
            {board.map((job) => {
              const filled = job.published.length + job.entries.length;
              const openSlots = Math.max(0, job.slots - filled);
              const dropTarget =
                drag?.started &&
                overChoreId === job.choreId &&
                job.choreId !== drag.fromChoreId;
              return (
                <li
                  key={job.choreId}
                  id={`draft-job-${job.choreId}`}
                  data-chore-id={job.choreId}
                  className={`scroll-mt-24 overflow-hidden rounded-xl border transition-colors ${
                    dropTarget
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface-2"
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {job.choreName}
                      {job.schedulingEnabled && (
                        <span className="ml-1.5 text-[11px] text-accent">🗓</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        openSlots > 0 ? "text-danger" : "text-success"
                      }`}
                    >
                      {filled}/{job.slots}
                      {openSlots > 0 ? " ⚠" : " ✓"}
                    </span>
                  </div>

                  {/* Already real: shown so the count tells the truth, but
                      changed on the job card below, never silently here. */}
                  {job.published.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1.5">
                      {job.published.map((p) => (
                        <span
                          key={p.memberId}
                          title="Already assigned — change it on the job card below"
                          className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-xs text-muted"
                        >
                          {p.memberName}
                          {job.schedulingEnabled && p.scheduledAt && (
                            <span>· {formatStudioDateTime(p.scheduledAt)}</span>
                          )}
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-success">
                            assigned
                          </span>
                        </span>
                      ))}
                    </div>
                  )}

                  {job.schedulingEnabled ? (
                    <div className="flex flex-col gap-1.5 px-3 pb-2.5 pt-1.5">
                      {job.entries.map((entry) => (
                        <ScheduledLine
                          key={entry.entryId}
                          entry={entry}
                          pending={pending}
                          monthStart={month}
                          monthEnd={monthEnd}
                          naming={namingEntryId === entry.entryId}
                          onNameToggle={() =>
                            setNamingEntryId(
                              namingEntryId === entry.entryId
                                ? null
                                : entry.entryId,
                            )
                          }
                          members={pickerMembers}
                          busyElsewhere={busyElsewhere(job.choreId)}
                          onThisJob={onThisJob(job)}
                          onName={(m) => {
                            setNamingEntryId(null);
                            edit(
                              job.choreId,
                              {
                                kind: "name",
                                entryId: entry.entryId,
                                memberId: m.id,
                                memberName: m.name,
                              },
                              () => nameDraftSlot(entry.entryId, m.id),
                            );
                          }}
                          onSchedule={(date, time) =>
                            edit(
                              job.choreId,
                              {
                                kind: "schedule",
                                entryId: entry.entryId,
                                scheduledAt: date
                                  ? studioToUtcIso(date, time || "09:00")
                                  : null,
                              },
                              () =>
                                setPencilSchedule(entry.entryId, date, time),
                            )
                          }
                          onRemove={() =>
                            edit(
                              job.choreId,
                              { kind: "remove", entryId: entry.entryId },
                              () => unpencil(entry.entryId),
                            )
                          }
                          onDragStart={(e) =>
                            entry.memberId
                              ? handleDragStart(
                                  e,
                                  {
                                    entryId: entry.entryId,
                                    name: entry.memberName ?? "",
                                  },
                                  job.choreId,
                                )
                              : undefined
                          }
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
                          dragging={
                            drag?.started && drag.entryId === entry.entryId
                          }
                        />
                      ))}

                      {composerChoreId === job.choreId ? (
                        <SessionComposer
                          monthStart={month}
                          monthEnd={monthEnd}
                          members={pickerMembers}
                          onThisJob={onThisJob(job)}
                          busyElsewhere={busyElsewhere(job.choreId)}
                          disabled={pending}
                          onAdd={({ date, time, member }) => {
                            const entryId = crypto.randomUUID();
                            edit(
                              job.choreId,
                              {
                                kind: "add",
                                choreId: job.choreId,
                                entry: {
                                  entryId,
                                  memberId: member?.id ?? null,
                                  memberName: member?.name ?? null,
                                  scheduledAt: date
                                    ? studioToUtcIso(date, time || "09:00")
                                    : null,
                                },
                              },
                              () =>
                                pencilSlot(
                                  entryId,
                                  month,
                                  job.choreId,
                                  member?.id ?? null,
                                  date,
                                  time,
                                ),
                            );
                          }}
                          onClose={() => setComposerChoreId(null)}
                        />
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {openSlots > 0 && (
                            <span className="inline-flex items-center rounded-full border border-dashed border-danger/50 px-2.5 py-1 text-xs text-danger">
                              {openSlots} to go
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setComposerChoreId(job.choreId);
                              setPickerChoreId(null);
                            }}
                            disabled={pending}
                            className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent transition active:scale-[0.95] disabled:opacity-60"
                          >
                            ＋ Add a session
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1.5">
                      {job.entries.map((entry) => (
                        <span
                          key={entry.entryId}
                          onPointerDown={(e) => {
                            if (pending || !entry.memberId) return;
                            handleDragStart(
                              e,
                              {
                                entryId: entry.entryId,
                                name: entry.memberName ?? "",
                              },
                              job.choreId,
                            );
                          }}
                          onPointerMove={handleDragMove}
                          onPointerUp={() => handleDragEnd(true)}
                          onPointerCancel={() => handleDragEnd(false)}
                          className={`inline-flex cursor-grab touch-none items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs ${
                            drag?.started && drag.entryId === entry.entryId
                              ? "opacity-40"
                              : ""
                          }`}
                        >
                          {entry.memberName ?? "No name yet"}
                          <button
                            onClick={() =>
                              edit(
                                job.choreId,
                                { kind: "remove", entryId: entry.entryId },
                                () => unpencil(entry.entryId),
                              )
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={pending}
                            title="Rub out"
                            aria-label={`Remove ${entry.memberName ?? "this line"} from ${job.choreName}`}
                            className="text-muted transition active:scale-[0.9] disabled:opacity-60"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {openSlots > 0 && (
                        <span className="inline-flex items-center rounded-full border border-dashed border-danger/50 px-2.5 py-1 text-xs text-danger">
                          {openSlots} to go
                        </span>
                      )}
                      <PickerToggle
                        open={pickerChoreId === job.choreId}
                        label="＋"
                        choreName={job.choreName}
                        pending={pending}
                        onToggle={() => {
                          setPickerChoreId(
                            pickerChoreId === job.choreId ? null : job.choreId,
                          );
                          setComposerChoreId(null);
                        }}
                      />
                    </div>
                  )}

                  {pickerChoreId === job.choreId && (
                    <MemberPicker
                      members={pickerMembers}
                      onThisJob={onThisJob(job)}
                      busyElsewhere={busyElsewhere(job.choreId)}
                      onPick={(m) => {
                        const entryId = crypto.randomUUID();
                        edit(
                          job.choreId,
                          {
                            kind: "add",
                            choreId: job.choreId,
                            entry: {
                              entryId,
                              memberId: m.id,
                              memberName: m.name,
                              scheduledAt: null,
                            },
                          },
                          () =>
                            pencilMember(entryId, month, job.choreId, m.id),
                        );
                      }}
                      onClose={() => setPickerChoreId(null)}
                    />
                  )}

                  {rowError?.choreId === job.choreId && (
                    <p
                      role="alert"
                      className="px-3 pb-2.5 text-xs text-danger"
                    >
                      {rowError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {drag?.started && (
            <span
              aria-hidden
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[130%] rounded-full border border-accent bg-surface px-3 py-1.5 text-sm font-medium shadow-lg"
              style={{ left: drag.x, top: drag.y }}
            >
              {drag.name}
            </span>
          )}

          <div className="mt-3 flex flex-col gap-1.5 text-sm">
            {exemptions.creditSpends.length > 0 && (
              <ExemptLine
                label="Credits spent"
                names={exemptions.creditSpends.map((c) => c.name)}
                hint="one credit each when you assign; back in the draw next month"
              />
            )}
            {exemptions.absent.length > 0 && (
              <ExemptLine
                label="Absent"
                names={exemptions.absent.map((a) => a.name)}
                hint="exempt, no credit spent; back in the draw next month"
              />
            )}
            {/* Officers and the kiln team are listed under the board — they're
                standing exemptions, not month-by-month ones, so repeating them
                inside the draft would just be noise. */}
          </div>

          {unnamedSlots > 0 && (
            <p className="mt-3 text-xs text-muted">
              {unnamedSlots} slot{unnamedSlots === 1 ? "" : "s"} still waiting
              for a name — assigning takes the named ones and leaves these
              penciled, dates and all.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() =>
                confirmingPublish ? publish() : setConfirmingPublish(true)
              }
              disabled={pending || saving || namedPenciled.length === 0}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
                confirmingPublish
                  ? "bg-danger text-background"
                  : "bg-accent text-background"
              }`}
            >
              {pending
                ? "Assigning…"
                : confirmingPublish
                  ? `Tap again — emails ${namedPenciled.length} member${namedPenciled.length === 1 ? "" : "s"}`
                  : `Assign officially (${namedPenciled.length})`}
            </button>
            <button
              onClick={() =>
                confirmingReseed ? open("algorithm") : setConfirmingReseed(true)
              }
              disabled={pending || saving}
              className={`rounded-xl px-4 py-2.5 text-sm transition active:scale-[0.98] disabled:opacity-60 ${
                confirmingReseed
                  ? "bg-danger text-background font-semibold"
                  : "border border-border text-muted"
              }`}
            >
              {confirmingReseed
                ? "Tap again — replaces your edits"
                : "Re-run the rotation"}
            </button>
            <button
              onClick={discard}
              disabled={pending || saving}
              className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted transition active:scale-[0.98] disabled:opacity-60"
            >
              Throw it away
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The "＋" toggle on a job row. */
function PickerToggle({
  open,
  label,
  choreName,
  pending,
  onToggle,
}: {
  open: boolean;
  label: string;
  choreName: string;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-label={`Add someone to ${choreName}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition active:scale-[0.95] disabled:opacity-60 ${
        open
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-surface text-muted"
      }`}
    >
      {open ? "✕" : label}
    </button>
  );
}

/**
 * "＋ Add a session" on a job that takes a date and time (open studio, mainly).
 *
 * One form for the whole session — when, and who if that's settled yet — and
 * it stays open after each add, keeping the time, so a month of sessions goes
 * in as one run: date, name, add; date, name, add. Before this, every line was
 * two separate trips ("add a date/time", then "tap to name"), and a name added
 * first then needed its own "Set time". Leaving "who" empty pencils the
 * session as "nobody yet", to be staffed later.
 */
function SessionComposer({
  monthStart,
  monthEnd,
  members,
  onThisJob,
  busyElsewhere,
  disabled,
  onAdd,
  onClose,
}: {
  monthStart: string;
  monthEnd: string;
  members: PickerEntry[];
  onThisJob: Set<string>;
  busyElsewhere: Set<string>;
  disabled: boolean;
  onAdd: (session: {
    date: string;
    time: string;
    member: { id: string; name: string } | null;
  }) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [member, setMember] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [choosing, setChoosing] = useState(false);
  const [added, setAdded] = useState(0);

  const add = () => {
    onAdd({ date, time, member });
    // Sessions tend to share a time of day, so that stays for the next one.
    setDate("");
    setMember(null);
    setChoosing(false);
    setAdded((n) => n + 1);
  };

  return (
    <div className="rounded-lg border border-accent/40 bg-surface px-2.5 py-2.5">
      <p className="text-xs font-semibold">
        {added > 0 ? "Next session" : "New session"}
      </p>
      <div className="mt-1.5">
        <WhenInputs
          captioned
          date={date}
          time={time}
          minDate={monthStart}
          maxDate={monthEnd}
          onDate={setDate}
          onTime={setTime}
        />
      </div>

      <div className="mt-2">
        <span className="text-[11px] font-medium text-muted">Who</span>
        {member ? (
          <div className="mt-0.5 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2">
            <span className="min-w-0 truncate text-sm font-medium">
              {member.name}
            </span>
            <button
              type="button"
              onClick={() => {
                setMember(null);
                setChoosing(true);
              }}
              className="shrink-0 text-xs font-medium text-muted underline-offset-2 hover:underline"
            >
              Change
            </button>
          </div>
        ) : choosing ? (
          <MemberPicker
            embedded
            members={members}
            onThisJob={onThisJob}
            busyElsewhere={busyElsewhere}
            onPick={(m) => {
              setMember(m);
              setChoosing(false);
            }}
            onClose={() => setChoosing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setChoosing(true)}
            className="mt-0.5 w-full rounded-lg border border-dashed border-border px-2.5 py-2 text-left text-sm text-muted transition active:scale-[0.99]"
          >
            Pick someone — or leave it open for now
          </button>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={add}
          disabled={disabled || (!date && !member)}
          className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-background transition active:scale-[0.97] disabled:opacity-50"
        >
          Add session
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition active:scale-[0.97]"
        >
          Done
        </button>
        {added > 0 && (
          <span className="text-xs text-success">
            {added} added ✓ — next one?
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One penciled line on a job that wants a date and time — a name, a when, or
 * either half on its own, each fillable without touching the other.
 */
function ScheduledLine({
  entry,
  pending,
  monthStart,
  monthEnd,
  naming,
  members,
  onThisJob,
  busyElsewhere,
  dragging,
  onNameToggle,
  onName,
  onSchedule,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  entry: DraftEntry;
  pending: boolean;
  monthStart: string;
  monthEnd: string;
  naming: boolean;
  members: PickerEntry[];
  onThisJob: Set<string>;
  busyElsewhere: Set<string>;
  dragging: boolean | undefined;
  onNameToggle: () => void;
  onName: (member: { id: string; name: string }) => void;
  onSchedule: (date: string, time: string) => void;
  onRemove: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (commit: boolean) => void;
}) {
  const [editingTime, setEditingTime] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  // Seeded when the editor is opened, not once on mount: another officer may
  // have changed this line since, and a draft can sit for weeks.
  const openEditor = () => {
    const parts = entry.scheduledAt
      ? studioDateTimeParts(entry.scheduledAt)
      : { date: "", time: "" };
    setDate(parts.date);
    setTime(parts.time);
    setEditingTime(true);
  };

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        entry.memberId
          ? "border-border bg-surface"
          : "border-dashed border-accent/50 bg-surface"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        {entry.memberId ? (
          <span
            onPointerDown={(e) => {
              if (pending) return;
              onDragStart(e);
            }}
            onPointerMove={onDragMove}
            onPointerUp={() => onDragEnd(true)}
            onPointerCancel={() => onDragEnd(false)}
            className="min-w-0 flex-1 cursor-grab touch-none truncate text-sm font-medium"
          >
            {entry.memberName}
          </span>
        ) : (
          <button
            type="button"
            onClick={onNameToggle}
            disabled={pending}
            className="min-w-0 flex-1 truncate text-left text-sm font-medium text-accent transition active:scale-[0.99] disabled:opacity-60"
          >
            {naming ? "Pick someone ↓" : "Nobody yet — tap to name"}
          </button>
        )}
        <button
          onClick={onRemove}
          disabled={pending}
          title="Rub out"
          aria-label="Remove this line"
          className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
        >
          ✕
        </button>
      </div>

      {editingTime ? (
        <div className="mt-1.5">
          <WhenInputs
            date={date}
            time={time}
            minDate={monthStart}
            maxDate={monthEnd}
            onDate={setDate}
            onTime={setTime}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                onSchedule(date, time);
                setEditingTime(false);
              }}
              disabled={pending || !date}
              className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-[11px] font-semibold text-accent transition active:scale-[0.97] disabled:opacity-60"
            >
              Save
            </button>
            {entry.scheduledAt && (
              <button
                onClick={() => {
                  setDate("");
                  setTime("");
                  onSchedule("", "");
                  setEditingTime(false);
                }}
                disabled={pending}
                className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-danger transition active:scale-[0.97] disabled:opacity-60"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setEditingTime(false)}
              className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted transition active:scale-[0.97]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted">
            {entry.scheduledAt
              ? `🗓 ${formatStudioDateTime(entry.scheduledAt)}`
              : "🗓 No time picked yet"}
          </span>
          <button
            onClick={openEditor}
            disabled={pending}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted transition active:scale-[0.97] disabled:opacity-60"
          >
            {entry.scheduledAt ? "Change" : "Set time"}
          </button>
        </div>
      )}

      {naming && !entry.memberId && (
        <MemberPicker
          embedded
          members={members}
          onThisJob={onThisJob}
          busyElsewhere={busyElsewhere}
          onPick={onName}
          onClose={onNameToggle}
        />
      )}
    </div>
  );
}

/**
 * The "＋" list: every active member except officers, searchable, tap to add.
 * Anyone already holding a job sorts to the bottom and says so — the draw
 * never hands out two, so adding them is a deliberate override. Absent members
 * and credit holders are listed but tagged for the same reason.
 */
function MemberPicker({
  members,
  onThisJob,
  busyElsewhere,
  onPick,
  onClose,
  embedded = false,
}: {
  members: PickerEntry[];
  /** Already on this job — hidden from the list. */
  onThisJob: Set<string>;
  /** Holding some other job this month — listed last, flagged. */
  busyElsewhere: Set<string>;
  onPick: (member: { id: string; name: string }) => void;
  onClose: () => void;
  /** Inside a card with its own padding: no divider, no extra inset. */
  embedded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = members
    .filter(
      (m) => !onThisJob.has(m.id) && m.name.toLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        Number(busyElsewhere.has(a.id)) - Number(busyElsewhere.has(b.id)),
    );

  return (
    <div
      className={
        embedded
          ? "mt-1.5 select-text"
          : "select-text border-t border-border px-3 py-2.5"
      }
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search members…"
        aria-label="Search members"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />

      {matches.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          {needle ? `Nobody matches “${query.trim()}”.` : "Nobody left to add."}
        </p>
      ) : (
        <ul className="mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: m.id, name: m.name });
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left transition active:scale-[0.99]"
              >
                <span className="min-w-0 truncate text-xs font-medium">
                  {m.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {busyElsewhere.has(m.id)
                    ? "already has a job"
                    : m.note === "absent"
                      ? "absent this month"
                      : m.note === "credit"
                        ? "credit — sitting out"
                        : "＋"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-2 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.97]"
      >
        {embedded ? "Cancel" : "Done"}
      </button>
    </div>
  );
}

/** "Absent: Amy, Bo — exempt, no credit spent". */
function ExemptLine({
  label,
  names,
  hint,
}: {
  label: string;
  names: string[];
  hint: string;
}) {
  return (
    <p>
      <span className="font-medium">{label}:</span> {names.join(", ")}{" "}
      <span className="text-muted">— {hint}</span>
    </p>
  );
}

/**
 * How the month's load lands across the rotation: one stacked bar of members
 * with no job / one job / two or more, plus who exactly is uncovered. The
 * lopsided end is what needs attention — too many "none" means jobs to add,
 * too many "two+" means not enough people to go round.
 */
function CoverageChart({
  rows,
  heading,
}: {
  rows: Coverage[];
  heading: string;
}) {
  const total = rows.length;
  const none = rows.filter((r) => r.jobs === 0);
  const one = rows.filter((r) => r.jobs === 1).length;
  const many = rows.filter((r) => r.jobs > 1);
  const covered = total - none.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  if (total === 0) {
    return (
      <div className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted">
        No members in the job rotation yet.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {heading}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {covered} of {total} have a job{" "}
          <span className="text-muted">({pct(covered)}%)</span>
        </span>
      </div>

      <div
        role="img"
        aria-label={`${one} members with one job, ${many.length} with two or more, ${none.length} with none`}
        className="mt-2 flex h-3 overflow-hidden rounded-full bg-border"
      >
        <Segment value={one} total={total} className="bg-success" />
        <Segment value={many.length} total={total} className="bg-accent" />
        <Segment value={none.length} total={total} className="bg-danger/70" />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Key className="bg-success" label={`${one} with one job`} />
        <Key
          className="bg-accent"
          label={`${many.length} with two or more (${pct(many.length)}%)`}
        />
        <Key
          className="bg-danger/70"
          label={`${none.length} with none (${pct(none.length)}%)`}
        />
      </div>

      {none.length === 0 ? (
        <p className="mt-2 text-xs text-success">
          Everyone in the rotation has a job. 🎉
        </p>
      ) : (
        <NameList label="No job" names={none.map((r) => r.name)} />
      )}
      {many.length > 0 && (
        <NameList
          label="Two or more"
          names={many.map((r) => `${r.name} (${r.jobs})`)}
        />
      )}
    </div>
  );
}

/** How many names show before the list folds behind a "show all". */
const NAME_PREVIEW = 8;

/**
 * "No job: Amy, Bo, Cal + 54 more". A 60-person studio at the start of the
 * month has almost everyone uncovered, and the raw list buried the rest of
 * the card — so long lists fold until they're asked for.
 */
function NameList({ label, names }: { label: string; names: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const hidden = sorted.length - NAME_PREVIEW;
  const shown = expanded ? sorted : sorted.slice(0, NAME_PREVIEW);

  return (
    <p className="mt-2 text-xs">
      <span className="font-medium">{label}:</span>{" "}
      <span className="text-muted">{shown.join(", ")}</span>
      {hidden > 0 && (
        <>
          {!expanded && <span className="text-muted">…</span>}{" "}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-medium text-accent underline underline-offset-2"
          >
            {expanded ? "show fewer" : `+${hidden} more`}
          </button>
        </>
      )}
    </p>
  );
}

function Segment({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className: string;
}) {
  if (value === 0) return null;
  return (
    <span className={className} style={{ width: `${(value / total) * 100}%` }} />
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
