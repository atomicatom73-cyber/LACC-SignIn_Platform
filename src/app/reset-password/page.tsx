import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Brand";
import { ResetPasswordForm } from "./ResetPasswordForm";

/**
 * Landing page for the emailed password-reset link. By the time someone gets
 * here, /auth/confirm has verified the token and opened a short-lived recovery
 * session, so `getUser()` returns the account. If there's no session (link
 * expired, already used, or someone navigated here directly) we show a way
 * back to sign in rather than an empty form.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="anim-fade w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-5 h-20 w-20" />
          <h1 className="text-2xl font-bold tracking-tight">
            Choose a new password
          </h1>
          <p className="mt-2 text-muted">
            {user
              ? "Pick a new password for your account, then you're in."
              : "This reset link has expired or was already used. Request a fresh one from the sign-in screen."}
          </p>
        </div>

        {user ? (
          <ResetPasswordForm />
        ) : (
          <Link
            href="/login"
            className="block rounded-2xl bg-accent px-6 py-4 text-center text-lg font-semibold text-background transition active:scale-[0.98]"
          >
            Back to sign in
          </Link>
        )}
      </div>
    </main>
  );
}
