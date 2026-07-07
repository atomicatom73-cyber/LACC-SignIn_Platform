import Link from "next/link";
import { monthLabel, studioDayKey } from "@/lib/studio";

export type DayMarker = {
  /** Small count badge (e.g. sign-ins that day). */
  count?: number;
  /** Accent dots for up to 3 items (e.g. events). */
  dots?: number;
  /**
   * Event titles for the day. On sm+ screens the cell grows and shows them
   * inline so the month is readable without tapping; phones keep the dots
   * (cells are too small for text there).
   */
  labels?: string[];
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
  const hasLabels = Object.values(markers).some((mk) => mk.labels?.length);

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
          const labels = marker?.labels ?? [];
          return (
            <Link
              key={dayKey}
              href={hrefForDay(dayKey)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-xl border text-sm transition active:scale-[0.95] ${
                hasLabels
                  ? "aspect-square sm:aspect-auto sm:min-h-20 sm:justify-start sm:gap-1 sm:p-1"
                  : "aspect-square"
              } ${
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
              ) : labels.length > 0 ? (
                <>
                  <span
                    className={`flex gap-0.5 ${hasLabels ? "sm:hidden" : ""}`}
                    aria-hidden
                  >
                    {Array.from({ length: Math.min(labels.length, 3) }, (_, d) => (
                      <span key={d} className="h-1 w-1 rounded-full bg-accent" />
                    ))}
                  </span>
                  <span className="hidden w-full min-w-0 flex-col gap-0.5 sm:flex">
                    {labels.slice(0, 2).map((label, d) => (
                      <span
                        key={d}
                        className="truncate rounded bg-accent/15 px-1 text-[10px] font-medium leading-tight text-accent"
                      >
                        {label}
                      </span>
                    ))}
                    {labels.length > 2 && (
                      <span className="px-1 text-[9px] leading-tight text-muted">
                        +{labels.length - 2} more
                      </span>
                    )}
                  </span>
                </>
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
