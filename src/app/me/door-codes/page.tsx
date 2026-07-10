import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { isOfficer } from "@/lib/roles";
import type { DoorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MemberDoorCodesPage() {
  const { supabase, member } = await requireMember();
  if (!member) redirect("/me");
  // Officers manage codes from their own dashboard.
  if (isOfficer(member.role)) redirect("/officer/door-codes");
  // Deactivated members lose access to the codes.
  if (!member.active) redirect("/me");

  const { data } = await supabase
    .from("door_codes")
    .select("id, title, code, created_by, created_at, updated_at")
    .order("created_at", { ascending: true });

  const codes: DoorCode[] = data ?? [];

  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/me" className="inline-block text-sm text-muted">
        ← Back
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight">🔑 Door codes</h1>
        <p className="mt-1 text-sm text-muted">
          Studio access codes. Please keep them to yourself.
        </p>
      </header>

      <section className="mt-6 flex-1">
        {codes.length === 0 ? (
          <p className="text-sm text-muted">
            No door codes posted yet — check back later.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {codes.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
              >
                <span className="text-sm font-medium">{c.title}</span>
                <span className="font-mono text-lg font-bold tracking-widest text-accent">
                  {c.code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
