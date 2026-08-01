import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listOfficerAccounts } from "@/lib/officer-accounts";
import { hasPermission, officerTitle, PERMISSIONS } from "@/lib/roles";
import { AccountSettings } from "./AccountSettings";
import { OfficerManager, type ManagedOfficer } from "./OfficerManager";
import {
  KilnTeamPanel,
  OfficerStatusPanel,
  type StatusMember,
} from "./OfficerStatusPanel";

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

  // The president also manages the other officer accounts — and which members
  // hold officer status — from here. Kiln team is a lighter touch: anyone who
  // can manage members can set it.
  const canManageMembers = hasPermission(member, "members");
  let managed: ManagedOfficer[] | null = null;
  let roster: StatusMember[] | null = null;

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

  if (member.role === "president" || canManageMembers) {
    const { data: members } = await admin
      .from("members")
      .select("id, full_name, officer_status, kiln_team")
      .eq("role", "member")
      .eq("active", true)
      .order("full_name", { ascending: true });
    roster = (members ?? []).map((m) => ({
      id: m.id,
      name: m.full_name,
      officer: m.officer_status,
      kilnTeam: m.kiln_team,
    }));
  }

  return (
    <main className="anim-fade">
      <AccountSettings
        roleLabel={officerTitle(member)}
        initialLinkedName={linkedName}
      />
      {managed && <OfficerManager officers={managed} />}
      {roster && member.role === "president" && (
        <OfficerStatusPanel members={roster} />
      )}
      {roster && canManageMembers && <KilnTeamPanel members={roster} />}
    </main>
  );
}
