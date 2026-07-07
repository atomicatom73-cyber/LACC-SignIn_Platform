"use client";

import { useEffect, useState, useTransition } from "react";
import { formatStudioDateTime, STUDIO_TZ } from "@/lib/studio";
import type { EventCategory, StudioEvent } from "@/lib/types";
import { deleteEvent } from "./actions";
import { EventForm } from "./EventForm";

const CATEGORY_CHIPS: Record<EventCategory, { label: string; className: string }> = {
  class: { label: "Class", className: "bg-accent/15 text-accent" },
  workshop: { label: "Workshop", className: "bg-sky-500/15 text-sky-300" },
  party: { label: "Party", className: "bg-pink-500/15 text-pink-300" },
  camp: { label: "Camp", className: "bg-success/15 text-success" },
  meeting: { label: "Meeting", className: "bg-violet-500/15 text-violet-300" },
  other: { label: "Other", className: "bg-surface-2 text-muted" },
};

/** "…Z" → e.g. "7:30 PM" in studio time (for the end of an event). */
function endClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: STUDIO_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  monthly: "Repeats monthly",
};

/**
 * One calendar event. Officers who manage the calendar get Edit (inline form)
 * and Delete (two-tap confirm) controls. For recurring events pass
 * `occursAtIso` so the card shows this occurrence's date; editing/deleting
 * always affects the whole series.
 */
export function EventCard({
  event,
  occursAtIso,
  canManage,
}: {
  event: StudioEvent;
  occursAtIso?: string;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Confirm state times out so a stray first tap doesn't linger.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  if (editing) {
    return <EventForm event={event} onDone={() => setEditing(false)} />;
  }

  const chip = CATEGORY_CHIPS[event.category] ?? CATEGORY_CHIPS.other;

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const result = await deleteEvent(event.id);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <article className="rounded-2xl border border-border bg-surface px-4 py-4">
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.className}`}
        >
          {chip.label}
        </span>
        {event.recurrence !== "none" && (
          <span className="inline-block rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
            🔁 {RECURRENCE_LABEL[event.recurrence]}
          </span>
        )}
      </span>

      <h3 className="mt-2 text-base font-semibold">{event.title}</h3>

      <div className="mt-1 text-sm text-muted">
        {formatStudioDateTime(occursAtIso ?? event.starts_at)}
        {event.ends_at ? ` – ${endClock(event.ends_at)}` : null}
      </div>

      {event.location && (
        <div className="mt-1 text-sm text-muted">📍 {event.location}</div>
      )}

      {event.description && (
        <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">
          {event.description}
        </p>
      )}

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            onClick={() => setEditing(true)}
            className="rounded-full border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-muted transition active:scale-[0.98]"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={pending}
            className={`rounded-full px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-60 ${
              confirming
                ? "bg-danger text-background"
                : "border border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            {pending
              ? "Deleting…"
              : confirming
                ? "Tap again to delete"
                : "Delete"}
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}
    </article>
  );
}
