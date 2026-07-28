/** Roles and permissions shared by the whole app. */

export type Role =
  | "member"
  | "president"
  | "vice_president"
  | "volunteer_coordinator"
  | "officer";

export const OFFICER_ROLES = [
  "president",
  "vice_president",
  "volunteer_coordinator",
  "officer",
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  member: "Member",
  president: "President",
  vice_president: "Vice President",
  volunteer_coordinator: "Volunteer Coordinator",
  officer: "Officer",
};

/**
 * The classic shared officer logins are name-based: the form shows the role
 * name and maps it to a synthetic @lacc.local address (Supabase auth requires
 * an email-shaped identifier; nobody reads these inboxes). President-created
 * officer accounts get a title-derived @officer.lacc.local address instead
 * (see officerLoginEmail). Keep in sync with scripts/create-officers.mjs.
 */
export const OFFICER_ACCOUNTS = {
  president: "president@lacc.local",
  vice_president: "vice.president@lacc.local",
  volunteer_coordinator: "volunteer.coordinator@lacc.local",
} as const;

export function isOfficer(role: string | null | undefined): boolean {
  return (OFFICER_ROLES as readonly string[]).includes(role ?? "");
}

/**
 * Login identifier for a member who signs in by name. Mirrors the officer
 * accounts: Supabase needs an email-shaped string, nobody reads the inbox.
 * "Jose O'Brien" -> jose.o.brien@member.lacc.local
 */
export function memberLoginEmail(fullName: string): string | null {
  const slug = nameSlug(fullName);
  return slug ? `${slug}@member.lacc.local` : null;
}

/**
 * Login identifier for a president-created officer account, derived from its
 * title: "Kiln Tech" -> kiln.tech@officer.lacc.local. Lives on its own
 * subdomain so titles can never collide with member-name logins.
 */
export function officerLoginEmail(title: string): string | null {
  const slug = nameSlug(title);
  return slug ? `${slug}@officer.lacc.local` : null;
}

function nameSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Officer permissions. The president always holds all of them and grants any
 * mix to the other officer accounts from the Account page. A null permission
 * set on a member row means the role's built-in defaults (president/VP:
 * everything; volunteer coordinator: jobs + messages; custom officers get an
 * explicit set when they're created).
 */
export type Permission =
  | "members"
  | "logs"
  | "jobs"
  | "messages"
  | "door_codes";

export type PermissionSet = Partial<Record<Permission, boolean>> | null;

/** Checkbox catalog for the president's officer-management UI. */
export const PERMISSIONS: {
  key: Permission;
  label: string;
  hint: string;
}[] = [
  {
    key: "members",
    label: "Manage members",
    hint: "Add, rename, deactivate, and delete members; reset passwords and PINs.",
  },
  {
    key: "logs",
    label: "Sign-in logs",
    hint: "See who signed in and when.",
  },
  {
    key: "jobs",
    label: "Jobs",
    hint: "Manage the job catalog, assignments, credits, and the monthly reshuffle.",
  },
  {
    key: "messages",
    label: "Announcements",
    hint: "Send announcements to members.",
  },
  {
    key: "door_codes",
    label: "Manage door codes",
    hint: "Add, edit, and delete door codes (every officer can view them).",
  },
];

/**
 * Does this officer hold a permission? Mirrors public.has_permission in
 * supabase/schema.sql — keep the two in sync.
 */
export function hasPermission(
  member: { role: string; permissions?: unknown },
  perm: Permission,
): boolean {
  if (member.role === "president") return true;
  if (!isOfficer(member.role)) return false;
  const p = member.permissions;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return (p as Record<string, unknown>)[perm] === true;
  }
  if (member.role === "vice_president") return true;
  if (member.role === "volunteer_coordinator") {
    return perm === "jobs" || perm === "messages";
  }
  return false;
}

/** Display name for an officer account: custom title, else the classic label. */
export function officerTitle(member: {
  role: string;
  officer_title?: string | null;
}): string {
  return (
    member.officer_title ?? ROLE_LABELS[member.role as Role] ?? "Officer"
  );
}

/**
 * Label for a message's sender_role column, which holds a Role for the
 * classic accounts and the officer's display title for custom ones.
 */
export function roleOrTitleLabel(value: string): string {
  return ROLE_LABELS[value as Role] ?? value;
}
