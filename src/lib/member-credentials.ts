import { createClient as createBareClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberLoginEmail } from "@/lib/roles";

/** A member row matched by name + a proven credential. */
export type MemberCredentialMatch = {
  id: string;
  user_id: string | null;
  full_name: string;
};

/**
 * Prove ownership of a personal member account with its name plus EITHER the
 * account password OR the 4-digit studio PIN. Returns the member row on a
 * match, null otherwise. SERVER ONLY (uses the service role + a bare
 * sign-in client).
 *
 * Only role='member' accounts qualify — the shared officer logins recover a
 * different way. A 4-digit credential is treated as a PIN (member passwords
 * are always 8+ characters, so there's no overlap); anything else is checked
 * as the password.
 */
export async function verifyMemberCredential(
  fullName: string,
  credentialRaw: string,
): Promise<MemberCredentialMatch | null> {
  const email = memberLoginEmail(fullName);
  if (!email) return null;
  const credential = credentialRaw.trim();
  if (!credential) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("members")
    .select("id, user_id, full_name, pin, role")
    .eq("role", "member")
    .not("user_id", "is", null);

  const member = (data ?? []).find(
    (m) => memberLoginEmail(m.full_name) === email,
  );
  if (!member || !member.user_id) return null;

  const match: MemberCredentialMatch = {
    id: member.id,
    user_id: member.user_id,
    full_name: member.full_name,
  };

  // A 4-digit credential is a PIN.
  if (/^\d{4}$/.test(credential)) {
    return member.pin && member.pin === credential ? match : null;
  }

  // Otherwise verify it as the account password with a throwaway client that
  // never persists a session (this runs without auth cookies).
  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signIn, error } = await bare.auth.signInWithPassword({
    email,
    password: credential,
  });
  return signIn?.user && !error ? match : null;
}
