import "server-only";
import { assertPermissionWritesOpen, permissionWritesPaused, PermissionWritesPaused } from "@/lib/maintenance";
import { cookies } from "next/headers";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { DEFAULT_FAMILY_ID, STORE_KIND } from "@/lib/db";
import { supabaseAdmin, supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { PARENT_COOKIE } from "@/lib/auth";
import { pickKid } from "@/lib/kid-pick";
import { PIN_LOCK_MS, PIN_MAX_FAILURES } from "@/lib/pin";

export const DEVICE_COOKIE = "skv_device";

export type Viewer =
  | { role: "parent"; familyId: string; email?: string; admin: boolean; profileId?: string }
  | {
      role: "device"; familyId: string; deviceId: string; deviceName: string;
      /** the child this screen is for, decided server-side (see pickKid); undefined = nobody yet → fail closed */
      profileId?: string;
      /** personal device: locked to this child */
      assignedProfileId?: string;
      /** more than one child and not assigned: switching needs the parent PIN */
      shared: boolean;
    }
  | { role: "none"; familyId: null };

/**
 * Which kid a PARENT is looking at (dashboard, kid-screen preview). A convenience cookie, validated
 * against the family. Devices never use it: a device's child is stored server-side on the device row.
 * (Local single-family dev mode also uses it for its one pretend device — see resolveViewer.)
 */
export const PROFILE_COOKIE = "sift_profile";
async function familyProfiles(familyId: string) {
  const { db } = await import("@/lib/db");
  return db.listProfiles(familyId);
}

/** Global knobs (reviewer notes, learn-now) are limited to ADMIN_EMAILS — comma-separated. Unset = nobody. */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Who is making this request, and which family do they belong to?
 *
 * Local mode (no Supabase): a single family; the PIN cookie decides parent vs. kid.
 * Supabase mode: a signed-in user is a parent (and owns a family, created on first sign-in);
 * a device-token cookie is a paired kid device.
 */
export async function resolveViewer(): Promise<Viewer> {
  const c = await cookies();
  if (!supabaseEnabled || STORE_KIND === "local") {
    // Dev-only single-family mode. The pretend device keeps its active child in a cookie (no device table);
    // it's still only ever set by the PIN-checked selectProfile action.
    const isParent = c.get(PARENT_COOKIE)?.value === "1";
    const profiles = await familyProfiles(DEFAULT_FAMILY_ID);
    const cookieKid = c.get(PROFILE_COOKIE)?.value;
    if (isParent) return { role: "parent", familyId: DEFAULT_FAMILY_ID, admin: true, profileId: profiles.some((p) => p.id === cookieKid) ? cookieKid : undefined };
    return { role: "device", familyId: DEFAULT_FAMILY_ID, deviceId: "local", deviceName: "This device", profileId: pickKid(profiles, null, cookieKid), shared: profiles.length > 1 };
  }

  // Paired screen? Checked first: a browser holding a valid, non-revoked screen token is that kid screen,
  // even if a parent session is also present (an older browser, or two tabs racing). Failing toward the kid
  // screen is the safe direction: a parent session left behind on a child's TV must not give parent access.
  // Pairing and parent sign-in each remove the other credential (lib/session-transition.ts), so this only
  // applies to leftovers. A revoked or unknown token is ignored, as before. Parent access always needs a
  // session the auth server verifies (getUser); a screen token or the family PIN never grants it.
  const token = c.get(DEVICE_COOKIE)?.value;
  if (token) {
    const { data, error } = await supabaseAdmin()
      .from("devices")
      .select("id,family_id,name,revoked_at,last_seen_at,assigned_profile_id,active_profile_id")
      .eq("token_hash", sha(token))
      .maybeSingle();
    // Couldn't check the screen token: fail closed rather than fall through to a parent session that may be
    // a leftover on a child's screen.
    if (error) { console.error("device lookup failed", error.message); return { role: "none", familyId: null }; }
    if (data && !data.revoked_at) {
      // Noncritical: never throws, and authorization above doesn't depend on it.
      await recordDeviceActivity(data);
      const profiles = await familyProfiles(data.family_id);
      const assigned = profiles.some((p) => p.id === data.assigned_profile_id) ? data.assigned_profile_id : undefined;
      return {
        role: "device", familyId: data.family_id, deviceId: data.id, deviceName: data.name,
        profileId: pickKid(profiles, data.assigned_profile_id, data.active_profile_id),
        assignedProfileId: assigned ?? undefined,
        shared: !assigned && profiles.length > 1,
      };
    }
  }
  // Parent? Verified with the auth server, not just a cookie being present.
  const sb = await supabaseAuthClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const familyId = await familyForUser(user.id);
    const cookieKid = c.get(PROFILE_COOKIE)?.value;
    const profiles = await familyProfiles(familyId);
    return { role: "parent", familyId, email: user.email, admin: isAdminEmail(user.email), profileId: profiles.some((p) => p.id === cookieKid) ? cookieKid : undefined };
  }

  return { role: "none", familyId: null };
}

