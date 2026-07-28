/** Shared display helpers for job intervals (see ChoreInterval in types). */

import { studioToUtcIso } from "./studio";
import type { ChoreInterval } from "./types";

/** Options for the interval <select> in the add/edit job forms. */
export const INTERVAL_OPTIONS: { value: ChoreInterval; label: string }[] = [
  { value: "month", label: "Full month · due end of month" },
  { value: "first_half", label: "First half · due the 15th" },
  { value: "second_half", label: "Second half · due end of month" },
];

/** Short chip text for a job card; null for the full-month default. */
export function intervalBadge(interval: ChoreInterval): string | null {
  if (interval === "first_half") return "1st half · due the 15th";
  if (interval === "second_half") return "2nd half · due end of month";
  return null;
}

/** "due the 15th" / "due end of the month" — for reminders and member cards. */
export function dueLabel(interval: ChoreInterval): string {
  return interval === "first_half" ? "due the 15th" : "due end of the month";
}

/**
 * Validate one "when will you do it?" form submission (a studio-local date and
 * time from a pair of <input>s). Returns the UTC instant to store, null when
 * the date is blank (clear the appointment), or an error for the form.
 *
 * A blank time defaults to 9:00 AM rather than midnight — "the 8th" almost
 * never means the small hours of the 8th.
 */
export function parseSchedule(
  date: string,
  time: string,
): string | null | { error: string } {
  const day = date.trim();
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Pick a valid date." };
  const clock = time.trim() || "09:00";
  if (!/^\d{2}:\d{2}$/.test(clock)) return { error: "Pick a valid time." };
  return studioToUtcIso(day, clock);
}
