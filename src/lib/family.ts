import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { DEFAULT_FAMILY_ID, STORE_KIND } from "@/lib/db";
import { supabaseAdmin, supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { PARENT_COOKIE } from "@/lib/auth";
import { pickKid } from "@/lib/kid-pick";
import { afterPinAttempt, pinLocked, type PinLock } from "@/lib/pin";

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

  // Parent?
  const sb = await supabaseAuthClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const familyId = await familyForUser(user.id);
    const cookieKid = c.get(PROFILE_COOKIE)?.value;
    const profiles = await familyProfiles(familyId);
    return { role: "parent", familyId, email: user.email, admin: isAdminEmail(user.email), profileId: profiles.some((p) => p.id === cookieKid) ? cookieKid : undefined };
  }

  // Paired device?
  const token = c.get(DEVICE_COOKIE)?.value;
  if (token) {
    const { data } = await supabaseAdmin()
      .from("devices")
      .select("id,family_id,name,revoked_at,assigned_profile_id,active_profile_id")
      .eq("token_hash", sha(token))
      .maybeSingle();
    if (data && !data.revoked_at) {
      void supabaseAdmin().from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
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
  return { role: "none", familyId: null };
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
  const sb = supabaseAdmin();
  const { data } = await sb.from("pairing_codes").select("*").eq("code", code.trim()).maybeSingle();
  if (!data) return { error: "That code isn't right." };
  if (data.used_at) return { error: "That code was already used. Make a new one." };
  if (new Date(data.expires_at) < new Date()) return { error: "That code expired. Make a new one." };
  const token = randomBytes(32).toString("base64url");
  const { error } = await sb.from("devices").insert({ family_id: data.family_id, token_hash: sha(token), name: deviceName || "Tablet" });
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
  const { error } = await supabaseAdmin().from("devices")
    .update({ assigned_profile_id: profileId, active_profile_id: null })
    .match({ id: deviceId, family_id: familyId });
  if (error) throw new Error(error.message);
}

export async function setDeviceActiveProfile(familyId: string, deviceId: string, profileId: string | null) {
  const { error } = await supabaseAdmin().from("devices").update({ active_profile_id: profileId }).match({ id: deviceId, family_id: familyId });
  if (error) throw new Error(error.message);
}

/** Shared-screen PIN lockout, stored on the device row so it survives serverless restarts. */
export async function devicePinLock(deviceId: string): Promise<PinLock & { secondsLeft: number }> {
  const { data } = await supabaseAdmin().from("devices").select("pin_failures,pin_locked_until").eq("id", deviceId).maybeSingle();
  const s: PinLock = { failures: data?.pin_failures ?? 0, lockedUntil: data?.pin_locked_until ?? null };
  return { ...s, secondsLeft: pinLocked(s) };
}
export async function recordDevicePinAttempt(deviceId: string, ok: boolean) {
  const cur = await devicePinLock(deviceId);
  const next = afterPinAttempt(cur, ok);
  await supabaseAdmin().from("devices").update({ pin_failures: next.failures, pin_locked_until: next.lockedUntil ?? null }).eq("id", deviceId);
}

export async function revokeDevice(familyId: string, deviceId: string) {
  await supabaseAdmin().from("devices").update({ revoked_at: new Date().toISOString() }).match({ id: deviceId, family_id: familyId });
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
