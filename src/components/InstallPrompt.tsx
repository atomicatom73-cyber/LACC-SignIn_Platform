"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Home-screen install prompt for members on their own phone.
 *
 * Mounted once in the root layout so it can register the service worker and
 * catch `beforeinstallprompt` early, but the banner only shows on the login
 * and account screens — never on the shared kiosk iPad, and never once the app
 * is already installed (running in standalone display mode).
 *
 *  - Android / desktop Chrome: a real one-tap "Install" button that fires the
 *    browser's install prompt.
 *  - iOS Safari: Apple blocks programmatic install, so the button opens a short
 *    "Share → Add to Home Screen" instruction sheet instead.
 *
 * Dismissal is remembered in localStorage so it never nags.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "lacc-install-dismissed";
// The public hub (/) is where you land when you first open the URL, so the
// prompt needs to be there too — plus the sign-in and account screens.
const ALLOWED_ROUTES = ["/", "/login", "/me"];

export function InstallPrompt() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  // Starts non-mobile so the server render and first client render both produce
  // nothing (hydration-safe); the effect fills this in once we're in the browser.
  const [env, setEnv] = useState({ ios: false, standalone: false, mobile: false });

  useEffect(() => {
    // Subscribe synchronously so an early `beforeinstallprompt` isn't missed.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShowSheet(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // Register the service worker (required for Android's install prompt).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Read the environment once, off the synchronous effect path — keeps the
    // first client render matching the server (nothing) so hydration is clean.
    const read = () => {
      const ua = navigator.userAgent || "";
      const ios =
        /iphone|ipad|ipod/i.test(ua) ||
        // iPadOS 13+ reports as a Mac; disambiguate by touch support.
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      const mobile = ios || /android/i.test(ua);
      setEnv({ ios, standalone, mobile });

      try {
        if (localStorage.getItem(DISMISS_KEY)) setDismissed(true);
      } catch {
        // Private mode / storage disabled — just show the prompt.
      }
    };
    queueMicrotask(read);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    setShowSheet(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  const handleInstall = async () => {
    if (env.ios) {
      setShowSheet(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single-use; drop it so the banner clears either way.
    setDeferred(null);
  };

  if (env.standalone || dismissed) return null;
  if (!ALLOWED_ROUTES.includes(pathname)) return null;
  if (!env.mobile) return null;
  // Nothing to offer: Android hasn't signalled installability and it's not iOS.
  if (!env.ios && !deferred) return null;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 print:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="anim-fade flex w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-lg shadow-black/40">
          <span className="text-2xl" aria-hidden>
            📲
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Install LACC Studio</div>
            <div className="text-xs text-muted">
              Add it to your home screen for one-tap access.
            </div>
          </div>
          <button
            onClick={handleInstall}
            className="shrink-0 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-background transition active:scale-[0.98]"
          >
            Install
          </button>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-lg p-1.5 text-lg leading-none text-muted transition active:scale-90"
          >
            ✕
          </button>
        </div>
      </div>

      {showSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4"
          onClick={() => setShowSheet(false)}
        >
          <div
            className="anim-fade w-full max-w-md rounded-t-3xl border border-border bg-surface px-5 pt-5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <h2 className="text-lg font-bold tracking-tight">
              Add to Home Screen
            </h2>
            <p className="mt-1 text-sm text-muted">
              In Safari, install LACC Studio in three taps:
            </p>
            <ol className="mt-4 flex flex-col gap-3 text-sm">
              <li className="flex items-center gap-3">
                <StepDot n={1} />
                <span className="flex flex-wrap items-center gap-1.5">
                  Tap the Share button
                  <ShareIcon />
                </span>
              </li>
              <li className="flex items-center gap-3">
                <StepDot n={2} />
                <span>
                  Scroll down and tap{" "}
                  <span className="font-semibold text-foreground">
                    Add to Home Screen
                  </span>
                </span>
              </li>
              <li className="flex items-center gap-3">
                <StepDot n={3} />
                <span>
                  Tap{" "}
                  <span className="font-semibold text-foreground">Add</span> in
                  the top corner
                </span>
              </li>
            </ol>
            <button
              onClick={() => setShowSheet(false)}
              className="mt-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-background transition active:scale-[0.98]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-background">
      {n}
    </span>
  );
}

/** The iOS Safari share glyph: a tray with an upward arrow. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block text-accent"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}
