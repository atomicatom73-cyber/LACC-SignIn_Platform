"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

const KIOSK_COOKIE = "kiosk_ok";

/** Check the shared PIN and unlock the kiosk on this device. */
export async function unlockKiosk(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const pin = String(formData.get("pin") ?? "").trim();
  const expected = process.env.KIOSK_PIN;

  if (!expected) {
    return { error: "Kiosk PIN is not configured on the server." };
  }
  if (pin !== expected) {
    return { error: "Incorrect PIN. Try again." };
  }

  const store = await cookies();
  store.set(KIOSK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return null;
}

export async function lockKiosk() {
  const store = await cookies();
  store.delete(KIOSK_COOKIE);
  revalidatePath("/kiosk");
}

export async function isKioskUnlocked(): Promise<boolean> {
  const store = await cookies();
  return store.get(KIOSK_COOKIE)?.value === "1";
}

/** Toggle a member's shift from the shared kiosk. Returns the new state. */
export async function toggleKioskShift(
  memberId: string,
): Promise<{ nowIn: boolean; name: string }> {
  if (!(await isKioskUnlocked())) {
    throw new Error("Kiosk is locked.");
  }

  const supabase = createAdminClient();

  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("id, full_name")
    .eq("id", memberId)
    .single();
  if (memberErr || !member) throw new Error("Member not found.");

  const { data: openShift } = await supabase
    .from("shifts")
    .select("id")
    .eq("member_id", memberId)
    .is("signed_out_at", null)
    .maybeSingle();

  if (openShift) {
    await supabase
      .from("shifts")
      .update({ signed_out_at: new Date().toISOString() })
      .eq("id", openShift.id);
    revalidatePath("/kiosk");
    return { nowIn: false, name: member.full_name };
  }

  await supabase
    .from("shifts")
    .insert({ member_id: memberId, source: "kiosk" });
  revalidatePath("/kiosk");
  return { nowIn: true, name: member.full_name };
}
