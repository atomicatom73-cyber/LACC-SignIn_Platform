import Link from "next/link";
import { Logo } from "@/components/Brand";
import { StudentForm } from "./StudentForm";

/** Student sign-in for class attendees — no account needed. */
export default function KioskStudentPage() {
  return (
    <main className="anim-fade mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Link href="/kiosk" className="inline-block text-sm text-muted">
        ← Back to quick sign in
      </Link>

      <div className="mb-6 mt-6 flex flex-col items-center text-center">
        <Logo className="mb-4 h-12 w-12 text-lg" />
        <h1 className="text-2xl font-bold tracking-tight">
          Sign in as student
        </h1>
        <p className="mt-2 text-sm text-muted">
          Here for a class? Sign in with your name and which class you&apos;re
          attending.
        </p>
      </div>

      <StudentForm />
    </main>
  );
}
