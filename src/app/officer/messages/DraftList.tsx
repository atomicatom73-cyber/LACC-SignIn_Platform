"use client";

import { useState, useTransition } from "react";
import { AUDIENCE_LABELS, type ComposeAudience } from "@/lib/messages";
import { formatStudioDateTime } from "@/lib/studio";
import { deleteDraft, sendDraftNow } from "./actions";
import type { ComposeInitial } from "./ComposeForm";

export type DraftSummary = {
  id: string;
  subject: string;
  body: string;
  audience: ComposeAudience;
  recipientIds: string[] | null;
  recipientCount: number | null;
  scheduledFor: string | null;
  sendError: string | null;
  updatedAt: string;
};

/**
 * The officer's own unsent work — saved drafts and anything scheduled. Private
 * to the account that wrote them (RLS enforces it; a shared login shares its
 * drafts, same as it shares everything else).
 */
export function DraftList({
  drafts,
  onEdit,
}: {
  drafts: DraftSummary[];
  onEdit: (initial: ComposeInitial) => void;
}) {
  if (drafts.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing saved — “Save draft” and “Send later” park messages here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {drafts.map((draft) => (
        <DraftRow key={draft.id} draft={draft} onEdit={onEdit} />
      ))}
    </ul>
  );
}

function DraftRow({
  draft,
  onEdit,
}: {
  draft: DraftSummary;
  onEdit: (initial: ComposeInitial) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = (job: () => Promise<{ error: string } | unknown>) => {
    setError(null);
    startTransition(async () => {
      const res = await job();
      if (res && typeof res === "object" && "error" in res) {
        setError((res as { error: string }).error);
      }
    });
  };

  return (
    <li className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">
          {draft.scheduledFor
            ? `🗓 ${formatStudioDateTime(draft.scheduledFor)}`
            : "Draft"}
        </span>
        <span className="shrink-0 text-xs text-muted">
          saved {formatStudioDateTime(draft.updatedAt)}
        </span>
      </div>

      <div className="mt-1 font-semibold">
        {draft.subject || <span className="text-muted">(no subject)</span>}
      </div>
      {draft.body && (
        <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-foreground/90">
          {draft.body}
        </p>
      )}

      <div className="mt-2 text-xs text-muted">
        {AUDIENCE_LABELS[draft.audience]}
        {draft.recipientCount !== null && ` · ${draft.recipientCount} picked`}
      </div>

      {draft.sendError && (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          Last send failed: {draft.sendError}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            onEdit({
              draftId: draft.id,
              subject: draft.subject,
              body: draft.body,
              audience: draft.audience,
              recipientIds: draft.recipientIds,
            })
          }
          className="rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted transition active:scale-[0.97]"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => sendDraftNow(draft.id))}
          className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition active:scale-[0.97] disabled:opacity-60"
        >
          {pending ? "…" : "Send now"}
        </button>
        {confirmingDelete ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteDraft(draft.id))}
            className="rounded-xl border border-danger/50 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition active:scale-[0.97] disabled:opacity-60"
          >
            Really delete?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-danger transition active:scale-[0.97]"
          >
            Delete
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  );
}
