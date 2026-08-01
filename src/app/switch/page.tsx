import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { listOfficerAccounts } from "@/lib/officer-accounts";
import { isOfficer, officerTitle } from "@/lib/roles";
import { Wordmark } from "@/components/Brand";
import { AddAccountForm } from "./AddAccountForm";

export const dynamic = "force-dynamic";

/**
 * Add the second account for this device. Officers land here from the header
 * switcher to add their personal member login (and members to add an officer
 * login), so both stay signed in and the switcher can flip between them.
 */
export default async function SwitchPage() {
  const { member } = await requireMember();
  if (!member) redirect("/login");

  const viewerIsOfficer = isOfficer(member.role);
  const officers = await listOfficerAccounts();

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Wordmark />
        <Link
          href={viewerIsOfficer ? "/officer" : "/me"}
          className="text-sm text-muted"
        >
          ← Back
        </Link>
      </header>

      <h1 className="mt-8 text-2xl font-bold tracking-tight">
        Add your other account
      </h1>
      <p className="mt-2 text-sm text-muted">
        You&apos;re signed in as{" "}
        <span className="font-semibold text-foreground">
          {viewerIsOfficer ? officerTitle(member) : member.full_name}
        </span>
        . Add the other one and both stay signed in on this device — the name at
        the top of the page switches between them, no password needed after
        this.
      </p>

      <div className="mt-6">
        <AddAccountForm
          defaultMode={viewerIsOfficer ? "member" : "officer"}
          officers={officers.map((o) => ({
            id: o.id,
            title: officerTitle(o),
          }))}
        />
      </div>

      <p className="mt-6 text-xs text-muted">
        Both accounts stay on this device only. Logging out clears both.
      </p>
    </main>
  );
}
