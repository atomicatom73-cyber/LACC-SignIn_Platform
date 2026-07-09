"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clearSessionBackup,
  readSessionBackup,
  saveSessionBackup,
} from "@/lib/session-persistence";

/**
 * Keeps members signed in on iOS home-screen PWAs, whose cookie jar iOS wipes
 * when the app is closed (see session-persistence). Two jobs:
 *
 *  1. Mirror the session into localStorage whenever it changes (including the
 *     periodic token refresh, so the stored refresh token stays current), and
 *     drop it on sign-out so a deliberate logout is never resurrected.
 *  2. On launch, if the cookie session was wiped but a backup survives, restore
 *     it — which re-writes the auth cookie — then land the member on their
 *     account page (replacing the start-page history entry) or, if they opened a
 *     deeper link, refresh in place so the server-rendered pages pick it back up.
 *
 * Renders nothing. A no-op on platforms where the cookie already persists.
 */
export function SessionKeeper() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) saveSessionBackup(session);
      else if (event === "SIGNED_OUT") clearSessionBackup();
    });

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) return; // Cookie survived — nothing to restore.

      const backup = readSessionBackup();
      if (!backup) return; // Never signed in, or the person logged out.

      // setSession re-writes the auth cookie and, if the access token has
      // expired, refreshes it using the (still valid) refresh token.
      const { error } = await supabase.auth.setSession(backup);
      if (error) {
        clearSessionBackup(); // Refresh token expired/revoked — real logout.
        return;
      }

      // A cold launch always starts at the manifest start_url ("/"), the public
      // hub. Now that the session is back, send the member to their account
      // page — and REPLACE the entry, so the landing page isn't left behind for
      // the iOS back-swipe to return to. (/me routes officers on to /officer.)
      // Anywhere else — a public deep link like /calendar — just re-render in
      // place so we don't yank them off the page they opened.
      const path = window.location.pathname;
      if (path === "/" || path === "/login") router.replace("/me");
      else router.refresh();
    })();

    return () => sub.subscription.unsubscribe();
  }, [router]);

  return null;
}
