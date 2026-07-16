"use server";

import { revalidatePath } from "next/cache";
import { requireOfficer } from "@/lib/auth";

/** Result shape shared by the useActionState forms on this page. */
export type FormState = { error?: string; success?: string } | null;

/** Add a door code (door-codes permission). */
export async function addDoorCode(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, member } = await requireOfficer("door_codes");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Name the door or lock." };
  if (title.length > 80) return { error: "That name is too long." };

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the code." };
  if (code.length > 60) return { error: "That code is too long." };

  const { error } = await supabase.from("door_codes").insert({
    title,
    code,
    created_by: member.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/officer/door-codes");
  return { success: `${title} added.` };
}

/** Edit an existing door code (door-codes permission). */
export async function updateDoorCode(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase } = await requireOfficer("door_codes");

  const id = String(formData.get("door_code_id") ?? "").trim();
  if (!id) return { error: "Missing code." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Name the door or lock." };
  if (title.length > 80) return { error: "That name is too long." };

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter the code." };
  if (code.length > 60) return { error: "That code is too long." };

  const { error } = await supabase
    .from("door_codes")
    .update({ title, code, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/officer/door-codes");
  return { success: "Saved." };
}

/** Delete a door code (door-codes permission). */
export async function deleteDoorCode(
  id: string,
): Promise<{ error: string } | null> {
  const { supabase } = await requireOfficer("door_codes");

  if (!id) return { error: "Missing code." };

  const { error } = await supabase.from("door_codes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/officer/door-codes");
  return null;
}
