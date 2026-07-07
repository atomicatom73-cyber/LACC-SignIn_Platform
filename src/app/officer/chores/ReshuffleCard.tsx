"use client";

import { useRef, useState, useTransition } from "react";
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

/**
 * One-click monthly draft: runs the credit-aware algorithm, shows the
 * proposal for review (members can be trimmed or dragged between jobs),
 * then publishes it.
 */
export function ReshuffleCard({ month }: { month: string }) {
  const [preview, setPreview] = useState<ReshufflePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
  // move/up keep firing on it while we hit-test the card under the finger.
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
      }
    });

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Monthly reshuffle</h2>
          <p className="mt-0.5 text-xs text-muted">
            Draft {monthLabel(month)}: skips absences, spends credits, avoids
            repeats, spreads the load. Nothing is saved until you publish.
          </p>
        </div>
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
            Drag a name onto another job to move it; tap ✕ to remove it.
          </p>
          <ul className="flex select-none flex-col gap-2">
            {preview.proposals.map((p) => (
              <li
                key={p.choreId}
                data-chore-id={p.choreId}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  drag?.started &&
                  overChoreId === p.choreId &&
                  p.choreId !== drag.fromChoreId
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface-2"
                }`}
              >
                <div className="text-sm font-medium">{p.choreName}</div>
                {p.members.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    Nobody — fill manually, or drag a name here.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
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
              </li>
            ))}
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

          {preview.creditSpends.length > 0 && (
            <p className="mt-3 text-sm">
              <span className="font-medium text-accent">Credits spent:</span>{" "}
              {preview.creditSpends.map((c) => c.name).join(", ")}
            </p>
          )}
          {preview.absentNames.length > 0 && (
            <p className="mt-1 text-sm text-muted">
              Absent (exempt, no credit): {preview.absentNames.join(", ")}
            </p>
          )}
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
