import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Brand";

export default async function Home() {
  // Signed-in members belong on their account page, not this public hub. This
  // makes a home-screen PWA reopen on the account page after a cold close, and
  // keeps the iOS back-swipe from stranding them on the start screen: reaching
  // `/` while signed in just bounces straight back to /me. Logged-out visitors
  // and the kiosk iPad (no member session) still get the hub; /me routes
  // officers on to /officer. Mirrors the same guard on /login.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/me");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="anim-fade w-full max-w-sm sm:max-w-md lg:max-w-xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <Logo className="mb-5 h-24 w-24" />
          <h1 className="text-3xl font-bold tracking-tight">LACC Studio</h1>
          <p className="mt-2 text-muted">
            Sign in, see your jobs, and keep up with the studio.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:gap-5">
          <Link
            href="/login"
            className="flex items-center justify-between gap-4 rounded-2xl bg-accent px-6 py-6 text-background transition active:scale-[0.98] sm:rounded-3xl sm:px-8 sm:py-7 lg:px-10 lg:py-9"
          >
            <span>
              <span className="block text-xl font-semibold sm:text-2xl lg:text-3xl">
                My account
              </span>
              <span className="block text-sm text-background/70 sm:text-base">
                Jobs, calendar &amp; announcements
              </span>
            </span>
            <span className="shrink-0 text-2xl sm:text-3xl lg:text-4xl">→</span>
          </Link>

          <Link
            href="/kiosk"
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-6 py-6 transition active:scale-[0.98] sm:rounded-3xl sm:px-8 sm:py-7 lg:px-10 lg:py-9"
          >
            <span>
              <span className="block text-xl font-semibold sm:text-2xl lg:text-3xl">
                Quick sign in <span className="font-normal">🎓</span>
              </span>
              <span className="block text-sm text-muted sm:text-base">
                Students &amp; members — sign in here at the studio
              </span>
            </span>
            <span className="shrink-0 text-2xl text-muted sm:text-3xl lg:text-4xl">
              →
            </span>
          </Link>

          <Link
            href="/calendar"
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-6 py-6 transition active:scale-[0.98] sm:rounded-3xl sm:px-8 sm:py-7 lg:px-10 lg:py-9"
          >
            <span>
              <span className="block text-xl font-semibold sm:text-2xl lg:text-3xl">
                Studio calendar
              </span>
              <span className="block text-sm text-muted sm:text-base">
                Classes &amp; events — no login needed
              </span>
            </span>
            <span className="shrink-0 text-2xl text-muted sm:text-3xl lg:text-4xl">
              →
            </span>
          </Link>
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Los Alamos Community Ceramics
        </p>
      </div>
    </main>
  );
}
