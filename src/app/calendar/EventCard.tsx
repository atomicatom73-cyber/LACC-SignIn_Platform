import { formatStudioDateTime, STUDIO_TZ } from "@/lib/studio";
import type { EventCategory, StudioEvent } from "@/lib/types";

const CATEGORY_CHIPS: Record<EventCategory, { label: string; className: string }> = {
  class: { label: "Class", className: "bg-accent/15 text-accent" },
  workshop: { label: "Workshop", className: "bg-sky-500/15 text-sky-300" },
  party: { label: "Party", className: "bg-pink-500/15 text-pink-300" },
  camp: { label: "Camp", className: "bg-success/15 text-success" },
  meeting: { label: "Meeting", className: "bg-violet-500/15 text-violet-300" },
  other: { label: "Other", className: "bg-surface-2 text-muted" },
};

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  monthly: "Repeats monthly",
};

/** "…Z" → e.g. "7:30 PM" in studio time (for the end of a timed event). */
function endClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: STUDIO_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "…Z" → e.g. "Thu, Jul 16" in studio time (for all-day events). */
function allDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: STUDIO_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * One calendar event, read-only. Events come from the studio's Google calendar
 * (mirrored into the DB) — there is no in-app editing. For a recurring or
 * multi-day occurrence pass `occursAtIso` so the card shows this day's date.
 */
export function EventCard({
  event,
  occursAtIso,
}: {
  event: StudioEvent;
  occursAtIso?: string;
}) {
  const chip = CATEGORY_CHIPS[event.category] ?? CATEGORY_CHIPS.other;
  const whenIso = occursAtIso ?? event.starts_at;

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
        {event.all_day ? (
          `${allDayLabel(whenIso)} · All day`
        ) : (
          <>
            {formatStudioDateTime(whenIso)}
            {event.ends_at ? ` – ${endClock(event.ends_at)}` : null}
          </>
        )}
      </div>

      {event.location && (
        <div className="mt-1 text-sm text-muted">📍 {event.location}</div>
      )}

      {event.description && (
        <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">
          {event.description}
        </p>
      )}
    </article>
  );
}
