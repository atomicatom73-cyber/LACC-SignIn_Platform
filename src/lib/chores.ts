/** Shared display helpers for job intervals (see ChoreInterval in types). */

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
