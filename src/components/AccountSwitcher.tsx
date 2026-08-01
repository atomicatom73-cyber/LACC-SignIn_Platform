"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { removeAccount, switchAccount } from "@/app/switch/actions";

export type SwitcherAccount = { label: string; kind: string };

/**
 * The header control that flips between the two accounts signed in on this
 * device — an officer's shared login and their own member account (see
 * lib/alt-session for why both live here rather than being linked in the
 * database).
 */
export function AccountSwitcher({
  current,
  parked,
}: {
  current: SwitcherAccount;
  parked: SwitcherAccount | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const flip = () => {
    setError(null);
    startTransition(async () => {
      // A successful switch redirects, so anything returned is a failure.
      const res = await switchAccount();
      if (res?.error) {
        setError(res.error);
        setOpen(false);
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-muted transition active:scale-[0.97]"
      >
        <span className="max-w-[7.5rem] truncate">{current.label}</span>
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <>
          {/* Tap-anywhere-to-close backdrop, under the menu. */}
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
            <div className="border-b border-border px-3 py-2.5">
              <div className="text-sm font-semibold">{current.label}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted">
                {current.kind} · signed in
              </div>
            </div>

            {parked ? (
              <>
                <button
                  type="button"
                  onClick={flip}
                  disabled={pending}
                  className="block w-full px-3 py-2.5 text-left transition hover:bg-surface-2 disabled:opacity-60"
                >
                  <div className="text-sm font-medium">
                    {pending ? "Switching…" : parked.label}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">
                    {parked.kind} · tap to switch
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await removeAccount();
                      setOpen(false);
                    })
                  }
                  disabled={pending}
                  className="block w-full border-t border-border px-3 py-2 text-left text-xs text-muted transition hover:bg-surface-2 disabled:opacity-60"
                >
                  Forget {parked.label} on this device
                </button>
              </>
            ) : (
              <Link
                href="/switch"
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 text-sm font-medium transition hover:bg-surface-2"
              >
                ＋ Add your other account
                <span className="mt-0.5 block text-[11px] font-normal text-muted">
                  Stay signed in to both at once
                </span>
              </Link>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
