"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { formatStudioClock } from "@/lib/studio";
import { useOfflineQueue } from "@/components/OfflineQueueSync";
import {
  enqueue,
  isOffline,
  newEventId,
  serverReachable,
  studioNowIso,
  type StoredEvent,
} from "@/lib/offline-queue";
import {
  studentSignIn,
  studentSignOut,
  type StudentFormState,
} from "../actions";

export type OpenStudioSession = {
  id: string;
  student_name: string;
  signed_in_at: string;
};

/**
 * Students sign in with their name — plus which class they're here for, or
 * toggled to open studio time (which they sign out of from the list below).
 *
 * Works with the wifi down: sign-ins and sign-outs are saved on the tablet and
 * written to the log once it's back. See src/lib/offline-queue.ts.
 */
export function StudentForm({
  openSessions,
  doneHref,
}: {
  openSessions: OpenStudioSession[];
  /** Where "Done" goes — the kiosk, or /me for a member who came from there. */
  doneHref: string;
}) {
  const [state, formAction, pending] = useActionState(signInWithQueue, null);
  const [openStudio, setOpenStudio] = useState(false);
  const { pending: queued } = useOfflineQueue();

  if (state && "success" in state) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 px-5 py-6 text-center">
        <div className="text-3xl" aria-hidden>
          ✅
        </div>
        <h2 className="mt-2 text-lg font-bold">
          You&apos;re signed in, {state.name.split(" ")[0]}!
        </h2>
        <p className="mt-1 text-sm text-muted">
          {state.openStudio
            ? "Come back here and tap “Sign out” when you head home."
            : "Have a great class. 🏺"}
        </p>
        <Link
          href={doneHref}
          className="mt-4 inline-block rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-semibold transition active:scale-[0.98]"
        >
          Done
        </Link>
      </div>
    );
  }

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label="What are you here for?"
          className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface p-1.5"
        >
          <ToggleOption
            label="🎓 A class"
            selected={!openStudio}
            onSelect={() => setOpenStudio(false)}
          />
          <ToggleOption
            label="🏺 Open studio"
            selected={openStudio}
            onSelect={() => setOpenStudio(true)}
          />
        </div>
        <input
          type="hidden"
          name="session_type"
          value={openStudio ? "open_studio" : "class"}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            Your name
          </span>
          <input
            type="text"
            name="student_name"
            required
            autoComplete="name"
            placeholder="“Jane Doe”"
            className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted">
            {openStudio ? "Which class did you do?" : "Which class?"}
          </span>
          <input
            type="text"
            name="class_label"
            required
            autoComplete="off"
            placeholder="“wednesday night class”"
            className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
          />
        </label>

        {openStudio && (
          <p className="text-sm text-muted">
            Signing in for open studio time — sign out from this screen when
            you leave.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {state?.error && (
          <p className="text-center text-sm text-danger">{state.error}</p>
        )}
      </form>

      <OpenStudioList sessions={applyQueuedSessions(openSessions, queued)} />
    </>
  );
}

/**
 * Sign in, falling back to the tablet's queue when the request can't reach the
 * server. A rejected action means either a dropped connection or a server that
 * threw, so check which before claiming the sign-in was saved.
 */
async function signInWithQueue(
  prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  if (isOffline()) return queueStudentIn(formData);
  try {
    return await studentSignIn(prev, formData);
  } catch {
    if (await serverReachable()) {
      return { error: "The studio's system had a problem — please try again." };
    }
    return queueStudentIn(formData);
  }
}

