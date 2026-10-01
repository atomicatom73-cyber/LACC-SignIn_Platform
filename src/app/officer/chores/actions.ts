"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireOfficer } from "@/lib/auth";
import { generateMonthlyDraft } from "@/lib/chore-algorithm";
import { parseSchedule } from "@/lib/chores";
import { emailNewAssignments } from "@/lib/job-assignment-email";
import { deriveExemptions } from "@/lib/job-draft";
import { officerTitle } from "@/lib/roles";
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
    scheduling_enabled: formData.get("scheduling_enabled") === "on",
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
    .update({
      name,
      description: description || null,
      slots,
      interval,
      scheduling_enabled: formData.get("scheduling_enabled") === "on",
    })
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
    .select("name, description, slots, interval, paused, scheduling_enabled")
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
      scheduling_enabled: chore.scheduling_enabled,
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

  // Tell them. After the response, so the officer's board updates immediately
  // and a slow (or dead) mail provider never stalls the assign button.
  after(() =>
    emailNewAssignments({
      assignments: [{ chore_id: choreId, member_id: memberId }],
      month,
      sentBy: { name: member.full_name, title: officerTitle(member) },
    }),
  );

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

/**
 * Set (or clear) when the member will do a job — the officer-side twin of
 * setMyChoreSchedule in /me. Date and time come off the form inputs on the
 * studio wall clock; an empty date clears the appointment.
 */
