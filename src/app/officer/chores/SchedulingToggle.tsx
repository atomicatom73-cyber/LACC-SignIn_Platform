"use client";

/**
 * The per-job "can be scheduled" switch, shared by the add and edit forms.
 * Jobs with it on invite whoever holds them to say what date and time they'll
 * do it — most jobs are "any time this month", so it's off by default.
 */
export function SchedulingToggle({
  defaultChecked,
}: {
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex w-full cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
      <input
        type="checkbox"
        name="scheduling_enabled"
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">Pick a date &amp; time</span>
        <span className="block text-xs text-muted">
          Whoever gets this job says when they&apos;ll do it — it shows on their
          card, the jobs board, and the printable sheet.
        </span>
      </span>
    </label>
  );
}
