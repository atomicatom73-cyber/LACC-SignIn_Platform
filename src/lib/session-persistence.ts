/**
 * Client-side session persistence for iOS home-screen PWAs. iOS gives an
 * installed ("Add to Home Screen") PWA its own storage jar and wipes its
 * cookies when the app is closed — so the cookie-based session is gone on the
 * next launch and the person lands back on the login screen. localStorage, by
 * contrast, survives a close/reopen of the same installed PWA, so we mirror the
 * session tokens there and restore the auth cookie from them on boot.
 *
 * See SessionKeeper (restores) and LogoutButton (clears). No-op on
 * desktop/Android, where the cookie persists on its own.
 */
export const SESSION_BACKUP_KEY = "lacc.session";

type SessionBackup = { access_token: string; refresh_token: string };

/** Mirror the current session's tokens into localStorage. */
export function saveSessionBackup(session: SessionBackup) {
  try {
    localStorage.setItem(
      SESSION_BACKUP_KEY,
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    );
  } catch {
    // localStorage blocked (private mode / disabled) — persistence just won't
    // survive an app close, which is the pre-existing behavior.
  }
}

/** Read the backed-up tokens, or null if absent/unusable. */
export function readSessionBackup(): SessionBackup | null {
  try {
    const raw = localStorage.getItem(SESSION_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionBackup>;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    };
  } catch {
    return null;
  }
}

/** Forget the backup — call on sign-out so it can't be restored next launch. */
export function clearSessionBackup() {
  try {
    localStorage.removeItem(SESSION_BACKUP_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
