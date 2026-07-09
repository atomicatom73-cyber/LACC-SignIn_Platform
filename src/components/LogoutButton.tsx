"use client";

import { clearSessionBackup } from "@/lib/session-persistence";

/**
 * Submit button for the log-out form. Clears the localStorage session backup
 * before the form's server action signs out, so SessionKeeper can't restore the
 * session on the next launch (see session-persistence).
 */
export function LogoutButton({ className }: { className?: string }) {
  return (
    <button
      type="submit"
      onClick={() => clearSessionBackup()}
      className={className ?? "text-sm text-muted"}
    >
      Log out
    </button>
  );
}
