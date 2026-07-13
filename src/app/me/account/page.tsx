import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { isOfficer } from "@/lib/roles";
import { AccountSettings } from "./AccountSettings";

export const dynamic = "force-dynamic";

export default async function MemberAccountPage() {
  const { supabase, member } = await requireMember();
  if (!member) redirect("/me");
  // Shared officer logins manage themselves from the officer account page.
  if (isOfficer(member.role)) redirect("/officer/account");

  const { data } = await supabase
    .from("members")
    .select("full_name, email, pin")
    .eq("id", member.id)
    .single();

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/me" className="inline-block text-sm text-muted">
        ← Back
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">⚙️ Your account</h1>
        <p className="mt-1 text-sm text-muted">
          Update your name, email, PIN, and password.
        </p>
      </header>

      <AccountSettings
        initialName={data?.full_name ?? member.full_name}
        initialEmail={data?.email ?? null}
        initialPin={data?.pin ?? null}
      />
    </main>
  );
}
