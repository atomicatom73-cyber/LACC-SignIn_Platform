"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDuration } from "@/lib/time";
import { toggleKioskShift } from "./actions";

export type RosterMember = {
  id: string;
  full_name: string;
  openSince: string | null;
};

export function RosterGrid({ members }: { members: RosterMember[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = members.filter((m) =>
    m.full_name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function handleTap(member: RosterMember) {
    setBusyId(member.id);
    startTransition(async () => {
      try {
        // The server action calls revalidatePath("/kiosk"), which refreshes
        // the roster automatically — no router.refresh() needed.
        const res = await toggleKioskShift(member.id);
        const first = res.name.split(" ")[0];
        setToast(
          res.nowIn ? `Welcome, ${first}! 👋` : `See you, ${first}! ✌️`,
        );
      } catch {
        setToast("Something went wrong. Try again.");
      } finally {
        setBusyId(null);
      }
    });
  }

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  if (members.length === 0) {
    return (
      <p className="mt-12 text-center text-muted">
        No active members yet. Add members in Supabase to populate the roster.
      </p>
    );
  }

  return (
    <>
      <input
        type="search"
        inputMode="search"
        placeholder="Type your name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-border bg-surface px-5 py-3 text-lg outline-none focus:border-accent"
      />

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-muted">
          No one matches “{query}”. Ask an officer to add you to the roster.
        </p>
      ) : (
        <div className="anim-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((m) => (
            <RosterCard
              key={m.id}
              member={m}
              busy={pending && busyId === m.id}
              onTap={() => handleTap(m)}
            />
          ))}
        </div>
      )}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] flex justify-center px-4"
      >
        {toast && (
          <div className="rounded-full bg-foreground px-6 py-3 text-lg font-semibold text-background shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </>
  );
}

function RosterCard({
  member,
  busy,
  onTap,
}: {
  member: RosterMember;
  busy: boolean;
  onTap: () => void;
}) {
  const isIn = member.openSince !== null;
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!member.openSince) return;
    const start = new Date(member.openSince).getTime();
    const tick = () => setElapsed(formatDuration(Date.now() - start));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [member.openSince]);

  const initials = member.full_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <button
      onClick={onTap}
      disabled={busy}
      className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition active:scale-[0.97] disabled:opacity-50 ${
        isIn
          ? "border-success/50 bg-success/10"
          : "border-border bg-surface"
      }`}
    >
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ${
          isIn ? "bg-success text-background" : "bg-surface-2 text-foreground"
        }`}
      >
        {initials}
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-tight">
        {member.full_name}
      </div>
      <div className="text-xs text-muted">
        {busy ? "…" : isIn ? `In · ${elapsed || "0m"}` : "Tap to sign in"}
      </div>
    </button>
  );
}
