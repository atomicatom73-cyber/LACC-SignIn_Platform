"use client";

import { useState } from "react";

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {open && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}

/**
 * A password/PIN input with the little reveal eye. Drop-in for a styled
 * <input type="password">: pass the usual props (value, onChange, className,
 * ref, …) — the type is managed by the toggle. The right padding for the eye
 * is added automatically.
 */
export function PasswordInput({
  className = "",
  ...props
}: Omit<React.ComponentPropsWithRef<"input">, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`w-full pr-12 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide" : "Show"}
        aria-pressed={visible}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted transition active:scale-90"
      >
        <EyeIcon open={visible} />
      </button>
    </div>
  );
}
