"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { formatStudioClock } from "@/lib/studio";
import { studentSignIn, studentSignOut } from "../actions";

export type OpenStudioSession = {
  id: string;
  student_name: string;
  signed_in_at: string;
};

/**
 * Students sign in with their name — plus which class they're here for, or
 * toggled to open studio time (which they sign out of from the list below).
 */
export function StudentForm({
  openSessions,
}: {
  openSessions: OpenStudioSession[];
}) {
  const [state, formAction, pending] = useActionState(studentSignIn, null);
  const [openStudio, setOpenStudio] = useState(false);

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
          href="/kiosk"
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

      <OpenStudioList sessions={openSessions} />
    </>
  );
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

  if (sessions.length === 0 && !message) return null;

  const signOut = (session: OpenStudioSession) => {
    setBusyId(session.id);
    startTransition(async () => {
      // revalidatePath("/kiosk/student") in the action refreshes the list.
      const res = await studentSignOut(session.id);
      if ("error" in res) {
        setError(res.error);
      } else {
        setError(null);
        setMessage(`See you next time, ${res.name.split(" ")[0]}! ✌️`);
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
