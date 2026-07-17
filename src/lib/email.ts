/**
 * Transactional email, backed by Resend's HTTP API (no SDK dependency).
 *
 * Fail-safe by design: if RESEND_API_KEY isn't configured, sendEmail() logs and
 * returns `{ ok: false, skipped: true }` instead of throwing — so a
 * half-provisioned deployment never breaks the flow that triggered the mail
 * (sending an announcement still succeeds even when email is switched off).
 *
 * SERVER ONLY — reads the Resend secret from the environment.
 *
 * EMAIL_FROM must be an address on a domain verified in Resend — the club's is
 * laccstudio.org, so "LACC Studio <noreply@laccstudio.org>". If it's unset, the
 * fallback below sends from Resend's shared onboarding@resend.dev sandbox, which
 * ONLY delivers to the Resend account owner; every other recipient 403s and,
 * because sends are best-effort, fails silently. Set EMAIL_FROM in Vercel too —
 * a missing prod env var is invisible until someone reports mail never arrived.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
};

type SendResult =
  | { ok: true }
  | { ok: false; skipped?: true; error?: string };

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = Array.isArray(args.to) ? args.to : [args.to];

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipped "${args.subject}" to ${recipients.join(", ")}`,
    );
    return { ok: false, skipped: true };
  }

  const from = process.env.EMAIL_FROM ?? "LACC Studio <onboarding@resend.dev>";

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend responded ${res.status}: ${detail}`);
      return { ok: false, error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Absolute base URL for links inside emails — origin only. */
export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").trim();
  // Links in email MUST be absolute. A NEXT_PUBLIC_SITE_URL set without a scheme
  // ("laccstudio.org") makes new URL() throw, and returning it raw yields a
  // RELATIVE href — which a mail client resolves against its own domain, so the
  // reset link 404s inside Gmail. Assume https when the scheme is missing.
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  // Collapse to the origin so a value that carries a stray path (e.g. copied
  // from the browser while on /officer) can't prefix — and 404 — every link.
  try {
    return new URL(absolute).origin;
  } catch {
    return absolute.replace(/\/+$/, "");
  }
}

/** Escape user-supplied text before dropping it into email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared, inline-styled shell so both templates read as one brand. */
function shell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f4f2;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1a17;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e3dd;">
      <tr>
        <td style="padding:24px 28px;background:#1c1a17;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">
          LACC Studio
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;background:#faf8f5;color:#8a8479;font-size:12px;line-height:1.5;">
          Los Alamos Community Ceramics · You're receiving this because you have an account in the LACC Studio app.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const BUTTON =
  "display:inline-block;background:#c2683a;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:12px;";

/** Email sent to a member when a new announcement lands in their inbox. */
export function renderAnnouncementEmail(args: {
  name: string;
  subject: string;
  body: string;
  url: string;
}): string {
  const name = escapeHtml(args.name.split(" ")[0] || args.name);
  const subject = escapeHtml(args.subject);
  const body = escapeHtml(args.body).replace(/\n/g, "<br>");
  return shell(`
    <p style="margin:0 0 4px;font-size:15px;color:#8a8479;">Hi ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;">You have a new announcement from the LACC officers:</p>
    <div style="border-left:3px solid #c2683a;padding:4px 0 4px 16px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-size:17px;font-weight:700;">${subject}</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#3d3a35;">${body}</p>
    </div>
    <p style="margin:0 0 8px;"><a href="${args.url}" style="${BUTTON}">Open your inbox</a></p>
  `);
}

/** Email nudging a member about their still-pending job(s) for the month. */
export function renderJobReminderEmail(args: {
  name: string;
  dueText: string; // "July 15" / "the end of July"
  jobs: { name: string; description: string | null }[];
  url: string;
}): string {
  const name = escapeHtml(args.name.split(" ")[0] || args.name);
  const jobs = args.jobs
    .map(
      (j) => `
      <div style="border-left:3px solid #c2683a;padding:4px 0 4px 16px;margin:0 0 14px;">
        <p style="margin:0;font-size:16px;font-weight:700;">${escapeHtml(j.name)}</p>
        ${
          j.description
            ? `<p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:#3d3a35;">${escapeHtml(j.description)}</p>`
            : ""
        }
      </div>`,
    )
    .join("");
  const plural = args.jobs.length === 1 ? "job is" : "jobs are";
  return shell(`
    <p style="margin:0 0 4px;font-size:15px;color:#8a8479;">Hi ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;">Friendly reminder — your studio ${plural} due by <strong>${escapeHtml(args.dueText)}</strong>:</p>
    ${jobs}
    <p style="margin:6px 0 20px;font-size:14px;color:#3d3a35;">Already done? Mark it off in the app and you're all set.</p>
    <p style="margin:0 0 8px;"><a href="${args.url}" style="${BUTTON}">Open LACC Studio</a></p>
  `);
}

/**
 * Email sent once, when a member creates their account.
 *
 * Never restate the PIN here: name + PIN is enough to reset the account's
 * password (see resetPasswordWithPin), so it's a credential, and mail is not a
 * safe channel for one. Nudge them toward the PIN they chose, don't repeat it.
 */
export function renderWelcomeEmail(args: { name: string; url: string }): string {
  const name = escapeHtml(args.name.split(" ")[0] || args.name);
  return shell(`
    <p style="margin:0 0 4px;font-size:15px;color:#8a8479;">Hi ${name},</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">Your LACC Studio account is ready. Here's how to use it:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      <tr>
        <td style="padding:0 0 14px;font-size:15px;line-height:1.55;color:#3d3a35;">
          <strong style="color:#1c1a17;">Signing in</strong><br>
          Use your name (or this email address) together with the password you just chose.
        </td>
      </tr>
      <tr>
        <td style="padding:0;font-size:15px;line-height:1.55;color:#3d3a35;">
          <strong style="color:#1c1a17;">At the studio</strong><br>
          Tap in and out on the sign-in tablet with the 4-digit PIN you picked. Keep it to yourself — it also unlocks a password reset.
        </td>
      </tr>
    </table>
    <p style="margin:0 0 20px;"><a href="${args.url}" style="${BUTTON}">Open LACC Studio</a></p>
    <p style="margin:0;font-size:13px;color:#8a8479;line-height:1.5;">We'll email you when the officers post an announcement. You can turn that off any time from your account page.</p>
  `);
}

/** Email sent when a member requests a password-reset link. */
export function renderResetEmail(args: { link: string }): string {
  return shell(`
    <p style="margin:0 0 16px;font-size:15px;">Someone asked to reset the password for your LACC Studio account.</p>
    <p style="margin:0 0 20px;"><a href="${args.link}" style="${BUTTON}">Reset your password</a></p>
    <p style="margin:0;font-size:13px;color:#8a8479;line-height:1.5;">This link expires in about an hour and can only be used once. If you didn't ask for this, you can safely ignore this email — your password won't change.</p>
  `);
}
