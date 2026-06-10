"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Brand";
import { unlockKiosk } from "./actions";

export function PinGate() {
  const [state, formAction, pending] = useActionState(unlockKiosk, null);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xs">
        <Link href="/" className="mb-8 inline-block text-sm text-muted">
          ← Back
        </Link>
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-5 h-14 w-14 text-xl" />
          <h1 className="text-2xl font-bold tracking-tight">Studio kiosk</h1>
          <p className="mt-2 text-muted">Enter the studio PIN to unlock.</p>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            name="pin"
            required
            placeholder="••••"
            className="rounded-2xl border border-border bg-surface px-5 py-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Unlocking…" : "Unlock"}
          </button>
          {state?.error && (
            <p className="text-center text-sm text-danger">{state.error}</p>
          )}
        </form>
      </div>
    </main>
  );
}
