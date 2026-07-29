import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Wordmark } from "@/components/Brand";
import { ServerClock } from "@/components/ServerClock";
import { InStudioCount } from "./InStudioCount";
import { RosterGrid, type RosterMember } from "./RosterGrid";

export const dynamic = "force-dynamic";

export default async function KioskPage() {
  const supabase = createAdminClient();

  // Anyone who forgot to sign out stays signed in until end of that day.
  await supabase.rpc("close_stale_shifts");

  const { data: members } = await supabase
    .from("members")
    .select("id, full_name, pin, user_id")
    .eq("active", true)
    .eq("role", "member") // shared officer logins aren't people in the studio
    .order("full_name");

  const { data: openShifts } = await supabase
    .from("shifts")
    .select("member_id, signed_in_at")
    .is("signed_out_at", null);

  const openByMember = new Map(
    (openShifts ?? []).map((s) => [s.member_id, s.signed_in_at]),
  );

  // Only a has-PIN flag goes to the client — never the PIN itself. Members
  // without a login account can't sign in until they create one (hasAccount).
  // Whoever's currently in the studio floats to the top (alphabetical within
  // each group — the query pre-sorts by name and the sort is stable).
  const roster: RosterMember[] = (members ?? [])
    .map((m) => ({
      id: m.id,
      full_name: m.full_name,
      hasPin: Boolean(m.pin),
      hasAccount: Boolean(m.user_id),
      openSince: openByMember.get(m.id) ?? null,
    }))
    .sort(
      (a, b) => Number(b.openSince !== null) - Number(a.openSince !== null),
    );

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 py-6">
      {/* Measures tablet-vs-server clock drift for the offline queue. */}
      <ServerClock />
      <header className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-4">
          <InStudioCount members={roster} />
          <Link href="/" className="text-sm text-muted">
            ← Back
          </Link>
        </div>
      </header>

      <div className="mt-6">
        <h1 className="text-2xl font-bold tracking-tight">Quick sign in</h1>
        <p className="mt-1 text-muted">
          Find your name and tap it to sign in — tap your name again to sign
          out.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          href="/kiosk/guest"
          className="rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm font-semibold transition active:scale-[0.98]"
        >
          🍰 Bring a guest
        </Link>
        <Link
          href="/kiosk/student"
          className="rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm font-semibold transition active:scale-[0.98]"
        >
          🎓 Sign in as student
        </Link>
      </div>

      <div className="mt-6 flex-1">
        <RosterGrid members={roster} />
      </div>
    </main>
  );
}