export async function setAssignmentSchedule(
  assignmentId: string,
  date: string,
  time: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!assignmentId) return { error: "Missing assignment." };

  const scheduled = parseSchedule(date, time);
  if (typeof scheduled !== "string" && scheduled !== null) return scheduled;

  const { error } = await supabase
    .from("chore_assignments")
    .update({ scheduled_at: scheduled })
    .eq("id", assignmentId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  revalidatePath("/me");
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

// ---------------------------------------------------------------------------
// Penciled drafts
//
// A month's draft is saved server-side as it's edited, so closing the tab,
// switching months, or losing the phone never loses the work — and reopening
// the month shows exactly what was left behind instead of re-running the
// algorithm. Nothing in a draft reaches a member: no email, nothing on /me,
// nothing on the printable sheet, until publishDraft turns it into real
// assignments.
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Open (or re-seed) a draft for a month.
 *
 * "blank" opens an empty one — the way to pencil a couple of open-studio
 * sessions without disturbing anything else. "algorithm" fills it from the
 * monthly draw, and REPLACES whatever was penciled before, which is why the
 * UI makes that a deliberate second tap.
 *
 * Either way the draw only ever proposes what's still open: members who
 * already hold a published job this month are out of the pool, and a job's
 * published assignees count against its slots.
 */
export async function startDraft(
  month: string,
  mode: "blank" | "algorithm",
): Promise<FormState> {
  const { supabase, member } = await requireOfficer("jobs");

  if (!MONTH_RE.test(month)) return { error: "Bad month." };

  // The draft row has to exist before its entries — they're FK'd to it.
  const { error: draftError } = await supabase
    .from("chore_drafts")
    .upsert(
      { month, updated_by: member.id, updated_at: new Date().toISOString() },
      { onConflict: "month" },
    );
  if (draftError) return { error: draftError.message };

  if (mode === "blank") {
    revalidatePath("/officer/chores");
    return { success: "Draft started — pencil in whoever you like." };
  }

  // Re-seeding throws away the hand edits on purpose.
  const { error: clearError } = await supabase
    .from("chore_draft_entries")
    .delete()
    .eq("month", month);
  if (clearError) return { error: clearError.message };

  const prevMonth = addMonths(month, -1);
  const [choresRes, membersRes, prevRes, absentRes, creditsRes, publishedRes] =
    await Promise.all([
      supabase
        .from("chores")
        .select("id, name, slots, interval")
        .eq("active", true)
        .eq("paused", false)
        .order("name", { ascending: true }),
      supabase
        .from("members")
        .select("id, full_name, officer_status, kiln_team")
        .eq("active", true)
        .eq("role", "member")
        .order("full_name", { ascending: true }),
      supabase
        .from("chore_assignments")
        .select("chore_id, member_id")
        .eq("month", prevMonth),
      supabase.from("absences").select("member_id").eq("month", month),
      supabase.from("chore_credits").select("member_id").is("used_month", null),
      supabase
        .from("chore_assignments")
        .select("chore_id, member_id")
        .eq("month", month),
    ]);

  const firstError =
    choresRes.error ?? membersRes.error ?? prevRes.error ?? absentRes.error ??
    creditsRes.error ?? publishedRes.error;
  if (firstError) return { error: firstError.message };

  const chores = choresRes.data ?? [];
  const members = membersRes.data ?? [];
  if (chores.length === 0) {
    return { error: "No unpaused jobs in the list — add or unpause some first." };
  }
  if (members.length === 0) {
    return { error: "No active members to assign jobs to." };
  }

  // What's already real this month: those people are spoken for, and those
  // slots are filled, so the draw fills in around them.
  const published = publishedRes.data ?? [];
  const publishedMemberIds = new Set(published.map((a) => a.member_id));
  const publishedPerChore = new Map<string, number>();
  for (const a of published) {
    publishedPerChore.set(
      a.chore_id,
      (publishedPerChore.get(a.chore_id) ?? 0) + 1,
    );
  }

  const draft = generateMonthlyDraft({
    targetMonth: month,
    chores: chores.map((c) => ({
      ...c,
      slots: Math.max(0, c.slots - (publishedPerChore.get(c.id) ?? 0)),
    })),
    members: members.filter((m) => !publishedMemberIds.has(m.id)),
    prevAssignments: prevRes.data ?? [],
    absentMemberIds: (absentRes.data ?? []).map((a) => a.member_id),
    creditAvailableMemberIds: [
      ...new Set((creditsRes.data ?? []).map((c) => c.member_id)),
    ],
    officerMemberIds: members.filter((m) => m.officer_status).map((m) => m.id),
    kilnTeamMemberIds: members.filter((m) => m.kiln_team).map((m) => m.id),
  });

  const rows = draft.proposals.flatMap((p) =>
    p.member_ids.map((memberId) => ({
      month,
      chore_id: p.chore_id,
      member_id: memberId,
    })),
  );
  if (rows.length > 0) {
    const { error } = await supabase.from("chore_draft_entries").insert(rows);
    if (error) return { error: error.message };
  }

  revalidatePath("/officer/chores");
  return {
    success: `Draft filled — ${rows.length} name${rows.length === 1 ? "" : "s"} penciled in. Nobody has been told yet.`,
  };
}

/**
 * Pencil someone onto a job. `entryId` comes from the browser so the chip can
 * appear instantly and the same call is safe to retry.
 */
export async function pencilMember(
  entryId: string,
  month: string,
  choreId: string,
  memberId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!UUID_RE.test(entryId)) return { error: "Bad entry id." };
  if (!MONTH_RE.test(month)) return { error: "Bad month." };
  if (!choreId || !memberId) return { error: "Pick a member." };

  const { error } = await supabase.from("chore_draft_entries").insert({
    id: entryId,
    month,
    chore_id: choreId,
    member_id: memberId,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "They are already penciled onto this job." };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  return null;
}

/**
 * Pencil an empty slot onto a job — a date and time with nobody on it yet, for
 * laying out the month's open-studio sessions before the names are settled.
 */
export async function pencilSlot(
  entryId: string,
  month: string,
  choreId: string,
  date: string,
  time: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!UUID_RE.test(entryId)) return { error: "Bad entry id." };
  if (!MONTH_RE.test(month)) return { error: "Bad month." };
  if (!choreId) return { error: "Missing job." };

  const scheduled = parseSchedule(date, time);
  if (typeof scheduled !== "string" && scheduled !== null) return scheduled;

  const { error } = await supabase.from("chore_draft_entries").insert({
    id: entryId,
    month,
    chore_id: choreId,
    member_id: null,
    scheduled_at: scheduled,
  });
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  return null;
}

