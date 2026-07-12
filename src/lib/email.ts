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
 * Pre-domain demo note: with an unverified sending domain, Resend only delivers
 * to the address that owns the Resend account. Once laccsignin.com is verified,
 * set EMAIL_FROM to something like "LACC Studio <noreply@laccsignin.com>";
 * until then it sends from Resend's shared onboarding@resend.dev address.
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

/** Absolute base URL for links inside emails (no trailing slash). */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
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

/** Email sent when a member requests a password-reset link. */
export function renderResetEmail(args: { link: string }): string {
  return shell(`
    <p style="margin:0 0 16px;font-size:15px;">Someone asked to reset the password for your LACC Studio account.</p>
    <p style="margin:0 0 20px;"><a href="${args.link}" style="${BUTTON}">Reset your password</a></p>
    <p style="margin:0;font-size:13px;color:#8a8479;line-height:1.5;">This link expires in about an hour and can only be used once. If you didn't ask for this, you can safely ignore this email — your password won't change.</p>
  `);
}
