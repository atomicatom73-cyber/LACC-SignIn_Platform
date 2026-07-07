"use client";

import { useActionState } from "react";
import { GuestPayment } from "@/components/GuestPayment";
import { myGuestSignIn } from "../actions";

/** Guest sign-in from the member's own account (host = the logged-in member). */
export function MyGuestForm() {
  const [state, formAction, pending] = useActionState(myGuestSignIn, null);

  if (state && "success" in state) {
    return <GuestPayment guestName={state.name} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted">
          Guest&apos;s name
        </span>
        <input
          type="text"
          name="guest_name"
          required
          autoComplete="off"
          placeholder="“Jane Doe”"
          className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign guest in"}
      </button>
      {state?.error && (
        <p className="text-center text-sm text-danger">{state.error}</p>
      )}
    </form>
  );
}
