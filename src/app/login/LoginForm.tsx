"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Brand";
import { PasswordInput } from "@/components/PasswordInput";
import { OFFICER_ACCOUNTS, OFFICER_ROLES, ROLE_LABELS } from "@/lib/roles";
import {
  registerMember,
  resetOfficerPasswordViaMember,
  resetPasswordWithPin,
  resetPinWithPassword,
  sendPasswordResetEmail,
  signIn,
  signInMember,
} from "./actions";

type Mode = "member" | "officer";
type MemberView =
  | "signin"
  | "create"
  | "forgot-password"
  | "forgot-pin"
  | "forgot-password-email";

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

const HEADINGS: Record<MemberView, { title: string; blurb: string }> = {
  signin: { title: "Welcome back", blurb: "Just your name and password." },
  create: {
    title: "Welcome",
    blurb: "Pick a name, password, and studio PIN — no email needed.",
  },
  "forgot-password": {
    title: "Reset your password",
    blurb: "Prove it's you with your studio PIN, then pick a new password.",
  },
  "forgot-pin": {
    title: "Reset your PIN",
    blurb: "Prove it's you with your password, then pick a new 4-digit PIN.",
  },
  "forgot-password-email": {
    title: "Reset your password",
    blurb: "Enter the email on your account and we'll send you a reset link.",
  },
};

const FIELD_CLASS =
  "rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent";

