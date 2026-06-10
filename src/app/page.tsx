import Link from "next/link";
import { Logo } from "@/components/Brand";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="mb-5 h-16 w-16 text-2xl" />
          <h1 className="text-3xl font-bold tracking-tight">LACC Sign-In</h1>
          <p className="mt-2 text-muted">
            Clock in when you arrive, clock out when you leave.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Link
            href="/login"
            className="flex items-center justify-between rounded-2xl bg-accent px-6 py-5 text-background transition active:scale-[0.98]"
          >
            <span>
              <span className="block text-lg font-semibold">On my phone</span>
              <span className="block text-sm text-background/70">
                Log in with your email
              </span>
            </span>
            <span className="text-2xl">→</span>
          </Link>

          <Link
            href="/kiosk"
            className="flex items-center justify-between rounded-2xl border border-border bg-surface px-6 py-5 transition active:scale-[0.98]"
          >
            <span>
              <span className="block text-lg font-semibold">Studio iPad</span>
              <span className="block text-sm text-muted">
                Tap your name on the roster
              </span>
            </span>
            <span className="text-2xl text-muted">→</span>
          </Link>
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Los Angeles Creative Collective
        </p>
      </div>
    </main>
  );
}
