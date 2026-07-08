import Link from "next/link";
import { Logo } from "@/components/Brand";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="anim-fade w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="mb-5 h-24 w-24" />
          <h1 className="text-3xl font-bold tracking-tight">LACC Studio</h1>
          <p className="mt-2 text-muted">
            Sign in, see your jobs, and keep up with the studio.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Link
            href="/login"
            className="flex items-center justify-between rounded-2xl bg-accent px-6 py-5 text-background transition active:scale-[0.98]"
          >
            <span>
              <span className="block text-lg font-semibold">My account</span>
              <span className="block text-sm text-background/70">
                Jobs, calendar &amp; announcements
              </span>
            </span>
            <span className="text-2xl">→</span>
          </Link>

          <Link
            href="/kiosk"
            className="flex items-center justify-between rounded-2xl border border-border bg-surface px-6 py-5 transition active:scale-[0.98]"
          >
            <span>
              <span className="block text-lg font-semibold">
                Quick sign in <span className="font-normal">🎓</span>
              </span>
              <span className="block text-sm text-muted">
                Students &amp; members — sign in here at the studio
              </span>
            </span>
            <span className="text-2xl text-muted">→</span>
          </Link>

          <Link
            href="/calendar"
            className="flex items-center justify-between rounded-2xl border border-border bg-surface px-6 py-5 transition active:scale-[0.98]"
          >
            <span>
              <span className="block text-lg font-semibold">
                Studio calendar
              </span>
              <span className="block text-sm text-muted">
                Classes &amp; events — no login needed
              </span>
            </span>
            <span className="text-2xl text-muted">→</span>
          </Link>
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Los Alamos Community Ceramics
        </p>
      </div>
    </main>
  );
}
