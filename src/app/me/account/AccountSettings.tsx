"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/PasswordInput";
import {
  updateMemberEmail,
  updateMemberName,
  updateMemberPassword,
  updateMemberPin,
} from "./actions";

const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-accent";
const SAVE_CLASS =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60";

export function AccountSettings({
  initialName,
  initialEmail,
  initialPin,
}: {
  initialName: string;
  initialEmail: string | null;
  initialPin: string | null;
}) {
  return (
    <div className="anim-stagger mt-6 flex flex-col gap-4">
      <NameSection initialName={initialName} />
      <EmailSection initialEmail={initialEmail} />
      <PinSection initialPin={initialPin} />
      <PasswordSection />
    </div>
  );
}

/** Shared card shell so each editable field reads the same. */
function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {children}
    </section>
  );
}

function NameSection({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await updateMemberName(name);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setName(res.name);
      setMessage("Saved. You'll sign in with this name from now on.");
      router.refresh();
    });
  };

  return (
    <Card title="Name" hint="This is also how you sign in and appear on the quick sign-in screen.">
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          autoComplete="name"
          required
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_CLASS}
        />
        <button type="submit" disabled={pending} className={SAVE_CLASS}>
          {pending ? "Saving…" : "Save name"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}

function EmailSection({ initialEmail }: { initialEmail: string | null }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hadEmail = Boolean(initialEmail);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await updateMemberEmail(email);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setEmail(res.email);
      setMessage("Email saved.");
    });
  };

  return (
    <Card
      title={hadEmail ? "Email" : "Add your email"}
      hint="Used to sign in, recover your password, and email you new announcements."
    >
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <input
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD_CLASS}
        />
        <button type="submit" disabled={pending} className={SAVE_CLASS}>
          {pending ? "Saving…" : hadEmail ? "Save email" : "Add email"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}

function PinSection({ initialPin }: { initialPin: string | null }) {
  const [pin, setPin] = useState(initialPin ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await updateMemberPin(pin);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setPin(res.pin);
      setMessage("PIN saved.");
    });
  };

  return (
    <Card title="Studio PIN" hint="The 4 digits you tap on the studio's quick sign-in screen.">
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <PasswordInput
          inputMode="numeric"
          autoComplete="off"
          required
          pattern="\d{4}"
          maxLength={4}
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className={FIELD_CLASS}
        />
        <button type="submit" disabled={pending} className={SAVE_CLASS}>
          {pending ? "Saving…" : "Save PIN"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}

function PasswordSection() {
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
      const res = await updateMemberPassword(current, next);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage("Password changed.");
      setCurrent("");
      setNext("");
      setConfirm("");
    });
  };

  return (
    <Card
      title="Password"
      hint="For your security a password can't be shown — enter your current one to set a new one."
    >
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
        <button type="submit" disabled={pending} className={SAVE_CLASS}>
          {pending ? "Changing…" : "Change password"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}
    </Card>
  );
}
