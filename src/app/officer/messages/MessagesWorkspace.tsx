"use client";

import { useRef, useState } from "react";
import {
  BLANK_COMPOSE,
  ComposeForm,
  type ComposeInitial,
  type PickerMember,
} from "./ComposeForm";
import { DraftList, type DraftSummary } from "./DraftList";
import { SentList, type SentMessage } from "./SentList";

/**
 * Holds the three panes together so "Edit draft" and "Send again" can load a
 * message back into the composer. The composer is remounted (via `key`) rather
 * than made controllable from outside — it owns a lot of interlocking state
 * (audience, selection, edited-ness) and a fresh mount is the honest reset.
 */
export function MessagesWorkspace({
  members,
  drafts,
  messages,
}: {
  members: PickerMember[];
  drafts: DraftSummary[];
  messages: SentMessage[];
}) {
  const [initial, setInitial] = useState<ComposeInitial>(BLANK_COMPOSE);
  const [loadKey, setLoadKey] = useState(0);
  const composeRef = useRef<HTMLDivElement>(null);

  const load = (next: ComposeInitial) => {
    setInitial(next);
    setLoadKey((k) => k + 1);
    composeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <section className="mt-6" ref={composeRef}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Compose
        </h2>
        <ComposeForm key={loadKey} members={members} initial={initial} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Drafts &amp; scheduled
        </h2>
        <DraftList drafts={drafts} onEdit={load} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Sent
        </h2>
        <SentList
          messages={messages}
          onResend={(message) =>
            load({
              draftId: null,
              subject: message.subject,
              body: message.body,
              // A resend copies exactly who got it the first time, then lets
              // the officer edit — so it starts as a hand-picked list.
              audience: "selected",
              recipientIds: message.recipients.map((r) => r.member_id),
            })
          }
        />
      </section>
    </>
  );
}
