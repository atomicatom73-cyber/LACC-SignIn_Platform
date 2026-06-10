import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatClock,
  formatDay,
  formatDuration,
  formatHours,
  shiftDurationMs,
  startOfWeek,
  totalHours,
  type Shift,
} from "@/lib/time";
import { Wordmark } from "@/components/Brand";
import { ClockCard } from "./ClockCard";
import { ProfileSetup } from "./ProfileSetup";
import { signOutAuth } from "./actions";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("user_id", user.id)
    .single();

  if (!member) {
    return <ProfileSetup />;
  }

  const { data: shiftsData } = await supabase
    .from("shifts")
    .select("id, member_id, signed_in_at, signed_out_at, source")
    .eq("member_id", member.id)
    .order("signed_in_at", { ascending: false });

  const shifts: Shift[] = shiftsData ?? [];
  const open = shifts.find((s) => s.signed_out_at === null) ?? null;

  const weekStart = startOfWeek().getTime();
  const weekShifts = shifts.filter(
    (s) => new Date(s.signed_in_at).getTime() >= weekStart,
  );

  const firstName = member.full_name.split(" ")[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <form action={signOutAuth}>
          <button className="text-sm text-muted">Log out</button>
        </form>
      </header>

      <div className="mt-8">
        <h1 className="text-2xl font-bold tracking-tight">Hi, {firstName} 👋</h1>
      </div>

      <div className="mt-5">
        <ClockCard openSince={open ? open.signed_in_at : null} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Stat label="This week" value={`${formatHours(totalHours(weekShifts))} h`} />
        <Stat label="All time" value={`${formatHours(totalHours(shifts))} h`} />
      </div>

      <section className="mt-8 flex-1">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Recent
        </h2>
        {shifts.length === 0 ? (
          <p className="text-sm text-muted">
            No shifts yet — clock in to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shifts.slice(0, 12).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">
                    {formatDay(s.signed_in_at)}
                  </div>
                  <div className="text-xs text-muted">
                    {formatClock(s.signed_in_at)} –{" "}
                    {s.signed_out_at ? formatClock(s.signed_out_at) : "now"}
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums">
                  {s.signed_out_at ? (
                    formatDuration(shiftDurationMs(s))
                  ) : (
                    <span className="text-success">open</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
