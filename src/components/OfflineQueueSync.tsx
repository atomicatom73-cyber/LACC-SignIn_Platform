"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  dropEvents,
  eventSubject,
  readQueue,
  subscribeToQueue,
  type StoredEvent,
} from "@/lib/offline-queue";
import { flushQueue } from "@/lib/offline-sync";

/**
 * Watches the offline sign-in queue, drains it whenever the network allows, and
 * says out loud what it's holding.
 *
 * Mounted in the root layout rather than on the kiosk pages: a tablet that lost
 * wifi mid-shift often gets left on whatever screen it was on, and the queue
 * should still drain from there. It renders nothing when there's nothing to
 * report, which is nearly always.
 */
export function OfflineQueueSync() {
  const { pending, rejected, online } = useOfflineQueue();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Sync on load, when the network comes back, and when the tablet is woken up
  // — an iPad that has been asleep fires `visibilitychange`, not `online`.
  useEffect(() => {
    const run = () => {
      flushQueue().catch(() => {
        // Nothing to do: failures are already recorded on the queued events.
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Keep trying while anything is held, so a kiosk nobody touches still catches
  // up once the wifi returns without an `online` event ever firing.
  const waiting = pending.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      flushQueue().catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [waiting]);

  if (rejected.length > 0 && !dismissed) {
    return (
      <Banner tone="danger">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {rejected.length === 1
              ? "1 sign-in couldn't be saved"
              : `${rejected.length} sign-ins couldn't be saved`}
          </div>
          <ul className="mt-0.5 text-xs opacity-90">
            {rejected.slice(0, 3).map((event) => (
              <li key={event.id} className="truncate">
                {eventSubject(event) || "Unknown"} — {event.rejected}
              </li>
            ))}
            {rejected.length > 3 && (
              <li>and {rejected.length - 3} more</li>
            )}
          </ul>
          <div className="mt-1 text-xs opacity-90">
            Add these to the log by hand, then dismiss.
          </div>
        </div>
        <button
          onClick={() => {
            setDismissed(true);
            // These will never sync; clearing them keeps the banner honest the
            // next time something really is waiting.
            dropEvents(rejected.map((event) => event.id)).catch(() => {});
          }}
          className="shrink-0 self-start rounded-lg px-2 py-1 text-xs font-semibold underline underline-offset-2"
        >
          Dismiss
        </button>
      </Banner>
    );
  }

  if (!online) {
    const onKiosk = pathname.startsWith("/kiosk");
    // Away from the kiosk an offline notice is just noise — nothing there is
    // queueing anything.
    if (!waiting && !onKiosk) return null;
    return (
      <Banner tone="accent">
        <span className="text-sm font-semibold">
          {waiting
            ? `Offline · ${pending.length} sign-in${
                pending.length === 1 ? "" : "s"
              } saved on this tablet`
            : "Offline · sign-ins will be saved here"}
        </span>
        <span className="text-xs opacity-90">
          They&apos;ll upload on their own once the wifi is back.
        </span>
      </Banner>
    );
  }

  if (waiting) {
    // `navigator.onLine` only means "there's a network", not "the studio is
    // reachable" — a captive portal or a server hiccup both look online. Once an
    // attempt has actually failed, say so instead of claiming to be syncing.
    const stalled = pending.some((event) => event.attempts > 0);
    return (
      <Banner tone="accent">
        <span className="text-sm font-semibold">
          {stalled
            ? `Can't reach the studio · ${pending.length} sign-in${
                pending.length === 1 ? "" : "s"
              } saved on this tablet`
            : `Syncing ${pending.length} saved sign-in${
                pending.length === 1 ? "" : "s"
              }…`}
        </span>
        {stalled && (
          <span className="text-xs opacity-90">
            Still trying — they&apos;ll upload as soon as it answers.
          </span>
        )}
      </Banner>
    );
  }

  return null;
}

function Banner({
  tone,
  children,
}: {
  tone: "accent" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 print:hidden"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <div
        className={`anim-fade flex w-full max-w-xl items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-lg shadow-foreground/10 ${
          tone === "danger"
            ? "border-danger/40 bg-danger text-background"
            : "border-accent/30 bg-surface text-foreground"
        }`}
      >
        {tone === "accent" && (
          <span className="text-lg" aria-hidden>
            📡
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

/**
 * Live view of the queue. Also used by the roster so a tap that's still waiting
 * to sync keeps showing the member as signed in.
 */
export function useOfflineQueue() {
  const [pending, setPending] = useState<StoredEvent[]>([]);
  const [rejected, setRejected] = useState<StoredEvent[]>([]);
  // Starts optimistic so the server render and first client render agree; the
  // effect below corrects it.
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    const all = await readQueue();
    setPending(all.filter((event) => !event.rejected));
    setRejected(all.filter((event) => event.rejected));
  }, []);

  useEffect(() => {
    // Subscribe synchronously so a tap queued during this render isn't missed.
    const unsubscribe = subscribeToQueue(() => {
      refresh();
    });

    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    // Take the first reading off the synchronous effect path, so the first
    // client render still matches the server's and hydration stays clean.
    queueMicrotask(() => {
      refresh();
      sync();
    });

    return () => {
      unsubscribe();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [refresh]);

  return { pending, rejected, online, refresh };
}
