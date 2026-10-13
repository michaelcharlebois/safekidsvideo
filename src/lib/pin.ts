// Family PIN: hashing, verification, and the shared-screen lockout. Pure (node:crypto only) for tests.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** The PIN every family started with before PINs were required. Treated as "not set". */
export const LEGACY_DEFAULT_PIN = "1234";
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 5 * 60_000;

export function hashPin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be 4 digits");
  const salt = randomBytes(16);
  return `s1$${salt.toString("base64")}$${scryptSync(pin, salt, 32).toString("base64")}`;
}

/** Accepts hashed PINs and (legacy) plain 4-digit ones. */
export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !/^\d{4}$/.test(pin)) return false;
  if (stored.startsWith("s1$")) {
    const [, salt, hash] = stored.split("$");
    const want = Buffer.from(hash, "base64");
    const got = scryptSync(pin, Buffer.from(salt, "base64"), want.length);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  const a = Buffer.from(pin), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A PIN a kid could guess from the app's history doesn't count: shared-screen switching stays closed until a parent sets one. */
export function pinIsSet(stored: string | null | undefined): boolean {
  return !!stored && stored !== LEGACY_DEFAULT_PIN;
}

export type PinLock = { failures: number; lockedUntil?: string | null };

export function pinLocked(s: PinLock, now = Date.now()): number {
  const until = s.lockedUntil ? Date.parse(s.lockedUntil) : 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0; // seconds remaining
}

export function afterPinAttempt(s: PinLock, ok: boolean, now = Date.now()): PinLock {
  if (ok) return { failures: 0, lockedUntil: null };
  const failures = s.failures + 1;
  return failures >= PIN_MAX_FAILURES
    ? { failures: 0, lockedUntil: new Date(now + PIN_LOCK_MS).toISOString() }
    : { failures, lockedUntil: s.lockedUntil ?? null };
}
