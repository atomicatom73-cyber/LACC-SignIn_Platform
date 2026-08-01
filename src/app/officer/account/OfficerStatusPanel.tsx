"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setKilnTeam, setOfficerStatus } from "../members/actions";

/** One member row in the exemption lists below. */
export type StatusMember = {
  id: string;
  name: string;
  officer: boolean;
  kilnTeam: boolean;
};

type Kind = "officer" | "kiln";

const KINDS = {
  officer: {
    heading: "Officer status",
    blurb:
      "Members on the board. They keep their normal account — they just sit out the monthly job draft, without spending a credit. Untick someone and they're back in the next draft. You can still hand an officer a job by assigning it directly.",
    chip: "Officer",
    read: (m: StatusMember) => m.officer,
    save: setOfficerStatus,
  },
  kiln: {
    heading: "Kiln team",
    blurb:
      "Members whose kiln work stands in for a monthly job. Same deal as officer status — they sit out the draft without spending a credit — and they're selectable as their own group when you send an announcement.",
    chip: "Kiln team",
    read: (m: StatusMember) => m.kilnTeam,
    save: setKilnTeam,
  },
} as const satisfies Record<Kind, unknown>;

/**
 * President-only: tick the members who serve on the board. Officer status is
 * about the person, not the login — they keep their normal member account and
 * everything on it, they just sit out the monthly job draft. (The shared
 * officer logins are the panel above; this is the roster of people.)
 */
export function OfficerStatusPanel({ members }: { members: StatusMember[] }) {
  return <StatusPanel members={members} kind="officer" />;
}

/** The same list for the kiln team — any officer who can manage members. */
export function KilnTeamPanel({ members }: { members: StatusMember[] }) {
  return <StatusPanel members={members} kind="kiln" />;
}

function StatusPanel({
  members,
  kind,
}: {
  members: StatusMember[];
  kind: Kind;
}) {
  const config = KINDS[kind];
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(members.map((m) => [m.id, config.read(m)])),
  );
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { granted, revoked } = useMemo(() => {
    const granted: string[] = [];
    const revoked: string[] = [];
    for (const m of members) {
      const was = config.read(m);
      const now = checked[m.id] ?? was;
      if (now && !was) granted.push(m.id);
      if (!now && was) revoked.push(m.id);
    }
    return { granted, revoked };
  }, [members, checked, config]);

  const dirty = granted.length + revoked.length > 0;

  const q = query.trim().toLowerCase();
  const visible = q
    ? members.filter((m) => m.name.toLowerCase().includes(q))
    : members;

  const exemptCount = members.filter(
    (m) => checked[m.id] ?? config.read(m),
  ).length;

  const save = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      for (const [ids, value] of [
        [granted, true],
        [revoked, false],
      ] as const) {
        if (ids.length === 0) continue;
        const res = await config.save(ids, value);
        if ("error" in res) {
          setError(res.error);
          return;
        }
      }
      setMessage(
        `Saved — ${exemptCount} member${exemptCount === 1 ? "" : "s"} exempt from jobs.`,
      );
      router.refresh();
    });
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">{config.heading}</h2>
      <p className="mt-1 text-sm text-muted">{config.blurb}</p>

      <div className="mt-4 rounded-2xl border border-border bg-surface px-5 py-5">
        {members.length === 0 ? (
          <p className="text-sm text-muted">No active members yet.</p>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              placeholder="Search by name…"
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />

            <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-border">
              {visible.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted">
                  No one matches that search.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {visible.map((m) => {
                    const on = checked[m.id] ?? config.read(m);
                    return (
                      <li key={m.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => {
                              setMessage(null);
                              setChecked((c) => ({
                                ...c,
                                [m.id]: e.target.checked,
                              }));
                            }}
                            className="h-4 w-4 shrink-0 accent-accent"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {m.name}
                          </span>
                          {on && (
                            <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                              {config.chip}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={pending || !dirty}
                className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
              <span className="text-xs text-muted">
                {exemptCount} of {members.length} exempt from jobs
                {dirty && " · unsaved changes"}
              </span>
            </div>
          </>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {message && <p className="mt-2 text-sm text-success">{message}</p>}
      </div>
    </section>
  );
}
