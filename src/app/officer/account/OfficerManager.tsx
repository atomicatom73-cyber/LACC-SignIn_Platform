"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/PasswordInput";
import { PERMISSIONS, type Permission } from "@/lib/roles";
import {
  createOfficer,
  deleteOfficer,
  setOfficerPassword,
  updateOfficer,
} from "./actions";

/** One officer account as the president's management panel sees it. */
export type ManagedOfficer = {
  id: string;
  title: string;
  /** True for the president account: shown, but never editable. */
  locked: boolean;
  /** Effective permission set (classic defaults already resolved). */
  permissions: Record<Permission, boolean>;
};

const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent";
const PRIMARY_BUTTON =
  "rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-60";

/** President-only: create shared officer logins and manage what they can do. */
export function OfficerManager({ officers }: { officers: ManagedOfficer[] }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight">Officer accounts</h2>
      <p className="mt-1 text-sm text-muted">
        Shared logins for the board — one per job. Pick what each account can
        do and hand its password to whoever holds the job. Only you (the
        president) can see and change these.
      </p>

      <div className="mt-4">
        <CreateOfficerCard />
      </div>

      <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
        {officers.map((officer) =>
          officer.locked ? (
            <PresidentCard key={officer.id} officer={officer} />
          ) : (
            <OfficerCard key={officer.id} officer={officer} />
          ),
        )}
      </div>
    </section>
  );
}

function PermissionChecks({
  value,
  onChange,
}: {
  value: Record<Permission, boolean>;
  onChange: (next: Record<Permission, boolean>) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {PERMISSIONS.map((p) => (
        <label
          key={p.key}
          className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
        >
          <input
            type="checkbox"
            checked={value[p.key]}
            onChange={(e) => onChange({ ...value, [p.key]: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{p.label}</span>
            <span className="block text-xs text-muted">{p.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const DEFAULT_PERMISSIONS: Record<Permission, boolean> = {
  members: false,
  logs: false,
  jobs: true,
  messages: true,
  door_codes: false,
};

function CreateOfficerCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
        <div className="min-w-0">
          <div className="text-base font-semibold">Add an officer account</div>
          <p className="mt-0.5 text-xs text-muted">
            A new shared login with its own title and permissions.
          </p>
          {message && <p className="mt-1 text-sm text-success">{message}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          className={PRIMARY_BUTTON}
        >
          New account
        </button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createOfficer({ title, password, permissions });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessage(
        `${res.title} created — they sign in with “${res.title}” and the password you set.`,
      );
      setTitle("");
      setPassword("");
      setPermissions(DEFAULT_PERMISSIONS);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-accent/40 bg-surface px-5 py-5"
    >
      <h3 className="text-base font-semibold">New officer account</h3>
      <div className="mt-3 flex flex-col gap-3">
        <input
          type="text"
          required
          autoComplete="off"
          placeholder="Title — e.g. Treasurer"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={FIELD_CLASS}
        />
        <PasswordInput
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Password to hand over (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD_CLASS}
        />
      </div>
      <PermissionChecks value={permissions} onChange={setPermissions} />
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {pending ? "Creating…" : "Create account"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="rounded-xl border border-border px-4 py-3 text-sm text-muted transition active:scale-[0.98]"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </form>
  );
}

function PresidentCard({ officer }: { officer: ManagedOfficer }) {
  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{officer.title}</h3>
        <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          You
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Full access. This account can&apos;t be edited or deleted, so the
        board can never lock itself out. Change its password in “Change
        password” above.
      </p>
    </section>
  );
}

function OfficerCard({ officer }: { officer: ManagedOfficer }) {
  const router = useRouter();
  const [title, setTitle] = useState(officer.title);
  const [permissions, setPermissions] = useState(officer.permissions);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    title.trim().replace(/\s+/g, " ") !== officer.title ||
    PERMISSIONS.some((p) => permissions[p.key] !== officer.permissions[p.key]);

  const handleSave = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await updateOfficer(officer.id, { title, permissions });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setTitle(res.title);
      setMessage("Saved.");
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-surface px-5 py-5">
      <input
        type="text"
        value={title}
        autoComplete="off"
        onChange={(e) => {
          setTitle(e.target.value);
          setMessage(null);
        }}
        className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 text-base font-semibold outline-none focus:border-accent"
        aria-label="Officer title"
      />
      <PermissionChecks
        value={permissions}
        onChange={(next) => {
          setPermissions(next);
          setMessage(null);
        }}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={pending || !dirty}
        className={`mt-3 w-full ${PRIMARY_BUTTON}`}
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {message && <p className="mt-2 text-sm text-success">{message}</p>}

      <NewPassword officerId={officer.id} />
      <DeleteOfficer officerId={officer.id} title={officer.title} />
    </section>
  );
}

/** Hand the login to someone new: set a fresh password, shown-once style. */
function NewPassword({ officerId }: { officerId: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await setOfficerPassword(officerId, password);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setPassword("");
      setMessage(
        "Password set — hand it over. Anyone using the old one is signed out.",
      );
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 border-t border-border pt-4"
    >
      <div className="text-sm font-medium">Set a new password</div>
      <p className="mt-0.5 text-xs text-muted">
        For handing this login to a new board member — or when the current one
        forgot it.
      </p>
      <div className="mt-2 flex gap-2">
        <PasswordInput
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-accent transition active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "…" : "Set"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {message && <p className="mt-2 text-xs text-success">{message}</p>}
    </form>
  );
}

function DeleteOfficer({
  officerId,
  title,
}: {
  officerId: string;
  title: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startTransition(async () => {
      const res = await deleteOfficer(officerId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-danger">Delete account</div>
        <p className="mt-0.5 text-xs text-muted">
          Removes the {title} login for good. Announcements it sent stay.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-60 ${
          confirming
            ? "bg-danger text-background"
            : "border border-danger/40 bg-danger/10 text-danger"
        }`}
      >
        {pending ? "Deleting…" : confirming ? "Tap again to delete" : "Delete"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
