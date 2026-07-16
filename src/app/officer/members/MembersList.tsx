"use client";

import { useState } from "react";
import { ROLE_LABELS } from "@/lib/roles";
import { MemberDetail, type ChipTone, type MemberSummary } from "./MemberDetail";

export type MemberGroup = { title: string; members: MemberSummary[] };

const CHIP_CLASSES: Record<ChipTone, string> = {
  muted: "border-border bg-surface-2 text-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
  success: "border-success/40 bg-success/10 text-success",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-border bg-surface-2 text-foreground",
};

/** Searchable, grouped roster; tap a row to open its MemberDetail. */
export function MembersList({
  groups,
  viewerCanManage,
  viewerCanJobs,
  month,
  jobCatalog,
}: {
  groups: MemberGroup[];
  viewerCanManage: boolean;
  viewerCanJobs: boolean;
  month: string;
  jobCatalog: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = groups
    .map((group) => ({
      ...group,
      members: q
        ? group.members.filter((m) => m.full_name.toLowerCase().includes(q))
        : group.members,
    }))
    .filter((group) => group.members.length > 0);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        placeholder="Search by name…"
        className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
      />

      {visible.length === 0 && (
        <p className="mt-4 text-sm text-muted">No one matches that search.</p>
      )}

      {visible.map((group) => (
        <section key={group.title} className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            {group.title}
          </h2>
          <ul className="flex flex-col gap-3">
            {group.members.map((member) => {
              const expanded = expandedId === member.id;
              return (
                <li
                  key={member.id}
                  className="rounded-2xl border border-border bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : member.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3.5 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">
                        {member.full_name}
                      </span>
                      {member.role !== "member" && (
                        <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                          {member.officerTitle ?? ROLE_LABELS[member.role]}
                        </span>
                      )}
                      {member.role === "member" && !member.hasAccount && (
                        <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          No account
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {member.availableCredits > 0 && (
                        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                          {member.availableCredits} credit
                          {member.availableCredits === 1 ? "" : "s"}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP_CLASSES[member.chip.tone]}`}
                      >
                        {member.chip.label}
                      </span>
                      <span className="text-xs text-muted">
                        {expanded ? "▴" : "▾"}
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <MemberDetail
                      member={member}
                      viewerCanManage={viewerCanManage}
                      viewerCanJobs={viewerCanJobs}
                      month={month}
                      jobCatalog={jobCatalog}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
