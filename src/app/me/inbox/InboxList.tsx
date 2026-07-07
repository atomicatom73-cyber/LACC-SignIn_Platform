"use client";

import { useTransition } from "react";
import { ROLE_LABELS } from "@/lib/roles";
import { formatStudioDateTime } from "@/lib/studio";
import type { Message } from "@/lib/types";
import { markRead } from "./actions";

export type InboxItem = Pick<
  Message,
  "id" | "sender_role" | "subject" | "body" | "created_at"
> & {
  read_at: string | null;
};

/**
 * Announcements are always fully readable — no tap needed to see the body.
 * Unread ones glow; tapping an unread card just dismisses the alert (marks
 * it read). Read cards aren't interactive at all.
 */
export function InboxList({ items }: { items: InboxItem[] }) {
  const [, startTransition] = useTransition();

  const dismiss = (item: InboxItem) => {
    if (item.read_at !== null) return;
    startTransition(async () => {
      await markRead(item.id);
    });
  };

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const unread = item.read_at === null;

        const content = (
          <>
            <div className="flex items-center justify-between gap-3">
              <span
                className={`text-xs font-semibold uppercase tracking-wide ${
                  unread ? "text-background/80" : "text-accent"
                }`}
              >
                From the {ROLE_LABELS[item.sender_role]}
              </span>
              {unread && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span aria-hidden>📣</span>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
                    New
                  </span>
                </span>
              )}
            </div>
            <div className="mt-1 text-base font-bold">{item.subject}</div>
            <div
              className={`mt-1 text-xs ${
                unread ? "text-background/80" : "text-muted"
              }`}
            >
              {formatStudioDateTime(item.created_at)}
            </div>
            <p
              className={`mt-3 whitespace-pre-line border-t pt-3 text-sm ${
                unread
                  ? "border-background/25 text-background"
                  : "border-border text-foreground"
              }`}
            >
              {item.body}
            </p>
          </>
        );

        if (unread) {
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => dismiss(item)}
                className="announce-banner w-full rounded-2xl px-4 py-4 text-left text-background transition active:scale-[0.99]"
              >
                {content}
                <span className="mt-3 block text-center text-xs font-semibold uppercase tracking-wide text-background/80">
                  Tap to dismiss
                </span>
              </button>
            </li>
          );
        }

        return (
          <li
            key={item.id}
            className="rounded-2xl border border-border bg-surface px-4 py-4"
          >
            {content}
          </li>
        );
      })}
    </ul>
  );
}
