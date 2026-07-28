import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  hasPermission,
  isOfficer,
  type Permission,
  type PermissionSet,
  type Role,
} from "@/lib/roles";

export type CurrentMember = {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  officer_title: string | null;
  permissions: PermissionSet;
};

/**
 * Load the logged-in user's member row, redirecting to /login if signed out.
 * `member` can briefly be null right after signup (before the
 * handle_new_user trigger's row is visible) — callers must handle it.
 */
export async function requireMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("members")
    .select("id, full_name, role, active, officer_title, permissions")
    .eq("user_id", user.id)
    .single();

  return { supabase, user, member: (data as CurrentMember | null) ?? null };
}

/**
 * Gate an officer page or action. Redirects members to /me; when `permission`
 * is given, officers who don't hold it land back on /officer.
 */
export async function requireOfficer(permission?: Permission) {
  const { supabase, user, member } = await requireMember();
  if (!member || !isOfficer(member.role)) redirect("/me");
  if (permission && !hasPermission(member, permission)) redirect("/officer");
  return { supabase, user, member };
}
