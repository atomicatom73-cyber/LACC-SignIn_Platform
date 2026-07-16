import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listOfficerAccounts } from "@/lib/officer-accounts";
import { hasPermission, officerTitle, PERMISSIONS } from "@/lib/roles";
import { AccountSettings } from "./AccountSettings";
import { OfficerManager, type ManagedOfficer } from "./OfficerManager";

export const dynamic = "force-dynamic";

export default async function OfficerAccountPage() {
  const { member } = await requireOfficer();

  // The recovery link lives on this officer's own member row. Read it (and the
  // linked member's name) with the service role — an officer's session can't
  // see the recovery_member_id column value on another row.
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("members")
    .select("recovery_member_id")
    .eq("id", member.id)
    .maybeSingle();

  let linkedName: string | null = null;
  if (row?.recovery_member_id) {
    const { data: linked } = await admin
      .from("members")
      .select("full_name")
      .eq("id", row.recovery_member_id)
      .maybeSingle();
    linkedName = linked?.full_name ?? null;
  }

  // The president also manages the other officer accounts from here.
  let managed: ManagedOfficer[] | null = null;
  if (member.role === "president") {
    const officers = await listOfficerAccounts();
    managed = officers.map((o) => ({
      id: o.id,
      title: officerTitle(o),
      locked: o.role === "president",
      permissions: Object.fromEntries(
        PERMISSIONS.map((p) => [p.key, hasPermission(o, p.key)]),
      ) as ManagedOfficer["permissions"],
    }));
  }

  return (
    <main className="anim-fade">
      <AccountSettings
        roleLabel={officerTitle(member)}
        initialLinkedName={linkedName}
      />
      {managed && <OfficerManager officers={managed} />}
    </main>
  );
}