// ---- device activity ("last active" on Screens) ---------------------------
// Separate from viewing history: this is "the screen was used" (any kid page, including Time to rest and
// the daily-limit screen), not "a video played".

/** At most one last-seen write per screen per this interval. Screens shows "in the last 5 minutes" below it. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;
/** This server instance's recent writes, so repeat calls in one request (layout + page) skip the database. */
const recentTouches = new Map<string, number>();
export function __resetDeviceActivityCache() { recentTouches.clear(); }

/**
 * Record that an authenticated, non-revoked screen was used. Throttled twice over: skipped when the row's
 * last_seen_at (or this instance's last write) is under LAST_SEEN_EVERY_MS old, and the UPDATE itself only
 * matches when the stored value is older than that — so concurrent requests on other instances write once.
 * The update is scoped to the device's id, its family, and revoked_at is null. Errors are logged and
 * swallowed: activity tracking must never decide authorization.
 */
export async function recordDeviceActivity(
  d: { id: string; family_id: string; last_seen_at?: string | null },
  now = Date.now(),
): Promise<"written" | "skipped" | "failed"> {
  const last = Math.max(d.last_seen_at ? Date.parse(d.last_seen_at) || 0 : 0, recentTouches.get(d.id) ?? 0);
  if (now - last < LAST_SEEN_EVERY_MS) return "skipped";
  recentTouches.set(d.id, now);
  if (recentTouches.size > 10_000) recentTouches.clear();
  try {
    const stale = new Date(now - LAST_SEEN_EVERY_MS).toISOString();
    const { error } = await supabaseAdmin().from("devices")
      .update({ last_seen_at: new Date(now).toISOString() })
      .match({ id: d.id, family_id: d.family_id })
      .is("revoked_at", null)
      .or(`last_seen_at.is.null,last_seen_at.lt.${stale}`);
    if (!error) return "written";
    console.error("device last-seen update failed", error.message);
  } catch (e) {
    console.error("device last-seen update failed", e instanceof Error ? e.message : e);
  }
  recentTouches.delete(d.id); // let the next request try again
  return "failed";
}

/** The kid screen this browser currently is (a valid, non-revoked screen token), for explaining sign-in. */
export async function screenInThisBrowser(): Promise<{ name: string } | null> {
  if (!supabaseEnabled || STORE_KIND === "local") return null;
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token) return null;
  const { data } = await supabaseAdmin().from("devices").select("name,revoked_at").eq("token_hash", sha(token)).maybeSingle();
  return data && !data.revoked_at ? { name: data.name } : null;
}

