import { requireOfficer } from "@/lib/auth";
import { readAltSession } from "@/lib/alt-session";
import { hasPermission, officerTitle } from "@/lib/roles";
import { AccountSwitcher } from "@/components/AccountSwitcher";
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
  const parked = await readAltSession();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Wordmark />
        <div className="flex items-center gap-3">
          <AccountSwitcher
            current={{ label: officerTitle(member), kind: "officer" }}
            parked={
              parked ? { label: parked.label, kind: parked.kind } : null
            }
          />
          <form action={signOutAuth} className="shrink-0">
            <LogoutButton className="whitespace-nowrap text-sm text-muted" />
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
