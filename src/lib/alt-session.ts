/**
 * The second account parked on this device.
 *
 * Officers hold two logins — the shared officer account and their own member
 * account — and constantly need both. Rather than link them in the database
 * (impossible to do honestly: the officer logins are shared and change hands),
 * we keep BOTH sessions on the device and let the header switcher swap which
 * one is active. The active session lives in Supabase's own auth cookies; the
 * other one waits in the cookie below, and switching swaps the two.
 *
 * The parked refresh token isn't being used while it waits, so it stays valid;
 * setSession() refreshes its access token on the way back in.
 *
 * SERVER ONLY — the cookie is httpOnly on purpose: it holds a refresh token,
 * and nothing in the browser needs to read it.
 *
 * Caveat worth knowing: an installed iOS PWA loses its cookie jar when closed,
 * and only the ACTIVE session is mirrored to localStorage (see
 * session-persistence). So on iOS the parked account may need adding again
 * after a cold launch — a password entry, not a lockout.
 */

import { cookies } from "next/headers";

export const ALT_SESSION_COOKIE = "lacc-alt-account";

export type AltSession = {
  access_token: string;
  refresh_token: string;
  /** Display name for the switcher, captured when the account was added. */
  label: string;
  /** "member" or the officer's title — just for the switcher's subtitle. */
  kind: string;
  /** Where switching to this account should land. */
  home: "/me" | "/officer";
};

const MAX_AGE = 60 * 60 * 24 * 400; // ~13 months, like the auth cookies.

export async function readAltSession(): Promise<AltSession | null> {
  const raw = (await cookies()).get(ALT_SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AltSession>;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      label: parsed.label ?? "Other account",
      kind: parsed.kind ?? "",
      home: parsed.home === "/officer" ? "/officer" : "/me",
    };
  } catch {
    return null;
  }
}

/** Park (or, with null, forget) the second account. Actions/routes only. */
export async function writeAltSession(value: AltSession | null) {
  const store = await cookies();
  if (!value) {
    store.delete(ALT_SESSION_COOKIE);
    return;
  }
  store.set(ALT_SESSION_COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}
