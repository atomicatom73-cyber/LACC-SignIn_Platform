"use client";

import { useState, useTransition } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import {
  changeOfficerPassword,
  linkRecoveryMember,
  unlinkRecoveryMember,
} from "./actions";

const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent";

export function AccountSettings({
  roleLabel,
  initialLinkedName,
}: {
  roleLabel: string;
  initialLinkedName: string | null;
}) {
  return (
    <main className="anim-fade">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <p className="mt-1 text-muted">
        {roleLabel} — a login shared by whoever holds the role.
      </p>

      <div className="anim-stagger mt-6 grid gap-4 sm:grid-cols-2">
        <ChangePassword />
        <RecoveryLink initialLinkedName={initialLinkedName} />
      </div>
    </main>
  );
}

/** Change the shared officer password (current password required). */
function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }

    startTransition(async () => {
      const res = await changeOfficerPassword(current, next);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage("Password changed. It's shared with whoever holds this role.");
      setCurrent("");
      setNext("");
      setConfirm("");
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5">
      <h2 className="text-base font-semibold">Change password</h2>
      <p className="mt-1 text-xs text-muted">
        This is the shared login for your role. Changing it changes it for
        everyone who signs in as this officer.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <PasswordInput
          autoComplete="current-password"
          required
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={FIELD_CLASS}
        />
        <PasswordInput
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="New password (8+ characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={FIELD_CLASS}
        />
        <PasswordInput
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={FIELD_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Changing…" : "Change password"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </section>
  );
}

/**
 * Link the officer login to a personal member account so the officer password
 * can be recovered from the login screen by proving that member's password or
 * PIN.
 */
function RecoveryLink({
  initialLinkedName,
}: {
  initialLinkedName: string | null;
}) {
  const [linkedName, setLinkedName] = useState<string | null>(
    initialLinkedName,
  );
  const [name, setName] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await linkRecoveryMember(name, credential);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setLinkedName(res.name);
      setName("");
      setCredential("");
    });
  };

  const handleUnlink = () => {
    setError(null);
    startTransition(async () => {
      const res = await unlinkRecoveryMember();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setLinkedName(null);
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5">
      <h2 className="text-base font-semibold">Password recovery</h2>
      <p className="mt-1 text-xs text-muted">
        Link your own personal member account. If you ever forget this officer
        password, you can reset it from the login screen using that member
        account&apos;s password or studio PIN.
      </p>

      {linkedName ? (
        <div className="mt-4">
          <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-muted">
              Linked to
            </div>
            <div className="mt-0.5 text-sm font-semibold">{linkedName}</div>
          </div>
          <button
            onClick={handleUnlink}
            disabled={pending}
            className="mt-3 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-danger transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Removing…" : "Remove link"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleLink} className="mt-4 flex flex-col gap-3">
          <input
            type="text"
            autoComplete="off"
            required
            placeholder="Your member account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_CLASS}
          />
          <PasswordInput
            autoComplete="off"
            required
            placeholder="That account's password or 4-digit PIN"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
          >
            {pending ? "Linking…" : "Link member account"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
