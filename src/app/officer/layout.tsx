import { requireOfficer } from "@/lib/auth";
import { hasPermission, officerTitle } from "@/lib/roles";
import { Wordmark } from "@/components/Brand";
import { LogoutButton } from "@/components/LogoutButton";
import { signOutAuth } from "@/app/me/actions";
import { OfficerNav } from "./OfficerNav";

export default async function OfficerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member } = await requireOfficer();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Wordmark />
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            {officerTitle(member)}
          </span>
          <form action={signOutAuth}>
            <LogoutButton />
          </form>
        </div>
      </header>

      <OfficerNav
        access={{
          jobs: hasPermission(member, "jobs"),
          logs: hasPermission(member, "logs"),
          messages: hasPermission(member, "messages"),
        }}
      />

      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}
