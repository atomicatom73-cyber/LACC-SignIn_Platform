"use client";

import { useActionState } from "react";
import { GuestPayment } from "@/components/GuestPayment";
import { kioskGuestSignIn } from "../actions";

export type HostOption = { id: string; full_name: string };

/**
 * Kiosk guest sign-in: pick which (currently signed-in) member is hosting,
 * enter the guest's name, then show the payment reminder.
 */
export function GuestForm({ hosts }: { hosts: HostOption[] }) {
  const [state, formAction, pending] = useActionState(kioskGuestSignIn, null);

  if (state && "success" in state) {
    return <GuestPayment guestName={state.name} />;
  }

  if (hosts.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-6 text-center">
        <p className="font-medium">Nobody is signed in right now.</p>
        <p className="mt-2 text-sm text-muted">
          Guests come in with a member — sign yourself in on the quick sign-in
          screen first, then bring your guest.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted">
          Which member are you with?
        </span>
        <select
          name="host_member_id"
          required
          defaultValue=""
          className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
        >
          <option value="" disabled>
            Pick a signed-in member…
          </option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.full_name}
            </option>
          ))}
        </select>
      </label>

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
