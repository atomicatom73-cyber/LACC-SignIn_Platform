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
  const [openChoreId, setOpenChoreId] = useState<string | null>(null);
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
        setOpenChoreId(null);
      }
    });

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
  const coverage: Coverage[] = preview
    ? preview.eligibleMembers.map((m) => ({
        id: m.id,
        name: m.name,
        jobs: preview.proposals.filter((p) =>
          p.members.some((x) => x.id === m.id),
        ).length,
      }))
    : published;

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
        are spent on publish), repeats are avoided, and the load is spread by
        half-month. Nothing is saved until you publish — so future months can be
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

          <p className="mb-2 text-xs text-muted">
            Tap a job to see who&apos;s on it. Drag a name onto another job to
            move it — closed jobs accept drops too.
          </p>
          <ul className="flex select-none flex-col gap-1.5">
            {preview.proposals.map((p) => {
              const open = openChoreId === p.choreId;
              const short = p.members.length < p.slots;
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
                  <button
                    type="button"
                    onClick={() => setOpenChoreId(open ? null : p.choreId)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    <span className="w-3 shrink-0 text-xs text-muted">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {p.choreName}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        short ? "text-danger" : "text-success"
                      }`}
                    >
                      {p.members.length}/{p.slots}
                      {short ? " ⚠" : " ✓"}
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3">
                      {p.members.length === 0 ? (
                        <p className="text-xs text-muted">
                          Nobody — drag a name here, or assign it by hand below.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
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
                        </div>
                      )}
                    </div>
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
