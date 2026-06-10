/** Time + duration helpers shared across the app. */

export type Shift = {
  id: string;
  member_id: string;
  signed_in_at: string;
  signed_out_at: string | null;
  source?: string;
};

/** Duration of a shift in milliseconds. Open shifts count up to `now`. */
export function shiftDurationMs(shift: Shift, now: number = Date.now()): number {
  const start = new Date(shift.signed_in_at).getTime();
  const end = shift.signed_out_at ? new Date(shift.signed_out_at).getTime() : now;
  return Math.max(0, end - start);
}

/** Sum of shift durations in hours (decimal). */
export function totalHours(shifts: Shift[], now: number = Date.now()): number {
  const ms = shifts.reduce((acc, s) => acc + shiftDurationMs(s, now), 0);
  return ms / 3_600_000;
}

/** "2h 15m" style label from milliseconds. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** "2.5" style decimal-hours label. */
export function formatHours(hours: number): string {
  return hours.toFixed(1);
}

/** Start of the current week (Monday 00:00 local time). */
export function startOfWeek(d: Date = new Date()): Date {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
