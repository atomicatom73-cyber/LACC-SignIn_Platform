"use client";

import { useState } from "react";
import { roleOrTitleLabel } from "@/lib/roles";
import { formatStudioDate, formatStudioDateTime } from "@/lib/studio";
import type { Message, MessageAudience } from "@/lib/types";

/** 'all' is the legacy audience value — it meant active members. */
const AUDIENCE_LABELS: Record<MessageAudience, string> = {
  all: "All members",
  active: "Active members",
  inactive: "Inactive members",
  everyone: "Everyone",
  selected: "Selected members",
};

export type SentMessage = Pick<
  Message,
  "id" | "sender_role" | "subject" | "body" | "audience" | "created_at"
> & {
  recipients: { member_id: string; full_name: string; read_at: string | null }[];
};

export function SentList({ messages }: { messages: SentMessage[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing sent yet — announcements you send will show up here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {messages.map((message) => {
        const expanded = expandedId === message.id;
        const total = message.recipients.length;
        const read = message.recipients.filter((r) => r.read_at !== null).length;
        const pct = total === 0 ? 0 : Math.round((read / total) * 100);

        return (
          <li
            key={message.id}
            className="rounded-2xl border border-border bg-surface px-4 py-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-accent">
                {roleOrTitleLabel(message.sender_role)}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {formatStudioDateTime(message.created_at)}
              </span>
            </div>
            <div className="mt-1 font-semibold">{message.subject}</div>
            <p className="mt-2 whitespace-pre-line text-sm text-foreground/90">
              {message.body}
            </p>

            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : message.id)}
              className="mt-3 w-full border-t border-border pt-3 text-left"
            >
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <span>{AUDIENCE_LABELS[message.audience] ?? "Members"}</span>
                <span className="tabular-nums">
                  {read} of {total} read {expanded ? "▴" : "▾"}
                </span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>

            {expanded && (
              <div className="mt-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted">
                  Recipients
                </div>
                <ul className="max-h-64 overflow-y-auto">
                  {message.recipients.map((r) => (
                    <li
                      key={r.member_id}
                      className="flex items-center justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-b-0"
                    >
                      <span>{r.full_name}</span>
                      {r.read_at ? (
                        <span className="text-xs text-success">
                          Read {formatStudioDate(r.read_at)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">unread</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
