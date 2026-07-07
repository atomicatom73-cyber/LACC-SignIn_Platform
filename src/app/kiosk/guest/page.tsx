import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/Brand";
import { GuestForm, type HostOption } from "./GuestForm";

export const dynamic = "force-dynamic";

/** Kiosk guest sign-in: guests always come in with a signed-in member. */
export default async function KioskGuestPage() {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("shifts")
    .select("member_id, members(id, full_name)")
    .is("signed_out_at", null);

  const hosts: HostOption[] = (
    (data ?? []) as unknown as {
      members: { id: string; full_name: string } | null;
    }[]
  )
    .flatMap((row) => (row.members ? [row.members] : []))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/kiosk" className="inline-block text-sm text-muted">
        ← Back to quick sign in
      </Link>

      <div className="mb-6 mt-6 flex flex-col items-center text-center">
        <Logo className="mb-4 h-12 w-12 text-lg" />
        <h1 className="text-2xl font-bold tracking-tight">Bring a guest</h1>
        <p className="mt-2 text-sm text-muted">
          Guests are welcome with a member! Sign them in below — there&apos;s a
          small visit fee, payable by card or at the cash box.
        </p>
      </div>

      <GuestForm hosts={hosts} />
    </main>
  );
}
