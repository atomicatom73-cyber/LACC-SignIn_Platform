"use client";

import { useRef } from "react";
import { clearSessionBackup } from "@/lib/session-persistence";
import { forgetPrivateCache } from "@/lib/offline-cache";

/**
 * Submit button for the log-out form.
 *
 * Before the form's server action signs out, this clears two things that would
 * otherwise outlive the session on the device: the localStorage session backup,
 * so SessionKeeper can't restore it on the next launch (see session-persistence),
 * and the service worker's cached copy of the member dashboard, which offline has
 * no session check in front of it (see public/sw.js).
 *
 * The cache delete is awaited and the submit re-issued afterwards, because
 * navigating away mid-delete leaves the page cached.
 */
export function LogoutButton({ className }: { className?: string }) {
  const submitting = useRef(false);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Let the re-issued submit through instead of looping.
    if (submitting.current) return;

    // Read the form now: `currentTarget` is gone by the time the await resolves.
    const form = event.currentTarget.form;
    event.preventDefault();
    submitting.current = true;

    clearSessionBackup();
    void forgetPrivateCache().then(() => {
      form?.requestSubmit();
    });
  };

  return (
    <button
      type="submit"
      onClick={handleClick}
      className={className ?? "text-sm text-muted"}
    >
      Log out
    </button>
  );
}
