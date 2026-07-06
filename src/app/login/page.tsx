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
  const { error } = await searchParams;
  const initialError = error
    ? (ERROR_MESSAGES[error] ?? "Something went wrong. Please try again.")
    : null;

  return <LoginForm initialError={initialError} />;
}
