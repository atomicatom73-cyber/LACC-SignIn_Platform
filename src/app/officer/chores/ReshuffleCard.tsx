"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { monthLabel } from "@/lib/studio";
import {
  previewReshuffle,
  publishReshuffle,
  type ReshufflePreview,
} from "./actions";

/** A member chip mid-drag: who, where from, and the pointer position. */
type DragState = {
  memberId: string;
  name: string;
  fromChoreId: string;
  started: boolean; // pointer moved past the tap threshold
  x: number;
  y: number;
  startX: number;
  startY: number;
};

const DRAG_THRESHOLD_PX = 6;

/** One member's job count, for the coverage chart. */
export type Coverage = { id: string; name: string; jobs: number };

/**
 * One-click monthly draft: pick the month (this one or any month ahead), run
 * the credit-aware algorithm, review the proposal — jobs collapse to one row
 * each so a long catalog still fits a phone — then publish.
 */
export function ReshuffleCard({
  month,
  months,
  published,
}: {
  month: string;
  /** Month keys ("YYYY-MM-01") offered in the picker: this month onwards. */
  months: string[];
  /** Everyone in the rotation and what they hold for `month` right now. */
  published: Coverage[];
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ReshufflePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** Which job has its "add someone" member list open, if any. */
  const [pickerChoreId, setPickerChoreId] = useState<string | null>(null);
  // Live drag data lives in refs — pointer events can outrun React renders,
  // so handlers must not depend on state closures. State mirrors it for the
  // ghost chip / drop highlight only.
  const dragRef = useRef<DragState | null>(null);
  const overRef = useRef<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overChoreId, setOverChoreId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const draft = () =>
    startTransition(async () => {
      setError(null);
      setSuccess(null);
      const result = await previewReshuffle(month);
      if ("error" in result) {
        setError(result.error);
        setPreview(null);
      } else {
        setPreview(result.preview);
        setPickerChoreId(null);
      }
    });

  /** Hand-add someone to a job from the picker. */
  const addMember = (choreId: string, member: { id: string; name: string }) => {
    if (!preview) return;
    setPreview({
      ...preview,
      proposals: preview.proposals.map((p) =>
        p.choreId === choreId && !p.members.some((m) => m.id === member.id)
          ? { ...p, members: [...p.members, member] }
          : p,
      ),
    });
  };

  const dropMember = (choreId: string, memberId: string) => {
    if (!preview) return;
    setPreview({
      ...preview,
      proposals: preview.proposals.map((p) =>
        p.choreId === choreId
          ? { ...p, members: p.members.filter((m) => m.id !== memberId) }
          : p,
      ),
    });
  };

  const moveMember = (
    fromChoreId: string,
    toChoreId: string,
    memberId: string,
  ) => {
    if (!preview || fromChoreId === toChoreId) return;
    const moved = preview.proposals
      .find((p) => p.choreId === fromChoreId)
      ?.members.find((m) => m.id === memberId);
    if (!moved) return;
    setPreview({
      ...preview,
      proposals: preview.proposals.map((p) => {
        if (p.choreId === fromChoreId) {
          return { ...p, members: p.members.filter((m) => m.id !== memberId) };
        }
        if (p.choreId === toChoreId) {
          if (p.members.some((m) => m.id === memberId)) return p;
          return { ...p, members: [...p.members, moved] };
        }
        return p;
      }),
    });
  };

  // Pointer-based drag (mouse + touch): the chip captures the pointer, so
  // move/up keep firing on it while we hit-test the row under the finger.
  // Collapsed rows are valid drop targets too — the <li> keeps its id.
  const handleDragStart = (
    e: React.PointerEvent,
    member: { id: string; name: string },
    fromChoreId: string,
  ) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released (fast tap) — dragging just won't follow
      // outside the chip, which is fine.
    }
    const next: DragState = {
      memberId: member.id,
      name: member.name,
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
    if (current?.started && commit && over) {
      moveMember(current.fromChoreId, over, current.memberId);
    }
    dragRef.current = null;
    overRef.current = null;
    setDrag(null);
    setOverChoreId(null);
  };

  // Coverage: the live draft while one is open, otherwise what's published.
  // Everyone in the draw counts, plus anyone hand-added who wasn't (an absent
  // member or credit holder the officer put on a job anyway).
  const draftRoster = new Map(
    preview
      ? [
          ...preview.eligibleMembers.map((m) => [m.id, m] as const),
          ...preview.proposals.flatMap((p) =>
            p.members.map((m) => [m.id, m] as const),
          ),
        ]
      : [],
  );
  const coverage: Coverage[] = preview
    ? [...draftRoster.values()].map((m) => ({
        id: m.id,
        name: m.name,
        jobs: preview.proposals.filter((p) =>
          p.members.some((x) => x.id === m.id),
        ).length,
      }))
    : published;

  // Jobs the draft couldn't staff. Nobody gets two jobs, so a short-handed
  // month leaves slots open instead of stacking them on whoever's left.
  const unfilled = (preview?.proposals ?? [])
    .map((p) => ({ choreName: p.choreName, open: p.slots - p.members.length }))
    .filter((u) => u.open > 0);

  const publish = () =>
    startTransition(async () => {
      if (!preview) return;
      setError(null);
      const result = await publishReshuffle({
        targetMonth: preview.targetMonth,
        assignments: preview.proposals.flatMap((p) =>
          p.members.map((m) => ({ chore_id: p.choreId, member_id: m.id })),
        ),
        creditMemberIds: preview.creditSpends.map((c) => c.id),
      });
      if (result?.error) {
        setError(result.error);
      } else {
        setPreview(null);
        setSuccess(result?.success ?? "Published.");
        router.refresh();
      }
    });

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Monthly reshuffle</h2>
        {!preview && (
          <button
            onClick={draft}
            disabled={pending}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Drafting…" : "Draft assignments"}
          </button>
        )}
      </div>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Drafting for</span>
        <select
          value={month.slice(0, 7)}
          disabled={pending || preview !== null}
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
      <p className="mt-2 text-xs text-muted">
        Officers, absent members, and credit holders sit the month out (credits
        are spent on publish), repeats are avoided, and nobody gets more than
        one job — if there aren&apos;t enough members, the leftover slots stay
        unassigned. Nothing is saved until you publish, so future months can be
        drafted, reviewed, and published well ahead of time.
      </p>

      <CoverageChart
        rows={coverage}
        heading={preview ? "In this draft" : `Published for ${monthLabel(month)}`}
      />

      {success && <p className="mt-3 text-sm text-success">{success}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {preview && (
        <div className="mt-4">
          {preview.existingCount > 0 && (
            <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              {monthLabel(month)} already has {preview.existingCount} assignment
              {preview.existingCount === 1 ? "" : "s"} — the draft doesn&apos;t
              know about them, so double-check for members getting two jobs.
            </p>
          )}

          {unfilled.length > 0 && (
            <p className="mb-3 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
              <span className="font-medium">Unassigned:</span>{" "}
              {unfilled
                .map((u) => `${u.choreName} (${u.open})`)
                .join(", ")}{" "}
              <span className="text-muted">
                — not enough members to go round without giving anyone two jobs.
                Add someone with ＋, or publish and leave the slots open.
              </span>
            </p>
          )}

          <p className="mb-2 text-xs text-muted">
            Drag a name onto another job to move it, or tap ＋ to add someone.
          </p>
          <ul className="flex select-none flex-col gap-1.5">
            {preview.proposals.map((p) => {
              const openSlots = Math.max(0, p.slots - p.members.length);
              const dropTarget =
                drag?.started &&
                overChoreId === p.choreId &&
                p.choreId !== drag.fromChoreId;
              return (
                <li
                  key={p.choreId}
                  data-chore-id={p.choreId}
                  className={`overflow-hidden rounded-xl border transition-colors ${
                    dropTarget
                      ? "border-accent bg-accent/10"
                      : "border-border bg-surface-2"
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {p.choreName}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        openSlots > 0 ? "text-danger" : "text-success"
                      }`}
                    >
                      {p.members.length}/{p.slots}
                      {openSlots > 0 ? " ⚠" : " ✓"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 pt-1.5">
                    {p.members.map((m) => (
                      <span
                        key={m.id}
                        onPointerDown={(e) => {
                          if (pending) return;
                          handleDragStart(e, m, p.choreId);
                        }}
                        onPointerMove={handleDragMove}
                        onPointerUp={() => handleDragEnd(true)}
                        onPointerCancel={() => handleDragEnd(false)}
                        className={`inline-flex cursor-grab touch-none items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs ${
                          drag?.started &&
                          drag.memberId === m.id &&
                          drag.fromChoreId === p.choreId
                            ? "opacity-40"
                            : ""
                        }`}
                      >
                        {m.name}
                        <button
                          onClick={() => dropMember(p.choreId, m.id)}
                          onPointerDown={(e) => e.stopPropagation()}
                          disabled={pending}
                          title="Remove from draft"
                          aria-label={`Remove ${m.name} from ${p.choreName}`}
                          className="text-muted transition active:scale-[0.9] disabled:opacity-60"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {openSlots > 0 && (
                      <span className="inline-flex items-center rounded-full border border-dashed border-danger/50 px-2.5 py-1 text-xs text-danger">
                        {openSlots} unassigned
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setPickerChoreId(
                          pickerChoreId === p.choreId ? null : p.choreId,
                        )
                      }
                      disabled={pending}
                      aria-label={`Add someone to ${p.choreName}`}
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition active:scale-[0.95] disabled:opacity-60 ${
                        pickerChoreId === p.choreId
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-border bg-surface text-muted"
                      }`}
                    >
                      {pickerChoreId === p.choreId ? "✕" : "＋"}
                    </button>
                  </div>
                  {pickerChoreId === p.choreId && (
                    <MemberPicker
                      members={preview.pickerMembers}
                      onThisJob={new Set(p.members.map((m) => m.id))}
                      busyElsewhere={
                        new Set(
                          preview.proposals
                            .filter((o) => o.choreId !== p.choreId)
                            .flatMap((o) => o.members.map((m) => m.id)),
                        )
                      }
                      onPick={(m) => addMember(p.choreId, m)}
                      onClose={() => setPickerChoreId(null)}
                    />
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
            {preview.creditSpends.length > 0 && (
              <ExemptLine
                label="Credits spent"
                names={preview.creditSpends.map((c) => c.name)}
                hint="one credit each on publish; back in the draw next month"
              />
            )}
            {preview.absentNames.length > 0 && (
              <ExemptLine
                label="Absent"
                names={preview.absentNames}
                hint="exempt, no credit spent; back in the draw next month"
              />
            )}
            {preview.officerNames.length > 0 && (
              <ExemptLine
                label="Officers"
                names={preview.officerNames}
                hint="exempt while they hold officer status"
              />
            )}
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {preview.warnings.map((w, i) => (
                <li key={i} className="text-xs text-danger">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={publish}
              disabled={pending}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending ? "Publishing…" : `Publish ${monthLabel(month)}`}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={pending}
              className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted transition active:scale-[0.98] disabled:opacity-60"
            >
              Discard draft
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The "＋" list: every active member except officers, searchable, tap to add.
 * Anyone already holding a job in this draft sorts to the bottom and says so —
 * the algorithm never hands out two, so adding them is a deliberate override.
 * Absent members and credit holders are listed but tagged for the same reason.
 */
function MemberPicker({
  members,
  onThisJob,
  busyElsewhere,
  onPick,
  onClose,
}: {
  members: { id: string; name: string; note: "absent" | "credit" | null }[];
  /** Already on this job — hidden from the list. */
  onThisJob: Set<string>;
  /** Holding some other job in this draft — listed last, flagged. */
  busyElsewhere: Set<string>;
  onPick: (member: { id: string; name: string }) => void;
  onClose: () => void;
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
    <div className="select-text border-t border-border px-3 py-2.5">
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
        Done
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
        <NameList
          label="No job"
          names={none.map((r) => r.name)}
        />
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
