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

/**
 * Shared officer logins are name-based: the form shows the role name and maps
 * it to a synthetic @lacc.local address (Supabase auth requires an
 * email-shaped identifier; nobody reads these inboxes). Keep in sync with
 * scripts/create-officers.mjs.
 */
export const OFFICER_ACCOUNTS: Record<(typeof OFFICER_ROLES)[number], string> = {
  president: "president@lacc.local",
  vice_president: "vice.president@lacc.local",
  volunteer_coordinator: "volunteer.coordinator@lacc.local",
};

export function isOfficer(role: string | null | undefined): boolean {
  return (OFFICER_ROLES as readonly string[]).includes(role ?? "");
}

/**
 * Login identifier for a member who signs in by name. Mirrors the officer
 * accounts: Supabase needs an email-shaped string, nobody reads the inbox.
 * "Jose O'Brien" -> jose.o.brien@member.lacc.local
 */
export function memberLoginEmail(fullName: string): string | null {
  const slug = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return slug ? `${slug}@member.lacc.local` : null;
}

/**
 * Roles are permanently fixed: the three officer roles exist only as the
 * shared accounts above, and everyone else is a member. There is no
 * role-change UI, no server action, and the DB trigger rejects role updates
 * from any client session.
 */

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

/** Add/edit/delete studio door codes. Every officer can view them. */
export function canManageDoorCodes(role: string | null | undefined): boolean {
  return role === "president" || role === "vice_president";
}
