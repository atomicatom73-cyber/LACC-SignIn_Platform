import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

/** Friendly messages for the `?error=` codes we redirect back with. */
const ERROR_MESSAGES: Record<string, string> = {
  link: "That login link expired or was already used. Sign in with your name and password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in? Skip the form and go straight to the dashboard. This is
  // also what lands people back in after SessionKeeper restores a wiped iOS-PWA
  // cookie and refreshes this page (/me routes officers on to /officer).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/me");

  const { error } = await searchParams;
  const initialError = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.")
    : null;

  return <LoginForm initialError={initialError} />;
}