/** Put a name on an empty penciled slot, keeping the date and time it holds. */
export async function nameDraftSlot(
  entryId: string,
  memberId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!entryId || !memberId) return { error: "Pick a member." };

  const { error } = await supabase
    .from("chore_draft_entries")
    .update({ member_id: memberId })
    .eq("id", entryId)
    .is("member_id", null);
  if (error) {
    if (error.code === "23505") {
      return { error: "They are already penciled onto this job." };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  return null;
}

/** Rub out one penciled line. Nobody was told, so there's nothing to undo. */
export async function unpencil(
  entryId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!entryId) return { error: "Missing entry." };

  const { error } = await supabase
    .from("chore_draft_entries")
    .delete()
    .eq("id", entryId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  return null;
}

/** Drag a penciled name (and its time) from one job to another. */
export async function movePencil(
  entryId: string,
  toChoreId: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!entryId || !toChoreId) return { error: "Missing entry." };

  const { error } = await supabase
    .from("chore_draft_entries")
    .update({ chore_id: toChoreId })
    .eq("id", entryId);
  if (error) {
    if (error.code === "23505") {
      return { error: "They are already penciled onto that job." };
    }
    return { error: error.message };
  }

  revalidatePath("/officer/chores");
  return null;
}

/**
 * Set (or clear) when a penciled line happens — the whole point of the draft
 * for scheduled jobs like open studio, where the date and time have to be
 * settled before anyone is officially on the hook for it.
 */
export async function setPencilSchedule(
  entryId: string,
  date: string,
  time: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!entryId) return { error: "Missing entry." };

  const scheduled = parseSchedule(date, time);
  if (typeof scheduled !== "string" && scheduled !== null) return scheduled;

  const { error } = await supabase
    .from("chore_draft_entries")
    .update({ scheduled_at: scheduled })
    .eq("id", entryId);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  return null;
}

/** Throw the whole draft away. Published assignments are untouched. */
export async function discardDraft(
  month: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("jobs");

  if (!MONTH_RE.test(month)) return { error: "Bad month." };

  const { error } = await supabase
    .from("chore_drafts")
    .delete()
    .eq("month", month);
  if (error) return { error: error.message };

  revalidatePath("/officer/chores");
  return null;
}

/**
 * Make the draft official: every penciled name becomes a real assignment,
 * carrying the date and time it was penciled with, and only now does anyone
 * get an email.
 *
 * Read from the database rather than from the browser, so what gets published
 * is what the coordinator last saw saved. Slots still waiting for a name stay
 * penciled — publishing takes what's ready and leaves the rest on the pad.
 */
