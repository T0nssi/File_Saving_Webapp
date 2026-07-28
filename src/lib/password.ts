// Password hashing only ever runs inside API route handlers (Node.js
// runtime), never in middleware, so it's safe to use Node's built-in
// `crypto` module here (scrypt) rather than the Web Crypto subset that
// middleware is restricted to. No new dependency needed either way.
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = scryptSync(password, salt, KEY_LENGTH);
    const stored = Buffer.from(hash, "hex");
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 6;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 40;

export function sanitizeUsername(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, MAX_USERNAME_LENGTH);
}
