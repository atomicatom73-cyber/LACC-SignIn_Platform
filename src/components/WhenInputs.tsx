/**
 * A studio-local date box and time box, side by side on a row of their own.
 *
 * Used everywhere a job takes a date and time. They used to share a wrapping
 * row with their Save/Cancel buttons as `min-w-0 flex-1` inputs, which on a
 * phone shrank them to ~70px slivers instead of wrapping; and iOS collapses an
 * empty date box that has no height of its own. Full width plus a fixed height
 * fixes both.
 */
export function WhenInputs({
  date,
  time,
  onDate,
  onTime,
  minDate,
  maxDate,
  captioned = false,
}: {
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  /** "YYYY-MM-DD" bounds for the native picker. */
  minDate?: string;
  maxDate?: string;
  /** Small "Date" / "Time" captions above the boxes. */
  captioned?: boolean;
}) {
  const box =
    "h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm outline-none focus:border-accent";

  const dateInput = (
    <input
      type="date"
      value={date}
      min={minDate}
      max={maxDate}
      onChange={(e) => onDate(e.target.value)}
      aria-label="Date"
      className={box}
    />
  );
  const timeInput = (
    <input
      type="time"
      value={time}
      onChange={(e) => onTime(e.target.value)}
      aria-label="Time"
      className={box}
    />
  );

  if (!captioned) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {dateInput}
        {timeInput}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] font-medium text-muted">Date</span>
        {dateInput}
      </label>
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] font-medium text-muted">Time</span>
        {timeInput}
      </label>
    </div>
  );
}
