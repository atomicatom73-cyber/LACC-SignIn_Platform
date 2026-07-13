/** Database row types (mirror supabase/schema.sql). */

import type { Role } from "./roles";

export type Member = {
  id: string;
  user_id: string | null;
  full_name: string;
  role: Role;
  pin: string | null;
  active: boolean;
  created_at: string;
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

export type Message = {
  id: string;
  sender_id: string | null;
  sender_role: Role;
  subject: string;
  body: string;
  audience: "all" | "selected";
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
