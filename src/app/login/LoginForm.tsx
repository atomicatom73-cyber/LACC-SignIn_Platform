"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Brand";
import {
  OFFICER_ACCOUNTS,
  OFFICER_ROLES,
  ROLE_LABELS,
  memberLoginEmail,
} from "@/lib/roles";
import { registerMember } from "./actions";

type Mode = "member" | "officer";

/**
 * Turn any thrown value into a message the person at the studio can act on.
 * A misconfigured deployment (missing env vars) used to throw synchronously
 * and freeze the button at "Signing in…" — never again.
 */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/supabase|url|key|env/i.test(message)) {
    return `The app isn't fully set up (${message}). Tell an officer to check the deployment settings.`;
  }
  return message || "Something went wrong — please try again.";
}

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>("member");
  const [creating, setCreating] = useState(false);

  const memberCreating = mode === "member" && creating;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="anim-fade w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block text-sm text-muted">
          ← Back
        </Link>

        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-5 h-14 w-14 text-xl" />
          <h1 className="text-2xl font-bold tracking-tight">
            {memberCreating ? "Welcome" : "Welcome back"}
          </h1>
          <p className="mt-2 text-muted">
            {mode === "member"
              ? memberCreating
                ? "Pick a name, password, and studio PIN — no email needed."
                : "Just your name and password."
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

        <div key={mode} className="anim-fade">
          {mode === "member" ? (
            <MemberLogin
              initialError={initialError}
              creating={creating}
              setCreating={setCreating}
            />
          ) : (
            <OfficerLogin />
          )}
        </div>
      </div>
    </main>
  );
}

function MemberLogin({
  initialError,
  creating,
  setCreating,
}: {
  initialError?: string | null;
  creating: boolean;
  setCreating: (v: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">(
    initialError ? "error" : "idle",
  );
  const [message, setMessage] = useState(initialError ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      let email = memberLoginEmail(name);

      if (creating) {
        const result = await registerMember(name, password, pin);
        if ("error" in result) {
          setStatus("error");
          setMessage(result.error);
          return;
        }
        email = result.email;
      }

      if (!email) {
        setStatus("error");
        setMessage("Please use letters or numbers in your name.");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        // Name-based login: the address is synthetic, derived from the name.
        email,
        password,
      });

      if (error) {
        setStatus("error");
        setMessage(
          error.message === "Invalid login credentials"
            ? "No account matches that name and password. Check the spelling — or create an account below."
            : error.message,
        );
        return;
      }

      router.push("/me");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {creating && (
        <div className="rounded-2xl border-2 border-accent bg-accent/10 px-4 py-3 text-center">
          <div className="text-sm font-bold uppercase tracking-wide text-accent">
            ⚠️ Paying members only
          </div>
          <p className="mt-1 text-sm text-foreground/90">
            Please don&apos;t create an account unless you&apos;re a paying
            member of Los Alamos Community Ceramics. Here for a class or
            visiting? Use the quick sign-in screen instead.
          </p>
        </div>
      )}
      <input
        type="text"
        autoComplete="name"
        required
        placeholder="Your full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
      />
      <input
        type="password"
        autoComplete={creating ? "new-password" : "current-password"}
        required
        minLength={creating ? 8 : undefined}
        placeholder={creating ? "Choose a password (8+ characters)" : "Password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
      />
      {creating && (
        <label className="flex flex-col gap-1.5">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            pattern="\d{4}"
            maxLength={4}
            placeholder="4-digit studio PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
          />
          <span className="px-1 text-xs text-muted">
            You&apos;ll tap this PIN on the studio&apos;s quick sign-in screen.
          </span>
        </label>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending"
          ? creating
            ? "Creating account…"
            : "Signing in…"
          : creating
            ? "Create account"
            : "Sign in"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <button
        type="button"
        onClick={() => {
          setCreating(!creating);
          setStatus("idle");
          setMessage("");
        }}
        className="text-center text-sm text-accent"
      >
        {creating
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
      {creating ? (
        <p className="text-center text-xs text-muted">
          No email needed — your name is your login. Use the same name the
          studio knows you by.
        </p>
      ) : (
        <p className="text-center text-xs text-muted">
          Forgot your password? Ask the president — they can set a new one for
          you from their Members page.
        </p>
      )}
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

    try {
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
    } catch (err) {
      setStatus("error");
      setMessage(describeError(err));
    }
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