/** The family a signed-in parent owns, created on first sign-in. */
export async function familyForUser(userId: string): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("families").select("id").eq("owner_user_id", userId).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await sb
    .from("families")
    .insert({ owner_user_id: userId, pin_hash: "1234", kid_age: 6, plan: "trial", trial_ends_at: new Date(Date.now() + 30 * 86_400_000).toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

// ---- pairing -------------------------------------------------------------

export async function createPairingCode(familyId: string): Promise<{ code: string; expiresAt: string }> {
  assertPermissionWritesOpen();
  const sb = supabaseAdmin();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const { error } = await sb.from("pairing_codes").insert({ code, family_id: familyId, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
  }
  throw new Error("Could not generate a pairing code; try again");
}

/** Mint a device directly (demo access only). Returns the raw token to set as the device cookie. */
export async function createDeviceToken(familyId: string, name: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin().from("devices").insert({ family_id: familyId, token_hash: sha(token), name });
  if (error) throw new Error(error.message);
  return token;
}

/** Redeem a code from the kid device. Returns the raw token to set as a cookie. */
export async function redeemPairingCode(code: string, deviceName: string): Promise<{ token: string } | { error: string }> {
  if (permissionWritesPaused()) return { error: new PermissionWritesPaused().message };
  const sb = supabaseAdmin();
  const { data } = await sb.from("pairing_codes").select("*").eq("code", code.trim()).maybeSingle();
  if (!data) return { error: "That code isn't right." };
  if (data.used_at) return { error: "That code was already used. Make a new one." };
  if (new Date(data.expires_at) < new Date()) return { error: "That code expired. Make a new one." };
  const token = randomBytes(32).toString("base64url");
  // Pairing is the screen's first use: it gets an accurate first "last active" straight away.
  const { error } = await sb.from("devices").insert({ family_id: data.family_id, token_hash: sha(token), name: deviceName || "Tablet", last_seen_at: new Date().toISOString() });
  if (error) return { error: error.message };
  await sb.from("pairing_codes").update({ used_at: new Date().toISOString() }).eq("code", code);
  return { token };
}

export async function listDevices(familyId: string) {
  const { data } = await supabaseAdmin()
    .from("devices")
    .select("id,name,paired_at,last_seen_at,revoked_at,assigned_profile_id,active_profile_id")
    .eq("family_id", familyId)
    .order("paired_at", { ascending: false });
  return (data ?? []) as { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked_at: string | null; assigned_profile_id: string | null; active_profile_id: string | null }[];
}

/** Personal device (a child) or shared (null). The composite FK rejects a child from another family. */
export async function assignDevice(familyId: string, deviceId: string, profileId: string | null) {
  assertPermissionWritesOpen();
  const { error } = await supabaseAdmin().from("devices")
    .update({ assigned_profile_id: profileId, active_profile_id: null })
    .match({ id: deviceId, family_id: familyId });
  if (error) throw new Error(error.message);
}

export async function setDeviceActiveProfile(familyId: string, deviceId: string, profileId: string | null) {
  assertPermissionWritesOpen();
  const { error } = await supabaseAdmin().from("devices").update({ active_profile_id: profileId }).match({ id: deviceId, family_id: familyId });
  if (error) throw new Error(error.message);
}

/** Shared-screen PIN lockout, stored on the device row so it survives serverless restarts. */
export class PinCheckUnavailable extends Error {}

/**
 * Claim one PIN attempt for a shared screen, atomically (0019 claim_pin_attempt): refused while locked;
 * otherwise counted up front, and the PIN_MAX_FAILURES-th claim starts the lock. Any database error
 * throws PinCheckUnavailable — the caller fails closed (no PIN check, no switch).
 */
export async function claimDevicePinAttempt(deviceId: string): Promise<{ allowed: boolean; secondsLeft: number }> {
  const { data, error } = await supabaseAdmin().rpc("claim_pin_attempt", {
    p_device: deviceId, p_max: PIN_MAX_FAILURES, p_lock: `${Math.round(PIN_LOCK_MS / 1000)} seconds`,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row.allowed !== "boolean") {
    console.error("claim_pin_attempt failed", error?.message ?? "no row");
    throw new PinCheckUnavailable("Couldn't check the PIN right now. Try again in a moment.");
  }
  return { allowed: row.allowed, secondsLeft: Number(row.seconds_left) || 0 };
}

/** The PIN was right: clear this screen's counted attempts. Errors throw (the caller doesn't switch). */
export async function devicePinSucceeded(deviceId: string) {
  const { error } = await supabaseAdmin().rpc("pin_attempt_succeeded", { p_device: deviceId });
  if (error) {
    console.error("pin_attempt_succeeded failed", error.message);
    throw new PinCheckUnavailable("Couldn't check the PIN right now. Try again in a moment.");
  }
}

/**
 * Disconnect the screen whose token this browser holds (a parent is signing in here). Scoped by the token
 * itself, which only this browser has; an unknown or already-disconnected token is "none". A database error
 * is "failed" — the caller still removes the cookie and tells the parent to disconnect it on Screens.
 */
export async function revokeDeviceToken(token: string): Promise<{ status: "revoked"; name: string } | { status: "none" } | { status: "failed"; name?: string }> {
  try {
    const sb = supabaseAdmin();
    const { data: row, error } = await sb.from("devices").select("id,name,revoked_at").eq("token_hash", sha(token)).maybeSingle();
    if (error) { console.error("revokeDeviceToken lookup failed", error.message); return { status: "failed" }; }
    if (!row || row.revoked_at) return { status: "none" };
    const { data, error: e2 } = await sb.from("devices").update({ revoked_at: new Date().toISOString() })
      .match({ id: row.id, token_hash: sha(token) }).is("revoked_at", null).select("id");
    if (e2 || !Array.isArray(data) || data.length !== 1) { console.error("revokeDeviceToken update failed", e2?.message ?? "no row"); return { status: "failed", name: row.name }; }
    return { status: "revoked", name: row.name };
  } catch (e) {
    console.error("revokeDeviceToken failed", e instanceof Error ? e.message : e);
    return { status: "failed" };
  }
}

/** A disconnect that didn't happen. The screen is still connected; callers must not report success. */
export class DeviceRevokeFailed extends Error {}

/**
 * Disconnect one of this family's screens. Allowed while permission writes are paused (it only restricts).
 * Succeeds only when the row is verifiably revoked: updated now, or already revoked earlier (a repeated
 * click). A database error, or a screen that isn't this family's, throws DeviceRevokeFailed.
 */
export async function revokeDevice(familyId: string, deviceId: string): Promise<{ name: string }> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .match({ id: deviceId, family_id: familyId })
    .is("revoked_at", null)
    .select("id,name");
  if (error) { console.error("revokeDevice failed", error.message); throw new DeviceRevokeFailed("Couldn't disconnect that screen. It's still connected. Try again."); }
  if (Array.isArray(data) && data.length === 1) return { name: data[0].name };
  // Nothing updated: already disconnected (fine), or not one of this family's screens (refuse).
  const { data: row, error: e2 } = await sb.from("devices").select("id,name,revoked_at").match({ id: deviceId, family_id: familyId }).maybeSingle();
  if (e2) { console.error("revokeDevice check failed", e2.message); throw new DeviceRevokeFailed("Couldn't confirm that screen was disconnected. Check the list and try again."); }
  if (row?.revoked_at) return { name: row.name };
  throw new DeviceRevokeFailed("That screen wasn't found.");
}

export async function listActiveCodes(familyId: string): Promise<{ code: string; expiresAt: string }[]> {
  const { data } = await supabaseAdmin()
    .from("pairing_codes")
    .select("code,expires_at")
    .eq("family_id", familyId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false });
  return (data ?? []).map((r: { code: string; expires_at: string }) => ({ code: r.code, expiresAt: r.expires_at }));
}
