/** Recurring-event expansion for the calendar grid. */

import { studioDateTimeParts, studioDayKey, studioToUtcIso } from "./studio";
import type { StudioEvent } from "./types";

export type EventOccurrence = {
  event: StudioEvent;
  dayKey: string; // "YYYY-MM-DD" studio-local
  startsAtIso: string; // UTC instant of this occurrence
};

/** "2026-07-31" → "2026-08-01" (calendar arithmetic, timezone-free). */
function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Expand events into their occurrences within one studio-local month
 * ("YYYY-MM-01"). The stored row is the first occurrence; daily/weekly/
 * monthly rules repeat it (monthly = same day-of-month, skipped when the
 * month is shorter). Occurrences keep the original studio wall-clock time,
 * which stays stable across DST changes.
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
      // An all-day event carries an exclusive end; a multi-day span (e.g. a
      // camp) shows on every day it covers. Each day gets its own midnight
      // instant so cards display that day's date, not the first day's.
      if (event.all_day && event.ends_at) {
        const endDay = studioDayKey(event.ends_at); // exclusive
        let day = baseDay;
        for (let guard = 0; day < endDay && guard < 400; guard++) {
          if (day.startsWith(ym)) {
            push({
              event,
              dayKey: day,
              startsAtIso:
                day === baseDay ? event.starts_at : studioToUtcIso(day, "00:00"),
            });
          }
          day = nextDayKey(day);
        }
        continue;
      }
      if (baseDay.startsWith(ym)) {
        push({ event, dayKey: baseDay, startsAtIso: event.starts_at });
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
      });
    }
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
  }
  return byDay;
}
