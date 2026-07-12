"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/PasswordInput";
import { setNewPassword } from "../login/actions";

const FIELD_CLASS =
  "rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent";

/** Sets the new password within the recovery session, then drops into /me. */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");

    try {
      const result = await setNewPassword(password);
      if ("error" in result) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      router.push("/me");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error
          ? err.message
          : "Something went wrong — please try again.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PasswordInput
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="New password (8+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={FIELD_CLASS}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {status === "sending" ? "Saving…" : "Save new password & sign in"}
      </button>
      {status === "error" && (
        <p className="text-center text-sm text-danger">{message}</p>
      )}
    </form>
  );
}
