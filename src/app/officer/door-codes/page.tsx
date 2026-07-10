import { requireOfficer } from "@/lib/auth";
import { canManageDoorCodes } from "@/lib/roles";
import type { DoorCode } from "@/lib/types";
import { DoorCodesManager } from "./DoorCodesManager";

export const dynamic = "force-dynamic";

export default async function OfficerDoorCodesPage() {
  const { supabase, member } = await requireOfficer();

  const { data } = await supabase
    .from("door_codes")
    .select("id, title, code, created_by, created_at, updated_at")
    .order("created_at", { ascending: true });

  const codes: DoorCode[] = data ?? [];
  const canManage = canManageDoorCodes(member.role);

  return (
    <div className="anim-fade">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Door codes</h1>
        <p className="mt-1 text-sm text-muted">
          {canManage
            ? "Add the studio's door and lock codes. Every active member can see them; deactivated members can't."
            : "The studio's door and lock codes. Only the president and vice president can change them."}
        </p>
      </header>

      <div className="mt-6">
        {canManage ? (
          <DoorCodesManager codes={codes} />
        ) : (
          <ul className="flex flex-col gap-2">
            {codes.length === 0 ? (
              <p className="text-sm text-muted">No door codes yet.</p>
            ) : (
              codes.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <span className="text-sm font-medium">{c.title}</span>
                  <span className="font-mono text-sm tracking-wider text-accent">
                    {c.code}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
