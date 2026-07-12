"use client";

import { useState } from "react";
import { EventForm } from "./EventForm";

/** "Add event" button that swaps into the create form (admins only). */
export function AddEvent() {
  const [open, setOpen] = useState(false);

  if (open) {
    return <EventForm onDone={() => setOpen(false)} />;
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="w-full rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98]"
    >
      ＋ Add event
    </button>
  );
}
