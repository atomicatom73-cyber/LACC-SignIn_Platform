import { requireOfficer } from "@/lib/auth";
import { MonthGrid, type DayMarker } from "@/components/MonthGrid";
import {
  addMonths,
  dayLabel,
  formatStudioClock,
  monthKey,
  studioDayKey,
  studioToUtcIso,
} from "@/lib/studio";

export const dynamic = "force-dynamic";

type LogEntry = {
  at: string;
  kind: "member" | "guest" | "student";
  title: string;
  detail: string;
};

type ShiftRow = {
  id: string;
  signed_in_at: string;
  signed_out_at: string | null;
  source: string;
  members: { full_name: string } | null;
};
type GuestRow = {
  id: string;
  guest_name: string;
  signed_in_at: string;
  members: { full_name: string } | null;
};
type StudentRow = {
  id: string;
  student_name: string;
  class_label: string;
  signed_in_at: string;
};

/** Who was in the studio, day by day. President + vice president only. */
export default async function SignInLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string }>;
}) {
  const { supabase } = await requireOfficer(["president", "vice_president"]);

  const { month: rawMonth, day: rawDay } = await searchParams;
  const currentMonth = monthKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? "")
    ? `${rawMonth}-01`
    : currentMonth;
  const ym = month.slice(0, 7);

  const todayKey = studioDayKey();
  const day =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDay ?? "") && rawDay!.startsWith(ym)
      ? rawDay!
      : month === currentMonth
        ? todayKey
        : `${ym}-01`;

  // Studio-local month bounds as UTC instants.
  const startUtc = studioToUtcIso(`${ym}-01`, "00:00");
  const endUtc = studioToUtcIso(`${addMonths(month, 1).slice(0, 7)}-01`, "00:00");

  const [shiftsRes, guestsRes, studentsRes] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, signed_in_at, signed_out_at, source, members(full_name)")
      .gte("signed_in_at", startUtc)
      .lt("signed_in_at", endUtc)
      .order("signed_in_at", { ascending: true }),
    supabase
      .from("guest_signins")
      .select("id, guest_name, signed_in_at, members(full_name)")
      .gte("signed_in_at", startUtc)
      .lt("signed_in_at", endUtc),
    supabase
      .from("student_signins")
      .select("id, student_name, class_label, signed_in_at")
      .gte("signed_in_at", startUtc)
      .lt("signed_in_at", endUtc),
  ]);

  const shifts = (shiftsRes.data ?? []) as unknown as ShiftRow[];
  const guests = (guestsRes.data ?? []) as unknown as GuestRow[];
  const students = (studentsRes.data ?? []) as unknown as StudentRow[];

  const entriesByDay = new Map<string, LogEntry[]>();
  const push = (entry: LogEntry) => {
    const key = studioDayKey(entry.at);
    const list = entriesByDay.get(key) ?? [];
    list.push(entry);
    entriesByDay.set(key, list);
  };

  for (const s of shifts) {
    push({
      at: s.signed_in_at,
      kind: "member",
      title: s.members?.full_name ?? "Unknown member",
      detail: `${formatStudioClock(s.signed_in_at)} – ${
        s.signed_out_at ? formatStudioClock(s.signed_out_at) : "still in"
      }${s.source === "kiosk" ? "" : " · phone"}`,
    });
  }
  for (const g of guests) {
    push({
      at: g.signed_in_at,
      kind: "guest",
      title: `${g.guest_name} (guest of ${g.members?.full_name ?? "unknown"})`,
      detail: formatStudioClock(g.signed_in_at),
    });
  }
  for (const s of students) {
    push({
      at: s.signed_in_at,
      kind: "student",
      title: `${s.student_name} — ${s.class_label}`,
      detail: formatStudioClock(s.signed_in_at),
    });
  }

  const markers: Record<string, DayMarker> = {};
  for (const [key, list] of entriesByDay) {
    markers[key] = { count: list.length };
  }

  const dayEntries = (entriesByDay.get(day) ?? []).sort((a, b) =>
    a.at.localeCompare(b.at),
  );

  const KIND_BADGE: Record<LogEntry["kind"], string> = {
    member: "",
    guest: "🍰",
    student: "🎓",
  };

  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1).slice(0, 7);

  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">Sign-in logs</h1>
      <p className="mt-1 text-muted">
        Tap a day to see who was in the studio — members, guests, and
        students.
      </p>

      <div className="mt-5">
        <MonthGrid
          month={month}
          markers={markers}
          selectedDay={day}
          hrefForDay={(d) => `/officer/logs?month=${ym}&day=${d}`}
          prevHref={`/officer/logs?month=${prev}`}
          nextHref={`/officer/logs?month=${next}`}
        />
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          {dayLabel(day)}
          {day === todayKey && (
            <span className="ml-2 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              today
            </span>
          )}
        </h2>

        {dayEntries.length === 0 ? (
          <p className="text-sm text-muted">No sign-ins on this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayEntries.map((entry, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {KIND_BADGE[entry.kind] && (
                    <span aria-hidden>{KIND_BADGE[entry.kind]}</span>
                  )}
                  <span className="truncate text-sm font-medium">
                    {entry.title}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {entry.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
