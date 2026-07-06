"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Brand";
import { OFFICER_ACCOUNTS, OFFICER_ROLES, ROLE_LABELS } from "@/lib/roles";

type Mode = "member" | "officer";

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>("member");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block text-sm text-muted">
          ← Back
        </Link>

        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-5 h-14 w-14 text-xl" />
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted">
            {mode === "member"
              ? "We'll email you a one-tap login link."
              : "Shared officer account — pick your role and enter its password."}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-2xl border border-border bg-surface p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setMode("member")}
            className={`rounded-xl px-3 py-2 transition ${
              mode === "member" ? "bg-accent text-background" : "text-muted"
            }`}
          >
            Member
          </button>
          <button
            type="button"
            onClick={() => setMode("officer")}
            className={`rounded-xl px-3 py-2 transition ${
              mode === "officer" ? "bg-accent text-background" : "text-muted"
            }`}
          >
            Officer
          </button>
        </div>

        {mode === "member" ? (
          <MemberLogin initialError={initialError} />
        ) : (
          <OfficerLogin />
        )}
      </div>
    </main>
  );
}

function MemberLogin({ initialError }: { initialError?: string | null }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    initialError ? "error" : "idle",
  );
  const [message, setMessage] = useState(initialError ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("sending");
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/me`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <div className="text-4xl">📬</div>
        <p className="mt-3 font-semibold">Check your email</p>
        <p className="mt-1 text-sm text-muted">
          We sent a login link to <br />
          <span className="text-foreground">{email}</span>
        </p>
        <button
          onClick={() => setStatus("idle")}
          className="mt-5 text-sm text-accent"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send login link"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <p className="text-center text-xs text-muted">
        New here? Enter your email and we&apos;ll set up your member account
        from the same link.
      </p>
    </form>
  );
}

function OfficerLogin() {
  const router = useRouter();
  const [role, setRole] = useState<(typeof OFFICER_ROLES)[number]>("president");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      // Shared officer logins are name-based; the address is synthetic.
      email: OFFICER_ACCOUNTS[role],
      password,
    });

    if (error) {
      setStatus("error");
      setMessage(
        error.message === "Invalid login credentials"
          ? "Wrong password for that role."
          : error.message,
      );
      return;
    }
    // /me routes officer accounts on to the officer dashboard.
    router.push("/me");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {OFFICER_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`rounded-2xl border px-5 py-3 text-left text-lg transition ${
              role === r
                ? "border-accent bg-accent/10 font-semibold"
                : "border-border bg-surface text-muted"
            }`}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <input
        type="password"
        autoComplete="current-password"
        required
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Signing in…" : "Sign in"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <p className="text-center text-xs text-muted">
        Officer accounts (President, Vice President, Volunteer Coordinator) are
        shared logins handed to whoever holds the role.
      </p>
    </form>
  );
}
