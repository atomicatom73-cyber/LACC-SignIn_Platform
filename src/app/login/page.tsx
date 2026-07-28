import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listOfficerAccounts } from "@/lib/officer-accounts";
import { officerTitle } from "@/lib/roles";
import { LoginForm } from "./LoginForm";

/** Friendly messages for the `?error=` codes we redirect back with. */
const ERROR_MESSAGES: Record<string, string> = {
  link: "That login link expired or was already used. Sign in with your name and password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; create?: string; name?: string }>;
}) {
  // Already signed in? Skip the form and go straight to the dashboard. This is
  // also what lands people back in after SessionKeeper restores a wiped iOS-PWA
  // cookie and refreshes this page (/me routes officers on to /officer).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/me");

  const { error, create, name } = await searchParams;
  const initialError = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.")
    : null;

  // The officer tab lists whatever officer accounts exist right now — the
  // classic three plus any the president has created (or renamed).
  const officers = (await listOfficerAccounts()).map((o) => ({
    id: o.id,
    title: officerTitle(o),
  }));

  return (
    <LoginForm
      initialError={initialError}
      officers={officers}
      // The quick sign-in screen deep-links here when someone without an
      // account taps their name — open the signup form with it prefilled.
      initialView={create ? "create" : undefined}
      initialName={name?.slice(0, 80)}
    />
  );
}