export async function publishDraft(month: string): Promise<FormState> {
  const { supabase, member } = await requireOfficer("jobs");

  if (!MONTH_RE.test(month)) return { error: "Bad month." };

  const [entriesRes, existingRes, membersRes, absentRes, creditsRes] =
    await Promise.all([
      supabase
        .from("chore_draft_entries")
        .select("id, chore_id, member_id, scheduled_at")
        .eq("month", month),
      supabase
        .from("chore_assignments")
        .select("id, chore_id, member_id")
        .eq("month", month),
      supabase
        .from("members")
        .select("id, full_name, officer_status, kiln_team")
        .eq("active", true)
        .eq("role", "member"),
      supabase.from("absences").select("member_id").eq("month", month),
      supabase.from("chore_credits").select("member_id").is("used_month", null),
    ]);

  const firstError =
    entriesRes.error ?? existingRes.error ?? membersRes.error ??
    absentRes.error ?? creditsRes.error;
  if (firstError) return { error: firstError.message };

  const entries = entriesRes.data ?? [];
  const existing = existingRes.data ?? [];
  const named = entries.filter(
    (e): e is typeof e & { member_id: string } => e.member_id !== null,
  );
  const unnamed = entries.length - named.length;

  if (named.length === 0) {
    return {
      error:
        unnamed > 0
          ? "Every penciled slot still needs a name before it can be assigned."
          : "Nothing penciled in to assign.",
    };
  }

  // Anything already assigned is left alone rather than inserted twice — the
  // only thing carried over is a time the draft settled on.
  const pairKey = (choreId: string, memberId: string) =>
    `${choreId}:${memberId}`;
  const alreadyAssigned = new Map(
    existing.map((a) => [pairKey(a.chore_id, a.member_id), a.id]),
  );

  const fresh = named.filter(
    (e) => !alreadyAssigned.has(pairKey(e.chore_id, e.member_id)),
  );

  if (fresh.length > 0) {
    const { error } = await supabase.from("chore_assignments").insert(
      fresh.map((e) => ({
        chore_id: e.chore_id,
        member_id: e.member_id,
        month,
        scheduled_at: e.scheduled_at,
        assigned_by: member.id,
      })),
    );
    if (error) {
      if (error.code === "23505") {
        return {
          error:
            "Someone was assigned one of these jobs while the draft was open — reload the month and try again.",
        };
      }
      return { error: error.message };
    }
  }

  // A time penciled against a job someone was already given still lands.
  for (const e of named) {
    const id = alreadyAssigned.get(pairKey(e.chore_id, e.member_id));
    if (!id || !e.scheduled_at) continue;
    const { error } = await supabase
      .from("chore_assignments")
      .update({ scheduled_at: e.scheduled_at })
      .eq("id", id);
    if (error) return { error: error.message };
  }

  // Tell the new assignees — after the response, so a slow mail provider never
  // stalls the button, and only for rows that didn't already exist.
  if (fresh.length > 0) {
    after(() =>
      emailNewAssignments({
        assignments: fresh.map((e) => ({
          chore_id: e.chore_id,
          member_id: e.member_id,
        })),
        month,
        sentBy: { name: member.full_name, title: officerTitle(member) },
      }),
    );
  }

  // Credits are spent on whoever ended up with no job at all — recomputed
  // now, so a credit holder the coordinator penciled in keeps their credit.
  const working = new Set<string>([
    ...existing.map((a) => a.member_id),
    ...named.map((e) => e.member_id),
  ]);
  const { creditSpends } = deriveExemptions({
    members: membersRes.data ?? [],
    absentMemberIds: (absentRes.data ?? []).map((a) => a.member_id),
    creditMemberIds: [
      ...new Set((creditsRes.data ?? []).map((c) => c.member_id)),
    ],
    workingMemberIds: [...working],
  });

  const spentThisMonth = await supabase
    .from("chore_credits")
    .select("member_id")
    .eq("used_month", month);
  if (spentThisMonth.error) return { error: spentThisMonth.error.message };
  const alreadySpent = new Set(
    (spentThisMonth.data ?? []).map((c) => c.member_id),
  );

  for (const { id: memberId } of creditSpends) {
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
    if (!credit) continue; // credit vanished mid-publish — skip
    const { error } = await supabase
      .from("chore_credits")
      .update({ used_month: month })
      .eq("id", credit.id)
      .is("used_month", null);
    if (error) return { error: error.message };
  }

  // Clear what was published. Slots still waiting for a name keep the draft
  // open so the dates laid out against them are not lost.
  const { error: clearError } = await supabase
    .from("chore_draft_entries")
    .delete()
    .in(
      "id",
      named.map((e) => e.id),
    );
  if (clearError) return { error: clearError.message };

  if (unnamed === 0) {
    const { error } = await supabase
      .from("chore_drafts")
      .delete()
      .eq("month", month);
    if (error) return { error: error.message };
  }

  revalidatePath("/officer/chores");
  revalidatePath("/officer/members");
  revalidatePath("/me");

  const told = fresh.length;
  return {
    success:
      `${monthLabel(month)} assigned — ${told} member${told === 1 ? "" : "s"} emailed.` +
      (unnamed > 0
        ? ` ${unnamed} slot${unnamed === 1 ? "" : "s"} still waiting for a name, left penciled.`
        : ""),
  };
}
