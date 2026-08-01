"use client";

import { useState, useTransition } from "react";
import { formatStudioDateTime } from "@/lib/studio";
import { markNoteHandled, reopenNote } from "./actions";

export type DashboardNote = {
  id: string;
  memberName: string;
  choreName: string | null;
  body: string;
  createdAt: string;
  handledAt: string | null;
};

/**
 * Members' notes, front and centre on the coordinator's dashboard. Only the
 * volunteer coordinator sees this card at all (see isVolunteerCoordinator).
 */
export function NotesCard({ notes }: { notes: DashboardNote[] }) {
  const [showHandled, setShowHandled] = useState(false);
  const open = notes.filter((n) => !n.handledAt);
  const handled = notes.filter((n) => n.handledAt);
  const visible = showHandled ? handled : open;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          💬 Member notes
          {open.length > 0 && (
            <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-background">
              {open.length}
            </span>
          )}
        </h2>
        {handled.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHandled((v) => !v)}
            className="text-xs font-medium text-muted underline-offset-2 hover:underline"
          >
            {showHandled
              ? `← Back to open (${open.length})`
              : `Filed (${handled.length})`}
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface px-4 py-4 text-sm text-muted">
          {showHandled
            ? "Nothing filed yet."
            : "No notes right now. Members can write to you from their jobs card."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteRow({ note }: { note: DashboardNote }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const filed = Boolean(note.handledAt);

  const run = (job: () => Promise<{ error: string } | null>) => {
    setError(null);
    startTransition(async () => {
      const res = await job();
      if (res?.error) setError(res.error);
    });
  };

  return (
    <li
      className={`rounded-2xl border px-4 py-4 ${
        filed ? "border-border bg-surface-2 opacity-70" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{note.memberName}</span>
        <span className="text-xs text-muted">
          {formatStudioDateTime(note.createdAt)}
        </span>
      </div>
      {note.choreName && (
        <div className="mt-0.5 text-xs font-medium text-accent">
          {note.choreName}
        </div>
      )}
      <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">
        {note.body}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(() => (filed ? reopenNote(note.id) : markNoteHandled(note.id)))
        }
        className="mt-3 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-muted transition active:scale-[0.97] disabled:opacity-60"
      >
        {pending ? "…" : filed ? "Put back" : "Mark handled"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  );
}
