import Link from "next/link";
import { monthLabel, studioDayKey } from "@/lib/studio";

export type DayMarker = {
  /** Small count badge (e.g. sign-ins that day). */
  count?: number;
  /** Accent dots for up to 3 items (e.g. events). */
  dots?: number;
};

/**
 * Server-rendered month grid. Day cells are links (searchParam navigation)
 * so the pages using it stay server components. `month` is "YYYY-MM-01".
 */
export function MonthGrid({
  month,
  markers = {},
  selectedDay,
  hrefForDay,
  prevHref,
  nextHref,
}: {
  month: string;
  markers?: Record<string, DayMarker>;
  selectedDay?: string;
  hrefForDay: (dayKey: string) => string;
  prevHref: string;
  nextHref: string;
}) {
  const [y, m] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const todayKey = studioDayKey();

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    ),
  ];

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <Link
          href={prevHref}
          aria-label="Previous month"
          className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm text-muted transition active:scale-[0.97]"
        >
          ←
        </Link>
        <span className="flex-1 text-center text-sm font-semibold">
          {monthLabel(month)}
        </span>
        <Link
          href={nextHref}
          aria-label="Next month"
          className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm text-muted transition active:scale-[0.97]"
        >
          →
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((dayKey, i) => {
          if (!dayKey) return <div key={`blank-${i}`} />;
          const marker = markers[dayKey];
          const selected = dayKey === selectedDay;
          const isToday = dayKey === todayKey;
          return (
            <Link
              key={dayKey}
              href={hrefForDay(dayKey)}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition active:scale-[0.95] ${
                selected
                  ? "border-accent bg-accent/15 font-bold text-accent"
                  : isToday
                    ? "border-accent/50 bg-surface-2 font-semibold"
                    : "border-transparent bg-surface-2/60 hover:border-border"
              }`}
            >
              <span className="tabular-nums leading-none">{Number(dayKey.slice(8))}</span>
              {marker?.count ? (
                <span
                  className={`rounded-full px-1 text-[10px] font-semibold leading-tight tabular-nums ${
                    selected ? "bg-accent text-background" : "bg-accent/20 text-accent"
                  }`}
                >
                  {marker.count}
                </span>
              ) : marker?.dots ? (
                <span className="flex gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(marker.dots, 3) }, (_, d) => (
                    <span key={d} className="h-1 w-1 rounded-full bg-accent" />
                  ))}
                </span>
              ) : (
                <span className="h-1" aria-hidden />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
