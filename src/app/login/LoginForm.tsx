"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Brand";

export function LoginForm({ initialError }: { initialError?: string | null }) {
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

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block text-sm text-muted">
          ← Back
        </Link>

        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-5 h-14 w-14 text-xl" />
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted">
            We&apos;ll email you a one-tap login link.
          </p>
        </div>

        {status === "sent" ? (
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
        ) : (
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
          </form>
        )}
      </div>
    </main>
  );
}
