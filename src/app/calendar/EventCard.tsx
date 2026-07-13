import { formatStudioDateTime, STUDIO_TZ } from "@/lib/studio";
import { eventDaySpan } from "@/lib/events";
import type { StudioEvent } from "@/lib/types";

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

/** "2026-07-06" → "Mon, Jul 6" (calendar date, timezone-free). */
function dayKeyLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * One calendar event, read-only. Events come from the studio's Google calendar
 * (mirrored into the DB) — there is no in-app editing. For a recurring
 * occurrence pass `occursAtIso` so the card shows this day's date; a multi-day
 * span (e.g. a camp) shows its full date range regardless.
 */
export function EventCard({
  event,
  occursAtIso,
}: {
  event: StudioEvent;
  occursAtIso?: string;
}) {
  const whenIso = occursAtIso ?? event.starts_at;
  const span = eventDaySpan(event);

  return (
    <article className="rounded-2xl border border-border bg-surface px-4 py-4">
      {event.recurrence !== "none" && (
        <span className="inline-block rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
          🔁 {RECURRENCE_LABEL[event.recurrence]}
        </span>
      )}

      <h3
        className={`text-base font-semibold ${event.recurrence !== "none" ? "mt-2" : ""}`}
      >
        {event.title}
      </h3>

      <div className="mt-1 text-sm text-muted">
        {span.isMultiDay ? (
          `${dayKeyLabel(span.startKey)} – ${dayKeyLabel(span.endKey)}`
        ) : event.all_day ? (
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