export function LoginForm({ initialError }: { initialError?: string | null }) {
  const [mode, setMode] = useState<Mode>("member");
  const [view, setView] = useState<MemberView>("signin");

  const heading =
    mode === "member"
      ? HEADINGS[view]
      : {
          title: "Welcome back",
          blurb: "Shared officer account — pick your role and enter its password.",
        };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="anim-fade w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block text-sm text-muted">
          ← Back
        </Link>

        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-5 h-20 w-20" />
          <h1 className="text-2xl font-bold tracking-tight">{heading.title}</h1>
          <p className="mt-2 text-muted">{heading.blurb}</p>
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

        <div key={`${mode}-${view}`} className="anim-fade">
          {mode === "officer" ? (
            <OfficerLogin />
          ) : view === "forgot-password" ? (
            <ForgotPassword onBack={() => setView("signin")} />
          ) : view === "forgot-pin" ? (
            <ForgotPin onBack={() => setView("signin")} />
          ) : view === "forgot-password-email" ? (
            <ForgotPasswordEmail onBack={() => setView("signin")} />
          ) : (
            <MemberLogin
              initialError={initialError}
              view={view}
              setView={setView}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function MemberLogin({
  initialError,
  view,
  setView,
}: {
  initialError?: string | null;
  view: "signin" | "create";
  setView: (v: MemberView) => void;
}) {
  const router = useRouter();
  const creating = view === "create";
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
      let signInResult: { error: string } | { ok: true };

      if (creating) {
        const result = await registerMember(name, password, pin);
        if ("error" in result) {
          setStatus("error");
          setMessage(result.error);
          return;
        }
        // New accounts sign in with their freshly minted synthetic address.
        signInResult = await signIn(result.email, password);
      } else {
        // Sign in by name (synthetic address) OR by a real email the member
        // has added to their account — signInMember resolves either. Runs
        // server-side so the cookie persists after the app is closed.
        signInResult = await signInMember(name, password);
      }

      if ("error" in signInResult) {
        setStatus("error");
        setMessage(
          signInResult.error === "Invalid login credentials"
            ? "No account matches that name/email and password. Check the spelling — or create an account below."
            : signInResult.error,
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
        autoComplete={creating ? "name" : "username"}
        required
        placeholder={creating ? "Your full name" : "Your name or email"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={FIELD_CLASS}
      />
      <PasswordInput
        autoComplete={creating ? "new-password" : "current-password"}
        required
        minLength={creating ? 8 : undefined}
        placeholder={creating ? "Choose a password (8+ characters)" : "Password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD_CLASS}
      />
      {creating && (
        <label className="flex flex-col gap-1.5">
          <PasswordInput
            inputMode="numeric"
            autoComplete="off"
            required
            pattern="\d{4}"
            maxLength={4}
            placeholder="4-digit studio PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={FIELD_CLASS}
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
        onClick={() => setView(creating ? "signin" : "create")}
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
        <div className="flex flex-col items-center gap-2 text-sm">
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setView("forgot-password")}
              className="text-muted underline underline-offset-2"
            >
              Forgot password?
            </button>
            <button
              type="button"
              onClick={() => setView("forgot-pin")}
              className="text-muted underline underline-offset-2"
            >
              Forgot PIN?
            </button>
          </div>
          <button
            type="button"
            onClick={() => setView("forgot-password-email")}
            className="text-muted underline underline-offset-2"
          >
            Have an email on file? Get a reset link
          </button>
        </div>
      )}
    </form>
  );
}

/** Reset a forgotten password by proving the studio PIN, then sign in. */
function ForgotPassword({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      const result = await resetPasswordWithPin(name, pin, newPassword);
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
        return;
      }

      // Password is set — sign straight in with it.
      const signInResult = await signIn(result.email, newPassword);
      if ("error" in signInResult) {
        setStatus("error");
        setMessage(
          "Password updated! Signing in didn't work though — go back and sign in with your new password.",
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
      <input
        type="text"
        autoComplete="name"
        required
        placeholder="Your full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={FIELD_CLASS}
      />
      <PasswordInput
        inputMode="numeric"
        autoComplete="off"
        required
        pattern="\d{4}"
        maxLength={4}
        placeholder="Your 4-digit studio PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        className={FIELD_CLASS}
      />
      <PasswordInput
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="New password (8+ characters)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        className={FIELD_CLASS}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Resetting…" : "Reset password & sign in"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-accent"
      >
        ← Back to sign in
      </button>
      <p className="text-center text-xs text-muted">
        Forgot your PIN too? Ask the president or vice president — they can
        reset either one, or delete the account so you can start fresh.
      </p>
    </form>
  );
}

/** Reset a forgotten kiosk PIN by proving the account password. */
function ForgotPin({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "done">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      const result = await resetPinWithPassword(name, password, newPin);
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(describeError(err));
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <div className="rounded-2xl border border-success/40 bg-success/10 px-4 py-4">
          <div className="text-sm font-bold text-success">New PIN saved 🎉</div>
          <p className="mt-1 text-sm text-foreground/90">
            Tap it on the studio&apos;s quick sign-in screen next time
            you&apos;re in.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-center text-sm text-accent"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="text"
        autoComplete="name"
        required
        placeholder="Your full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={FIELD_CLASS}
      />
      <PasswordInput
        autoComplete="current-password"
        required
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD_CLASS}
      />
      <PasswordInput
        inputMode="numeric"
        autoComplete="off"
        required
        pattern="\d{4}"
        maxLength={4}
        placeholder="New 4-digit PIN"
        value={newPin}
        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
        className={FIELD_CLASS}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Saving…" : "Save new PIN"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-accent"
      >
        ← Back to sign in
      </button>
      <p className="text-center text-xs text-muted">
        Forgot your password too? Ask the president or vice president — they
        can reset either one, or delete the account so you can start fresh.
      </p>
    </form>
  );
}

/**
 * Request a password-reset link by email — additive to the PIN-based reset for
 * members who've added an email. Always shows the same "check your email"
 * confirmation whether or not the address is on file (no probing which emails
 * exist); the server only actually sends when it matches an account.
 */
function ForgotPasswordEmail({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "done">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      await sendPasswordResetEmail(email);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(describeError(err));
    }
  }

  if (status === "done") {
    return (
      <div className="flex flex-col gap-4 text-center">
        <div className="rounded-2xl border border-success/40 bg-success/10 px-4 py-4">
          <div className="text-sm font-bold text-success">
            Check your email 📬
          </div>
          <p className="mt-1 text-sm text-foreground/90">
            If <span className="font-medium">{email}</span> is on a LACC
            account, a reset link is on its way. It expires in about an hour.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-center text-sm text-accent"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="email"
        autoComplete="email"
        required
        placeholder="The email on your account"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={FIELD_CLASS}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Email me a reset link"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-accent"
      >
        ← Back to sign in
      </button>
      <p className="text-center text-xs text-muted">
        No email on file? Use “Forgot password?” to reset with your studio PIN
        instead.
      </p>
    </form>
  );
}

function OfficerLogin() {
  const router = useRouter();
  const [recovering, setRecovering] = useState(false);
  const [role, setRole] = useState<(typeof OFFICER_ROLES)[number]>("president");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      // Shared officer logins are name-based; the address is synthetic.
      const signInResult = await signIn(OFFICER_ACCOUNTS[role], password);
      if ("error" in signInResult) {
        setStatus("error");
        setMessage(
          signInResult.error === "Invalid login credentials"
            ? "Wrong password for that role."
            : signInResult.error,
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

  if (recovering) {
    return (
      <OfficerRecover
        role={role}
        setRole={setRole}
        onBack={() => setRecovering(false)}
      />
    );
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
      <PasswordInput
        autoComplete="current-password"
        required
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD_CLASS}
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
      <button
        type="button"
        onClick={() => setRecovering(true)}
        className="text-center text-sm text-muted underline underline-offset-2"
      >
        Forgot the password?
      </button>
      <p className="text-center text-xs text-muted">
        Officer accounts (President, Vice President, Volunteer Coordinator) are
        shared logins handed to whoever holds the role.
      </p>
    </form>
  );
}

/**
 * Reset a forgotten officer password by proving the personal member account
 * an officer linked from their account page (password or studio PIN).
 */
function OfficerRecover({
  role,
  setRole,
  onBack,
}: {
  role: (typeof OFFICER_ROLES)[number];
  setRole: (r: (typeof OFFICER_ROLES)[number]) => void;
  onBack: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [credential, setCredential] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      const result = await resetOfficerPasswordViaMember(
        role,
        name,
        credential,
        newPassword,
      );
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
        return;
      }

      // Password is set — sign straight in as the officer.
      const signInResult = await signIn(result.email, newPassword);
      if ("error" in signInResult) {
        setStatus("error");
        setMessage(
          "Password updated! Signing in didn't work though — go back and sign in with the new password.",
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
      <p className="text-center text-sm text-muted">
        Reset an officer password using the personal member account linked to
        the role.
      </p>
      <div className="flex flex-col gap-2">
        {OFFICER_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`rounded-2xl border px-5 py-3 text-left text-base transition ${
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
        type="text"
        autoComplete="name"
        required
        placeholder="Linked member account name"
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
      <PasswordInput
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="New officer password (8+ characters)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        className={FIELD_CLASS}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Resetting…" : "Reset password & sign in"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-center text-sm text-accent"
      >
        ← Back to officer sign in
      </button>
      <p className="text-center text-xs text-muted">
        No member account linked yet? Sign in and link one under the Account tab
        — or ask whoever holds the role to hand over the password.
      </p>
    </form>
  );
}
