import { createAdminClient } from "@/lib/supabase/admin";
import {
  OFFICER_ROLES,
  officerTitle,
  type PermissionSet,
  type Role,
} from "@/lib/roles";

export type OfficerAccountRow = {
  id: string;
  user_id: string | null;
  role: Role;
  full_name: string;
  officer_title: string | null;
  permissions: PermissionSet;
};

/** Classic roles first (in rank order), then custom officers by title. */
const ROLE_ORDER: Record<string, number> = {
  president: 0,
  vice_president: 1,
  volunteer_coordinator: 2,
  officer: 3,
};

/**
 * Every officer account that can actually sign in, for the login screen's
 * officer picker and the president's management panel. Service-role lookup —
 * callers run server-side.
 */
export async function listOfficerAccounts(): Promise<OfficerAccountRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("members")
    .select("id, user_id, role, full_name, officer_title, permissions")
    .in("role", [...OFFICER_ROLES])
    .not("user_id", "is", null);

  return ((data ?? []) as OfficerAccountRow[]).sort(
    (a, b) =>
      (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
      officerTitle(a).localeCompare(officerTitle(b)),
  );
}
