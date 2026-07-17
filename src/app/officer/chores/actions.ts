"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";
import { generateMonthlyDraft } from "@/lib/chore-algorithm";
import { addMonths, monthLabel } from "@/lib/studio";
import type { ChoreInterval } from "@/lib/types";

/** Result shape shared by the useActionState forms on this page. */
export type FormState = { error?: string; success?: string } | null;

const MONTH_RE = /^\d{4}-\d{2}-01$/;

function parseSlots(raw: FormDataEntryValue | null): number | { error: string } {
  const slots = Number(String(raw ?? "").trim());
  if (!Number.isInteger(slots) || slots < 0 || slots > 50) {
    return { error: "Slots must be a whole number between 0 and 50." };
  }
  return slots;
}

function parseInterval(
  raw: FormDataEntryValue | null,
): ChoreInterval | { error: string } {
  const value = String(raw ?? "month");
  if (value === "month" || value === "first_half" || value === "second_half") {
    return value;
  }
  return { error: "Pick a valid interval." };
}

/** Add a job to the catalog (officers with the jobs permission). */
export async function createChore(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireOfficer("jobs");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the job a name." };
  const description = String(formData.get("description") ?? "").trim();
  const slots = parseSlots(formData.get("slots"));
  if (typeof slots !== "number") return slots;
  const interval = parseInterval(formData.get("interval"));
  if (typeof interval !== "string") return interval;

  const { error } = await supabase.from("chores").insert({
    name,
    description: description || null,
    slots,
    interval,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: `There's already a job called “${name}”.` };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  return { success: `“${name}” added to the catalog.` };
}

/** Edit a catalog job's name, description, or slots (officers with the jobs permission). */
export async function updateChore(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireOfficer("jobs");

  const choreId = String(formData.get("chore_id") ?? "").trim();
  if (!choreId) return { error: "Missing job." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the job a name." };
  const description = String(formData.get("description") ?? "").trim();
  const slots = parseSlots(formData.get("slots"));
  if (typeof slots !== "number") return slots;
  const interval = parseInterval(formData.get("interval"));
  if (typeof interval !== "string") return interval;

  const { error } = await supabase
    .from("chores")
    .update({ name, description: description || null, slots, interval })
    .eq("id", choreId);
  if (error) {
    if (error.code === "23505") {
      return { error: `There's already a job called “${name}”.` };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return { success: "Job updated." };
}

/** Delete a catalog job. Its assignment history goes with it. */
export async function deleteChore(
  choreId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!choreId) return { error: "Missing job." };

  const { error } = await supabase.from("chores").delete().eq("id", choreId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return null;
}

/** Pause / unpause a job. Paused jobs sit out assignment until unpaused. */
export async function setChorePaused(
  choreId: string,
  paused: boolean,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!choreId) return { error: "Missing job." };

  const { error } = await supabase
    .from("chores")
    .update({ paused })
    .eq("id", choreId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  return null;
}

/** Duplicate a job — identical description, slots, and interval. */
export async function duplicateChore(
  choreId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!choreId) return { error: "Missing job." };

  const { data: chore, error: fetchError } = await supabase
    .from("chores")
    .select("name, description, slots, interval, paused")
    .eq("id", choreId)
    .maybeSingle();
  if (fetchError) return { error: fetchError.message };
  if (!chore) return { error: "Job not found." };

  // chores.name is unique — walk "X (copy)", "X (copy 2)", … until one fits.
  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? `${chore.name} (copy)` : `${chore.name} (copy ${n})`;
    const { error } = await supabase.from("chores").insert({
      name,
      description: chore.description,
      slots: chore.slots,
      interval: chore.interval,
      paused: chore.paused,
    });
    if (!error) {
      revalidatePath("/officer/chores");
      return null;
    }
    if (error.code !== "23505") return { error: error.message };
  }
  return { error: "Too many copies of this job already exist." };
}

/** Manually assign a job to a member for a month (officers with the jobs permission). */
export async function assignChore(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, member } = await requireOfficer("jobs");

  const choreId = String(formData.get("chore_id") ?? "").trim();
  const memberId = String(formData.get("member_id") ?? "").trim();
  const month = String(formData.get("month") ?? "").trim();
  if (!choreId || !memberId) return { error: "Pick a member." };
  if (!MONTH_RE.test(month)) return { error: "Bad month." };

  const { error } = await supabase.from("chore_assignments").insert({
    chore_id: choreId,
    member_id: memberId,
    month,
    assigned_by: member.id,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "They already have this job that month." };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return { success: "Assigned." };
}

/** Remove an assignment entirely (officers with the jobs permission). */
export async function removeAssignment(
  assignmentId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!assignmentId) return { error: "Missing assignment." };

  const { error } = await supabase
    .from("chore_assignments")
    .delete()
    .eq("id", assignmentId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return null;
}

/** Mark an assignment completed / back to pending (officers with the jobs permission). */
export async function setAssignmentStatus(
  assignmentId: string,
  completed: boolean,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!assignmentId) return { error: "Missing assignment." };

  const { error } = await supabase
    .from("chore_assignments")
    .update({
      status: completed ? "completed" : "pending",
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", assignmentId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return null;
}

/** What the reshuffle proposes, resolved to names for review in the UI. */
export type ReshufflePreview = {
  targetMonth: string;
  proposals: {
    choreId: string;
    choreName: string;
    members: { id: string; name: string }[];
  }[];
  creditSpends: { id: string; name: string }[];
  absentNames: string[];
  /** Everyone who was in the draw (not absent, no credit) — the UI diffs
   *  this against the edited draft to show who's left without a job. */
  eligibleMembers: { id: string; name: string }[];
  warnings: string[];
  existingCount: number;
};

/**
 * Run the deterministic draft algorithm for a month without writing anything.
 * The coordinator reviews (and can trim) the result before publishing.
 */
export async function previewReshuffle(
  targetMonth: string,
): Promise<{ error: string } | { preview: ReshufflePreview }> {
  const { supabase } = await requireOfficer("jobs");

  if (!MONTH_RE.test(targetMonth)) return { error: "Bad month." };
  const prevMonth = addMonths(targetMonth, -1);

  const [choresRes, membersRes, prevRes, absentRes, creditsRes, existingRes] =
    await Promise.all([
      supabase
        .from("chores")
        .select("id, name, slots, interval")
        .eq("active", true)
        .eq("paused", false)
        .order("name", { ascending: true }),
      supabase
        .from("members")
        .select("id, full_name")
        .eq("active", true)
        .eq("role", "member")
        .order("full_name", { ascending: true }),
      supabase
        .from("chore_assignments")
        .select("chore_id, member_id")
        .eq("month", prevMonth),
      supabase.from("absences").select("member_id").eq("month", targetMonth),
      supabase
        .from("chore_credits")
        .select("member_id")
        .is("used_month", null),
      supabase
        .from("chore_assignments")
        .select("id", { count: "exact", head: true })
        .eq("month", targetMonth),
    ]);

  const firstError =
    choresRes.error ?? membersRes.error ?? prevRes.error ?? absentRes.error ??
    creditsRes.error ?? existingRes.error;
  if (firstError) return { error: firstError.message };

  const chores = choresRes.data ?? [];
  const members = membersRes.data ?? [];
  if (chores.length === 0) {
    return { error: "No unpaused jobs in the list — add or unpause some first." };
  }
  if (members.length === 0) {
    return { error: "No active members to assign jobs to." };
  }

  const draft = generateMonthlyDraft({
    targetMonth,
    chores,
    members,
    prevAssignments: prevRes.data ?? [],
    absentMemberIds: (absentRes.data ?? []).map((a) => a.member_id),
    creditAvailableMemberIds: [
      ...new Set((creditsRes.data ?? []).map((c) => c.member_id)),
    ],
  });

  const nameOf = new Map(members.map((m) => [m.id, m.full_name]));
  const choreName = new Map(chores.map((c) => [c.id, c.name]));

  return {
    preview: {
      targetMonth,
      proposals: draft.proposals.map((p) => ({
        choreId: p.chore_id,
        choreName: choreName.get(p.chore_id) ?? "Unknown job",
        members: p.member_ids.map((id) => ({
          id,
          name: nameOf.get(id) ?? "Unknown member",
        })),
      })),
      creditSpends: draft.creditsToConsume.map((id) => ({
        id,
        name: nameOf.get(id) ?? "Unknown member",
      })),
      absentNames: draft.exemptAbsent.map((id) => nameOf.get(id) ?? "Unknown"),
      eligibleMembers: members
        .filter(
          (m) =>
            !draft.exemptAbsent.includes(m.id) &&
            !draft.creditsToConsume.includes(m.id),
        )
        .map((m) => ({ id: m.id, name: m.full_name })),
      warnings: draft.warnings,
      existingCount: existingRes.count ?? 0,
    },
  };
}

/**
 * Write a reviewed draft: insert the assignments (duplicates from earlier
 * manual assigning are skipped) and spend one credit per exempted member.
 */
export async function publishReshuffle(input: {
  targetMonth: string;
  assignments: { chore_id: string; member_id: string }[];
  creditMemberIds: string[];
}): Promise<FormState> {
  const { supabase, member } = await requireOfficer("jobs");

  const { targetMonth } = input;
  if (!MONTH_RE.test(targetMonth)) return { error: "Bad month." };
  if (input.assignments.length === 0 && input.creditMemberIds.length === 0) {
    return { error: "Nothing left in the draft to publish." };
  }

  if (input.assignments.length > 0) {
    const rows = input.assignments.map((a) => ({
      chore_id: a.chore_id,
      member_id: a.member_id,
      month: targetMonth,
      assigned_by: member.id,
    }));
    const { error } = await supabase
      .from("chore_assignments")
      .upsert(rows, {
        onConflict: "chore_id,member_id,month",
        ignoreDuplicates: true,
      });
    if (error) return { error: error.message };
  }

  // Spend the oldest available credit per exempted member — unless a credit
  // was already spent on this month (e.g. the draft was published twice).
  const creditIds = [...new Set(input.creditMemberIds)];
  if (creditIds.length > 0) {
    const { data: spent, error: spentError } = await supabase
      .from("chore_credits")
      .select("member_id")
      .eq("used_month", targetMonth)
      .in("member_id", creditIds);
    if (spentError) return { error: spentError.message };
    const alreadySpent = new Set((spent ?? []).map((c) => c.member_id));

    for (const memberId of creditIds) {
      if (alreadySpent.has(memberId)) continue;
      const { data: credit, error: findError } = await supabase
        .from("chore_credits")
        .select("id")
        .eq("member_id", memberId)
        .is("used_month", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (findError) return { error: findError.message };
      if (!credit) continue; // credit vanished since the preview — skip
      const { error } = await supabase
        .from("chore_credits")
        .update({ used_month: targetMonth })
        .eq("id", credit.id)
        .is("used_month", null);
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  return { success: `${monthLabel(targetMonth)} assignments published.` };
}
