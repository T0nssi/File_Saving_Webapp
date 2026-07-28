// Session signing for the whole app. Deliberately uses the global Web Crypto
// API (available in both the Node.js runtime and the Edge runtime that
// middleware.ts runs on) instead of Node's `crypto` module, so this file
// works unmodified in middleware without adding any dependency.
//
// Password hashing itself lives in lib/password.ts (Node-only, scrypt) since
// that only ever runs inside API route handlers, never in middleware.
// Real per-user session revocation (sessionVersion) lives in lib/session.ts
// since checking it requires a database round trip, which the Edge runtime
// that middleware.ts runs on can't do — see that file for how the two
// layers fit together.

export const COOKIE_NAME = "vault_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Copy .env.example to .env.local and set a random secret."
    );
  }
  return secret;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time-ish string compare — both inputs are always fixed-length hex
// HMAC digests here, so this never leaks length information either.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SessionPayload {
  userId: string;
  username: string;
  sessionVersion: number;
}

/** Whether the current request actually arrived over HTTPS — used instead
 * of blindly checking NODE_ENV==="production" for the cookie's Secure flag.
 * That NODE_ENV check is a common trap: after `npm run build && npm start`,
 * NODE_ENV is "production" even if the app is being served over plain
 * http:// (e.g. local testing, a LAN deployment, or a reverse proxy that
 * terminates TLS in front of it). A Secure cookie is silently refused by
 * the browser on a non-HTTPS origin — login would appear to succeed (200
 * response) but the session cookie never actually gets stored, so the very
 * next request looks logged out again. Checking x-forwarded-proto covers
 * the reverse-proxy case (the proxy terminates TLS, so the Next.js process
 * itself sees http, but the browser's connection was https).
 */
export function isRequestSecure(req: { nextUrl: { protocol: string }; headers: { get(name: string): string | null } }): boolean {
  if (req.nextUrl.protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto") === "https";
}

/** username is sanitized to [a-z0-9_.-] elsewhere, so it never contains the
 * "|" or "." delimiters used here. */
export async function createSessionToken(
  userId: string,
  username: string,
  sessionVersion: number
): Promise<string> {
  const payload = `${userId}|${username}|${sessionVersion}|${Date.now()}|${Math.random().toString(36).slice(2)}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  try {
    const expected = await hmac(payload);
    return timingSafeEqualStr(sig, expected);
  } catch {
    return false;
  }
}

/** Reads userId/username/sessionVersion out of a token. Does NOT verify the
 * signature — only call this after verifySessionToken (or on a request that
 * already passed through middleware, which does verify it). This alone also
 * does NOT confirm the session hasn't been revoked — see requireUser() in
 * lib/session.ts for that. */
export function parseSessionPayload(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;
  const [userId, username, sessionVersionRaw] = token.slice(0, lastDot).split("|");
  const sessionVersion = Number(sessionVersionRaw);
  if (!userId || !username || !Number.isFinite(sessionVersion)) return null;
  return { userId, username, sessionVersion };
}
