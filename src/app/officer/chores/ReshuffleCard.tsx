"use client";

import { useState, useTransition } from "react";
import { monthLabel } from "@/lib/studio";
import {
  previewReshuffle,
  publishReshuffle,
  type ReshufflePreview,
} from "./actions";

/**
 * One-click monthly draft: runs the credit-aware algorithm, shows the
 * proposal for review (members can be trimmed), then publishes it.
 */
export function ReshuffleCard({ month }: { month: string }) {
  const [preview, setPreview] = useState<ReshufflePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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

          <ul className="flex flex-col gap-2">
            {preview.proposals.map((p) => (
              <li
                key={p.choreId}
                className="rounded-xl border border-border bg-surface-2 px-3 py-2.5"
              >
                <div className="text-sm font-medium">{p.choreName}</div>
                {p.members.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">Nobody — fill manually.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.members.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => dropMember(p.choreId, m.id)}
                        disabled={pending}
                        title="Remove from draft"
                        className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs transition active:scale-[0.97] disabled:opacity-60"
                      >
                        {m.name} <span className="text-muted">✕</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

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
