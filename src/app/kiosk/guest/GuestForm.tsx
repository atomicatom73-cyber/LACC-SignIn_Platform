"use client";

import { useActionState } from "react";
import { GuestPayment } from "@/components/GuestPayment";
import { useOfflineQueue } from "@/components/OfflineQueueSync";
import {
  enqueue,
  isOffline,
  newEventId,
  serverReachable,
  studioNowIso,
  type StoredEvent,
} from "@/lib/offline-queue";
import { kioskGuestSignIn, type SignInFormState } from "../actions";

export type HostOption = { id: string; full_name: string };

/**
 * Kiosk guest sign-in: pick which (currently signed-in) member is hosting,
 * enter the guest's name, then show the payment reminder.
 *
 * Works with the wifi down — the guest is saved to the tablet and written to the
 * log once it's back. See src/lib/offline-queue.ts.
 */
export function GuestForm({ hosts }: { hosts: HostOption[] }) {
  const [state, formAction, pending] = useActionState(guestSignIn, null);
  const { pending: queued } = useOfflineQueue();

  if (state && "success" in state) {
    return <GuestPayment guestName={state.name} />;
  }

  // Offline, the host list came from a cached page — a member who tapped in
  // since then is missing from it, and someone who tapped out is still on it.
  const hostOptions = applyQueuedHosts(hosts, queued);

  if (hostOptions.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface px-5 py-6 text-center">
        <p className="font-medium">Nobody is signed in right now.</p>
        <p className="mt-2 text-sm text-muted">
          Guests come in with a member — sign yourself in on the quick sign-in
          screen first, then bring your guest.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted">
          Which member are you with?
        </span>
        <select
          name="host_member_id"
          required
          defaultValue=""
          className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
        >
          <option value="" disabled>
            Pick a signed-in member…
          </option>
          {hostOptions.map((h) => (
            <option key={h.id} value={h.id}>
              {h.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wide text-muted">
          Guest&apos;s name
        </span>
        <input
          type="text"
          name="guest_name"
          required
          autoComplete="off"
          placeholder="“Jane Doe”"
          className="rounded-2xl border border-border bg-surface px-5 py-4 text-lg outline-none focus:border-accent"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-accent px-6 py-4 text-lg font-semibold text-background transition active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign guest in"}
      </button>
      {state?.error && (
        <p className="text-center text-sm text-danger">{state.error}</p>
      )}
    </form>
  );
}

/**
 * Sign the guest in, falling back to the tablet's queue when the request can't
 * reach the server. A rejected action means either a dropped connection or a
 * server that threw, so check which before claiming the guest was saved.
 */
async function guestSignIn(
  prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  if (isOffline()) return queueGuest(formData);
  try {
    return await kioskGuestSignIn(prev, formData);
  } catch {
    if (await serverReachable()) {
      return { error: "The studio's system had a problem — please try again." };
    }
    return queueGuest(formData);
  }
}

async function queueGuest(formData: FormData): Promise<SignInFormState> {
  const hostMemberId = String(formData.get("host_member_id") ?? "").trim();
  const guestName = String(formData.get("guest_name") ?? "").trim();
  // Same checks the server would have run, so an offline mistake is caught at
  // the kiosk instead of surfacing as a rejection hours later.
  if (!hostMemberId) return { error: "Pick which member is bringing you in." };
  if (!guestName) return { error: "Enter the guest's name." };
  if (guestName.length > 80) return { error: "That name is too long." };

  const saved = await enqueue({
    kind: "guest-in",
    id: newEventId(),
    at: studioNowIso(),
    hostMemberId,
    guestName,
  });
  if (!saved) {
    return {
      error: "No connection, and this tablet can't save it — please use paper.",
    };
  }
  return { success: true, name: guestName };
}

/** Fold queued member taps into the cached host list. */
function applyQueuedHosts(
  hosts: HostOption[],
  queued: StoredEvent[],
): HostOption[] {
  const latest = new Map<string, StoredEvent>();
  for (const event of queued) {
    if (event.kind === "shift-in" || event.kind === "shift-out") {
      latest.set(event.memberId, event);
    }
  }
  if (latest.size === 0) return hosts;

  const merged = hosts.filter(
    (host) => latest.get(host.id)?.kind !== "shift-out",
  );
  for (const [memberId, event] of latest) {
    if (event.kind !== "shift-in") continue;
    if (merged.some((host) => host.id === memberId)) continue;
    merged.push({ id: memberId, full_name: event.memberName });
  }
  return merged.sort((a, b) => a.full_name.localeCompare(b.full_name));
}
