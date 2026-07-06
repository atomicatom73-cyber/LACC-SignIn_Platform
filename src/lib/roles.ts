/** Roles and permissions shared by the whole app. */

export type Role = "member" | "president" | "vice_president" | "volunteer_coordinator";

export const OFFICER_ROLES = [
  "president",
  "vice_president",
  "volunteer_coordinator",
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  member: "Member",
  president: "President",
  vice_president: "Vice President",
  volunteer_coordinator: "Volunteer Coordinator",
};

export function isOfficer(role: string | null | undefined): boolean {
  return (OFFICER_ROLES as readonly string[]).includes(role ?? "");
}

/** Only the president can change anyone's role (the VP explicitly cannot). */
export function canManageRoles(role: string | null | undefined): boolean {
  return role === "president";
}

/** Add/deactivate members, edit member details. */
export function canManageMembers(role: string | null | undefined): boolean {
  return role === "president" || role === "vice_president";
}

/** Create/edit/delete studio calendar events. */
export function canManageCalendar(role: string | null | undefined): boolean {
  return role === "president" || role === "vice_president";
}

/** Chore catalog, assignments, credits, and absences. */
export function canManageChores(role: string | null | undefined): boolean {
  return isOfficer(role);
}

/** Send announcements to members. */
export function canSendMessages(role: string | null | undefined): boolean {
  return isOfficer(role);
}
