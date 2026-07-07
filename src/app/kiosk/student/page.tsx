import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Logo } from "@/components/Brand";
import { StudentForm, type OpenStudioSession } from "./StudentForm";

export const dynamic = "force-dynamic";

/** Student sign-in for class attendees and open-studio visitors — no account needed. */
export default async function KioskStudentPage() {
  const supabase = createAdminClient();

  // Anyone who forgot to sign out stays signed in until end of that day.
  await supabase.rpc("close_stale_shifts");

  const { data } = await supabase
    .from("student_signins")
    .select("id, student_name, signed_in_at")
    .eq("session_type", "open_studio")
    .is("signed_out_at", null)
    .order("signed_in_at", { ascending: true });

  const openSessions: OpenStudioSession[] = data ?? [];

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/kiosk" className="inline-block text-sm text-muted">
        ← Back to quick sign in
      </Link>

      <div className="mb-6 mt-6 flex flex-col items-center text-center">
        <Logo className="mb-4 h-12 w-12 text-lg" />
        <h1 className="text-2xl font-bold tracking-tight">
          Sign in as student
        </h1>
        <p className="mt-2 text-sm text-muted">
          Here for a class or open studio time? Sign in with your name.
        </p>
      </div>

      <StudentForm openSessions={openSessions} />
    </main>
  );
}
