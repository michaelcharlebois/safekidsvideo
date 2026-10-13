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
  return !!stored && !verifyPin(LEGACY_DEFAULT_PIN, stored); // plain "1234" or a hash of it
}

/** A PIN a parent may choose: 4 digits, and not the old default every family started with. */
export function newPinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "The PIN must be 4 digits.";
  if (pin === LEGACY_DEFAULT_PIN) return "Pick a PIN other than 1234 — it was the old default, so kids may know it.";
  return null;
}

// The shared-screen lockout (PIN_MAX_FAILURES tries, then PIN_LOCK_MS) is enforced atomically in the
// database: see supabase/migrations/0019_pin_attempts.sql and claimDevicePinAttempt() in family.ts.
