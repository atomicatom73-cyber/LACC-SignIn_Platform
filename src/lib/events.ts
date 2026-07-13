/** Recurring-event expansion for the calendar grid. */

import { studioDateTimeParts, studioToUtcIso } from "./studio";
import type { StudioEvent } from "./types";

export type EventOccurrence = {
  event: StudioEvent;
  dayKey: string; // "YYYY-MM-DD" studio-local
  startsAtIso: string; // UTC instant of this occurrence
  /** Studio-local first and inclusive-last day of the whole span. */
  spanStartKey: string;
  spanEndKey: string;
  /** Spans more than one studio-local day (e.g. a week-long camp). */
  isMultiDay: boolean;
};

/** "2026-07-31" → "2026-08-01" (calendar arithmetic, timezone-free). */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** "2026-08-01" → "2026-07-31" (calendar arithmetic, timezone-free). */
function prevDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Inclusive studio-local day range a non-recurring event covers. An end at
 * exactly studio-local midnight is treated as exclusive — that is both the
 * all-day convention (Google's `end.date` is the morning after the last day)
 * and the natural reading of a timed event ending at 00:00 (it belongs to the
 * previous day). So a camp stored as Mon 08:45 → Fri 12:15 spans Mon–Fri, and
 * an all-day span Jul 6 → Jul 11 (exclusive) spans Jul 6–10.
 */
export function eventDaySpan(event: StudioEvent): {
  startKey: string;
  endKey: string;
  isMultiDay: boolean;
} {
  const startKey = studioDateTimeParts(event.starts_at).date;
  if (!event.ends_at) return { startKey, endKey: startKey, isMultiDay: false };
  const end = studioDateTimeParts(event.ends_at);
  let endKey = end.time === "00:00" ? prevDayKey(end.date) : end.date;
  if (endKey < startKey) endKey = startKey;
  return { startKey, endKey, isMultiDay: endKey > startKey };
}

/**
 * Expand events into their occurrences within one studio-local month
 * ("YYYY-MM-01"). The stored row is the first occurrence; daily/weekly/
 * monthly rules repeat it (monthly = same day-of-month, skipped when the
 * month is shorter). Occurrences keep the original studio wall-clock time,
 * which stays stable across DST changes. A multi-day span (all-day or timed,
 * e.g. a week-long camp) yields one occurrence per day it covers.
 */
export function occurrencesByDay(
  events: StudioEvent[],
  month: string,
): Map<string, EventOccurrence[]> {
  const ym = month.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const byDay = new Map<string, EventOccurrence[]>();
  const push = (occ: EventOccurrence) => {
    const list = byDay.get(occ.dayKey) ?? [];
    list.push(occ);
    byDay.set(occ.dayKey, list);
  };

  for (const event of events) {
    const base = studioDateTimeParts(event.starts_at);
    const baseDay = base.date;

    if (event.recurrence === "none") {
      const { startKey, endKey, isMultiDay } = eventDaySpan(event);

      if (isMultiDay) {
        // Show a multi-day span on every day it covers. Each day gets its own
        // midnight instant so a day card reflects that day, not the first day.
        let day = startKey;
        for (let guard = 0; day <= endKey && guard < 400; guard++) {
          if (day.startsWith(ym)) {
            push({
              event,
              dayKey: day,
              startsAtIso:
                day === startKey ? event.starts_at : studioToUtcIso(day, "00:00"),
              spanStartKey: startKey,
              spanEndKey: endKey,
              isMultiDay: true,
            });
          }
          day = nextDayKey(day);
        }
        continue;
      }

      if (baseDay.startsWith(ym)) {
        push({
          event,
          dayKey: baseDay,
          startsAtIso: event.starts_at,
          spanStartKey: startKey,
          spanEndKey: endKey,
          isMultiDay: false,
        });
      }
      continue;
    }

    const [by, bm, bd] = baseDay.split("-").map(Number);
    const baseDow = new Date(Date.UTC(by, bm - 1, bd)).getUTCDay();

    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${ym}-${String(d).padStart(2, "0")}`;
      if (dayKey < baseDay) continue;

      const matches =
        event.recurrence === "daily" ||
        (event.recurrence === "weekly" &&
          new Date(Date.UTC(y, m - 1, d)).getUTCDay() === baseDow) ||
        (event.recurrence === "monthly" && d === bd);
      if (!matches) continue;

      push({
        event,
        dayKey,
        startsAtIso:
          dayKey === baseDay ? event.starts_at : studioToUtcIso(dayKey, base.time),
        spanStartKey: dayKey,
        spanEndKey: dayKey,
        isMultiDay: false,
      });
    }
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
  }
  return byDay;
}
