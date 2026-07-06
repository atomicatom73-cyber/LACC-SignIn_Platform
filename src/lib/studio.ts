/**
 * Studio-local time helpers. Chore months and "end of day" sign-outs follow
 * the wall clock in Los Alamos, NM regardless of where the server runs.
 */

export const STUDIO_TZ = "America/Denver";

/** Month key for the studio-local month containing `d`: "YYYY-MM-01". */
export function monthKey(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM
  const ym = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
  }).format(d);
  return `${ym}-01`;
}

/** "2026-07-01" → "July 2026". */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Shift a month key by `n` months (negative allowed). */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Month keys sort lexicographically; convenience comparators. */
export function isPastMonth(key: string, now: Date = new Date()): boolean {
  return key < monthKey(now);
}

/** "2026-07-14T…Z" → e.g. "Jul 14" in studio time. */
export function formatStudioDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: STUDIO_TZ,
    month: "short",
    day: "numeric",
  });
}

function studioOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * Convert a studio-local date + time ("YYYY-MM-DD", "HH:MM") to a UTC ISO
 * string, correctly across DST changes.
 */
export function studioToUtcIso(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = studioOffsetMs(new Date(utcGuess));
  let result = utcGuess - offset;
  const offset2 = studioOffsetMs(new Date(result));
  if (offset2 !== offset) result = utcGuess - offset2;
  return new Date(result).toISOString();
}

/** UTC ISO → studio-local {date: "YYYY-MM-DD", time: "HH:MM"} for form inputs. */
export function studioDateTimeParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: STUDIO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}

/** Full event date-time label in studio time, e.g. "Sat, Jul 14 · 5:30 PM". */
export function formatStudioDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    timeZone: STUDIO_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: STUDIO_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}
