"use client";

import Link from "next/link";
import { useActionState } from "react";
import { studentSignIn } from "../actions";

/** Class students sign in with their name + which class they're here for. */
export function StudentForm() {
  const [state, formAction, pending] = useActionState(studentSignIn, null);

  if (state && "success" in state) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 px-5 py-6 text-center">
        <div className="text-3xl" aria-hidden>
          ✅
        </div>
        <h2 className="mt-2 text-lg font-bold">
          You&apos;re signed in, {state.name.split(" ")[0]}!
        </h2>
        <p className="mt-1 text-sm text-muted">Have a great class. 🏺</p>
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
    <form action={formAction} className="flex flex-col gap-4">
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
          Which class?
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
  );
}
