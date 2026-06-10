import { createAdminClient } from "@/lib/supabase/admin";
import { Wordmark } from "@/components/Brand";
import { PinGate } from "./PinGate";
import { RosterGrid, type RosterMember } from "./RosterGrid";
import { isKioskUnlocked, lockKiosk } from "./actions";

export const dynamic = "force-dynamic";

export default async function KioskPage() {
  if (!(await isKioskUnlocked())) {
    return <PinGate />;
  }

  const supabase = createAdminClient();

  const { data: members } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name");

  const { data: openShifts } = await supabase
    .from("shifts")
    .select("member_id, signed_in_at")
    .is("signed_out_at", null);

  const openByMember = new Map(
    (openShifts ?? []).map((s) => [s.member_id, s.signed_in_at]),
  );

  const roster: RosterMember[] = (members ?? []).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    openSince: openByMember.get(m.id) ?? null,
  }));

  const inCount = roster.filter((m) => m.openSince !== null).length;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-4">
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted">
            <span className="font-semibold text-success">{inCount}</span> in the
            studio
          </span>
          <form action={lockKiosk}>
            <button className="text-sm text-muted">Lock</button>
          </form>
        </div>
      </header>

      <div className="mt-6">
        <h1 className="text-2xl font-bold tracking-tight">Who&apos;s here?</h1>
        <p className="mt-1 text-muted">Tap your name to sign in or out.</p>
      </div>

      <div className="mt-6 flex-1">
        <RosterGrid members={roster} />
      </div>
    </main>
  );
}
