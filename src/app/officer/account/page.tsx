import { requireOfficer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS } from "@/lib/roles";
import { AccountSettings } from "./AccountSettings";

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

  return (
    <AccountSettings
      roleLabel={ROLE_LABELS[member.role]}
      initialLinkedName={linkedName}
    />
  );
}
