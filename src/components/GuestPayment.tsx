/**
 * Payment reminder shown right after a guest is signed in. The QR code and
 * link are placeholders until the studio's payment page exists.
 */
export function GuestPayment({ guestName }: { guestName: string }) {
  return (
    <div className="rounded-2xl border border-success/40 bg-success/10 px-5 py-5 text-center">
      <div className="text-3xl" aria-hidden>
        ✅
      </div>
      <h2 className="mt-2 text-lg font-bold">{guestName} is signed in!</h2>
      <p className="mt-1 text-sm text-foreground/90">
        One more thing — <span className="font-semibold">guests pay a visit fee</span>.
      </p>

      <div className="mx-auto mt-4 flex w-fit flex-col items-center rounded-2xl border border-border bg-surface p-4">
        <PlaceholderQr />
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Scan to pay
        </div>
        <a
          href="https://example.com/lacc-guest-payment"
          className="mt-1 text-sm text-accent underline underline-offset-2"
        >
          example.com/lacc-guest-payment
        </a>
        <div className="mt-1 text-[10px] text-muted">
          (placeholder — real payment link coming soon)
        </div>
      </div>

      <p className="mt-4 text-sm text-foreground/90">
        💵 Prefer cash? Drop it in the{" "}
        <span className="font-semibold">cash box in the studio</span>.
      </p>
    </div>
  );
}

/** A decorative QR-looking placeholder (not scannable). */
function PlaceholderQr() {
  // Deterministic pseudo-random fill so it looks like a QR code.
  const size = 13;
  const cells: boolean[] = [];
  let seed = 42;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    cells.push(seed % 5 < 2);
  }
  const corner = (cx: number, cy: number) => (
    <>
      <rect x={cx} y={cy} width={3} height={3} fill="currentColor" />
      <rect x={cx + 0.75} y={cy + 0.75} width={1.5} height={1.5} fill="var(--surface)" />
    </>
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-36 w-36 text-foreground"
      role="img"
      aria-label="Placeholder payment QR code"
    >
      {cells.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={i % size}
            y={Math.floor(i / size)}
            width={1}
            height={1}
            fill="currentColor"
            opacity={0.85}
          />
        ) : null,
      )}
      {corner(0, 0)}
      {corner(size - 3, 0)}
      {corner(0, size - 3)}
    </svg>
  );
}
