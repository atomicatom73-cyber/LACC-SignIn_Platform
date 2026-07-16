/** Database row types (mirror supabase/schema.sql). */

import type { Permission, Role } from "./roles";

export type Member = {
  id: string;
  user_id: string | null;
  full_name: string;
  role: Role;
  pin: string | null;
  active: boolean;
  created_at: string;
  /** Display title for president-created officer accounts ("Treasurer"). */
  officer_title: string | null;
  /** Officer permission set; null = the role's built-in defaults. */
  permissions: Partial<Record<Permission, boolean>> | null;
  /** Real contact/login-alias email; null for members who haven't added one. */
  email: string | null;
  /** True when the last roster sync matched this member to a sheet row. */
  in_sheet: boolean;
  /** Bookkeeping cells mirrored verbatim from the roster sheet (read-only). */
  sheet_paid: string | null;
  sheet_payment_type: string | null;
  sheet_policy: string | null;
  sheet_photos: string | null;
  sheet_comments: string | null;
};

export type Chore = {
  id: string;
  name: string;
  description: string | null;
  slots: number;
  active: boolean;
  created_at: string;
};

export type AssignmentStatus = "pending" | "completed";

export type ChoreAssignment = {
  id: string;
  chore_id: string;
  member_id: string;
  month: string; // "YYYY-MM-01"
  status: AssignmentStatus;
  completed_at: string | null;
  assigned_by: string | null;
  created_at: string;
};

export type ChoreCredit = {
  id: string;
  member_id: string;
  note: string | null;
  granted_by: string | null;
  created_at: string;
  used_month: string | null; // null = still available
};

export type Absence = {
  id: string;
  member_id: string;
  month: string; // "YYYY-MM-01"
  note: string | null;
  marked_by: string | null;
  created_at: string;
};

export type EventCategory = "class" | "workshop" | "party" | "camp" | "meeting" | "other";

export type EventRecurrence = "none" | "daily" | "weekly" | "monthly";

export type EventSource = "native" | "google";

export type StudioEvent = {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  recurrence: EventRecurrence;
  /** All-day events render without a clock; `ends_at` is the exclusive end. */
  all_day: boolean;
  /** Where the row came from. Google events are read-only in the app. */
  source: EventSource;
  /** Upsert key for Google-sourced rows; null for legacy native rows. */
  google_event_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type GuestSignin = {
  id: string;
  host_member_id: string;
  guest_name: string;
  signed_in_at: string;
};

export type StudentSignin = {
  id: string;
  student_name: string;
  class_label: string;
  signed_in_at: string;
};

/** 'all' is the legacy value on old rows — it meant active members. */
export type MessageAudience =
  | "all"
  | "selected"
  | "active"
  | "inactive"
  | "everyone";

export type Message = {
  id: string;
  sender_id: string | null;
  /** A Role for classic accounts; the officer's title for custom officers. */
  sender_role: string;
  subject: string;
  body: string;
  audience: MessageAudience;
  created_at: string;
};

export type MessageRecipient = {
  message_id: string;
  member_id: string;
  read_at: string | null;
};

export type DoorCode = {
  id: string;
  title: string;
  code: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
