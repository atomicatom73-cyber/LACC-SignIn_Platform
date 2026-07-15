/**
 * Google service-account auth, shared by the members-roster sync (reads the
 * private sign-ups sheet) and the sign-in log export (writes the log sheet).
 * A signed JWT is exchanged for a short-lived access token — no OAuth consent
 * and no SDK. What a token can touch is still governed per-file by Drive
 * sharing: the account is a Viewer on the roster sheet and an Editor on the
 * log sheet, so even a read-write token can't change the roster.
 */

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEETS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SHEETS_READWRITE_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";

/**
 * Service-account identity, from env. The canonical names are
 * GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY, but the literal
 * field names from the service account's JSON key file (client_email /
 * private_key) are accepted too — that's what gets pasted in practice.
 * Values survive the usual paste accidents: surrounding quotes, literal
 * \n / \r escapes, or the ENTIRE JSON key file dropped into either var.
 */
function serviceAccount(): { clientEmail?: string; privateKey?: string } {
  const unquote = (v?: string) =>
    v?.trim().replace(/^['"]+/, "").replace(/['"]+$/, "") || undefined;
  let clientEmail = unquote(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.client_email,
  );
  let privateKey = unquote(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.private_key,
  );

  const tryJson = (v?: string) => {
    if (!v?.startsWith("{")) return null;
    try {
      return JSON.parse(v) as { client_email?: string; private_key?: string };
    } catch {
      return null;
    }
  };
  const json = tryJson(privateKey) ?? tryJson(clientEmail);
  if (json) {
    clientEmail = json.client_email ?? clientEmail;
    privateKey = json.private_key ?? privateKey;
  }

  privateKey = privateKey?.replace(/\\n/g, "\n").replace(/\r/g, "");
  return { clientEmail, privateKey };
}

/** True when the service-account env vars are present. */
export function serviceAccountConfigured(): boolean {
  const { clientEmail, privateKey } = serviceAccount();
  return Boolean(clientEmail && privateKey);
}

const cachedTokens = new Map<string, { token: string; expiresAt: number }>();

/**
 * Mint (and cache, per scope) a Sheets access token: sign a JWT with the
 * service account's private key and exchange it. The key usually arrives via
 * env with literal "\n" sequences — normalize those back to newlines.
 */
export async function googleAccessToken(scope: string): Promise<string> {
  const cached = cachedTokens.get(scope);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const { clientEmail, privateKey } = serviceAccount();
  if (!clientEmail || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY (or client_email / private_key) must be set.",
    );
  }
  if (!privateKey.includes("-----BEGIN")) {
    throw new Error(
      "The service-account key doesn't look like a PEM private key — paste the private_key field from the JSON key file (or the whole JSON file).",
    );
  }

  const b64url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: clientEmail,
    scope,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey)
    .toString("base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  cachedTokens.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return cachedTokens.get(scope)!.token;
}