async function queueStudentIn(formData: FormData): Promise<StudentFormState> {
  const openStudio = formData.get("session_type") === "open_studio";
  const studentName = String(formData.get("student_name") ?? "").trim();
  const classLabel = String(formData.get("class_label") ?? "").trim();
  // Same checks the server would have run, so an offline mistake is caught here
  // rather than surfacing as a rejection hours later.
  if (!studentName) return { error: "Enter your name." };
  if (!classLabel) {
    return {
      error: openStudio
        ? "Enter which class you did."
        : "Enter which class you're here for.",
    };
  }
  if (studentName.length > 80 || classLabel.length > 80) {
    return { error: "Keep the name and class under 80 characters." };
  }

  const saved = await enqueue({
    kind: "student-in",
    id: newEventId(),
    at: studioNowIso(),
    studentName,
    classLabel,
    openStudio,
  });
  if (!saved) {
    return {
      error: "No connection, and this tablet can't save it — please use paper.",
    };
  }
  return { success: true, name: studentName, openStudio };
}

/**
 * Fold queued taps into the open-studio list: someone who signed in offline can
 * still sign themselves out, and someone who already tapped out is gone from
 * the list even though the cached page still lists them.
 */
function applyQueuedSessions(
  sessions: OpenStudioSession[],
  queued: StoredEvent[],
): OpenStudioSession[] {
  if (queued.length === 0) return sessions;

  const signedOut = new Set(
    queued.flatMap((event) =>
      event.kind === "student-out" ? [event.signinId] : [],
    ),
  );
  const offlineSessions = queued.flatMap((event) =>
    event.kind === "student-in" && event.openStudio
      ? [
          {
            // The event id is the row id the sync will insert under, so a
            // sign-out queued against it resolves once both have synced.
            id: event.id,
            student_name: event.studentName,
            signed_in_at: event.at,
          },
        ]
      : [],
  );

  return [...sessions, ...offlineSessions]
    .filter((session) => !signedOut.has(session.id))
    .sort((a, b) => a.signed_in_at.localeCompare(b.signed_in_at));
}

function ToggleOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[0.98] ${
        selected ? "bg-accent text-background" : "text-muted"
      }`}
    >
      {label}
    </button>
  );
}

/** Open-studio students currently in the studio, with tap-to-sign-out. */
function OpenStudioList({ sessions }: { sessions: OpenStudioSession[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refresh: refreshQueue } = useOfflineQueue();

  if (sessions.length === 0 && !message) return null;

  const queueSignOut = async (session: OpenStudioSession) => {
    const saved = await enqueue({
      kind: "student-out",
      id: newEventId(),
      at: studioNowIso(),
      signinId: session.id,
      studentName: session.student_name,
    });
    // Fold the new event into state before the transition ends so the row
    // disappears immediately instead of a frame later.
    await refreshQueue();
    if (saved) {
      setError(null);
      setMessage(
        `Saved on the tablet — see you next time, ${
          session.student_name.split(" ")[0]
        }! ✌️`,
      );
    } else {
      setError("No connection, and this tablet can't save it — please use paper.");
    }
  };

  const signOut = (session: OpenStudioSession) => {
    setBusyId(session.id);
    startTransition(async () => {
      if (isOffline()) {
        await queueSignOut(session);
        setBusyId(null);
        return;
      }
      try {
        // revalidatePath("/kiosk/student") in the action refreshes the list.
        const res = await studentSignOut(session.id);
        if ("error" in res) {
          setError(res.error);
        } else {
          setError(null);
          setMessage(`See you next time, ${res.name.split(" ")[0]}! ✌️`);
        }
      } catch {
        if (await serverReachable()) {
          setError("The studio's system had a problem — please try again.");
        } else {
          await queueSignOut(session);
        }
      }
      setBusyId(null);
    });
  };

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        In for open studio — tap to sign out
      </h2>
      {message && <p className="mb-2 text-sm text-success">{message}</p>}
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {s.student_name}
              </span>
              <span className="text-xs text-muted">
                In since {formatStudioClock(s.signed_in_at)}
              </span>
            </span>
            <button
              onClick={() => signOut(s)}
              disabled={pending}
              className="shrink-0 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60"
            >
              {pending && busyId === s.id ? "…" : "Sign out"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
