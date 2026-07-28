/**
 * Payment reminder shown right after a guest is signed in. The CheddarUp
 * guest-pass page covers both the payment and the guest policy; the QR
 * (public/qr/lacc-guest-pass.*) encodes the same link.
 */

const GUEST_PASS_URL = "https://my.cheddarup.com/c/lacc-guest-pass/items";

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
        {/* eslint-disable-next-line @next/next/no-img-element -- local static SVG, no optimization needed */}
        <img
          src="/qr/lacc-guest-pass.svg"
          alt="QR code for the LACC guest pass payment page"
          className="h-36 w-36 rounded-lg bg-white"
        />
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Scan to pay the guest fee
        </div>
        <a
          href={GUEST_PASS_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-1 text-sm text-accent underline underline-offset-2"
        >
          my.cheddarup.com/c/lacc-guest-pass
        </a>
        <div className="mt-1 text-[10px] text-muted">
          (the guest policy lives there too)
        </div>
      </div>

      <p className="mt-4 text-sm text-foreground/90">
        💵 Prefer cash? Drop it in the{" "}
        <span className="font-semibold">cash box in the studio</span>.
      </p>
    </div>
  );
}
