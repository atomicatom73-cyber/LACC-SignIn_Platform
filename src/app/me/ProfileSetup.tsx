"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown in the brief window after first sign-in before the `handle_new_user`
 * trigger's member row is visible. Polls itself until the profile appears.
 */
export function ProfileSetup() {
  const router = useRouter();

  useEffect(() => {
    const id = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(id);
  }, [router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      <p className="text-muted">Setting up your profile…</p>
      <button onClick={() => router.refresh()} className="text-sm text-accent">
        Refresh now
      </button>
    </main>
  );
}
