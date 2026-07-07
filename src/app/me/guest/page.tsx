import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { Logo } from "@/components/Brand";
import { MyGuestForm } from "./MyGuestForm";

export const dynamic = "force-dynamic";

/** Guest sign-in from the member's account. Requires being clocked in. */
export default async function MyGuestPage() {
  const { supabase, member } = await requireMember();

  const openShift = member
    ? (
        await supabase
          .from("shifts")
          .select("id")
          .eq("member_id", member.id)
          .is("signed_out_at", null)
          .maybeSingle()
      ).data
    : null;

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/me" className="inline-block text-sm text-muted">
        ← Back
      </Link>

      <div className="mb-6 mt-6 flex flex-col items-center text-center">
        <Logo className="mb-4 h-12 w-12 text-lg" />
        <h1 className="text-2xl font-bold tracking-tight">Bring a guest</h1>
        <p className="mt-2 text-sm text-muted">
          Guests are welcome with a member! Sign them in below — there&apos;s a
          small visit fee, payable by card or at the cash box.
        </p>
      </div>

      {openShift ? (
        <MyGuestForm />
      ) : (
        <div className="rounded-2xl border border-border bg-surface px-5 py-6 text-center">
          <p className="font-medium">You&apos;re not clocked in.</p>
          <p className="mt-2 text-sm text-muted">
            Guests come in with a member — clock in first, then bring your
            guest.
          </p>
          <Link
            href="/me"
            className="mt-4 inline-block rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-background transition active:scale-[0.98]"
          >
            Go clock in
          </Link>
        </div>
      )}
    </main>
  );
}
