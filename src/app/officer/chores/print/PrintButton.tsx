"use client";

/** Triggers the browser's print dialog; hidden on the printed page itself. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-2xl bg-accent px-6 py-3 text-sm font-semibold text-background transition active:scale-[0.98] print:hidden"
    >
      🖨️ Print
    </button>
  );
}
