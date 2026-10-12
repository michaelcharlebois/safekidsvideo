import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { DEFAULT_FAMILY_ID, STORE_KIND } from "@/lib/db";
import { supabaseAdmin, supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { PARENT_COOKIE } from "@/lib/auth";

export const DEVICE_COOKIE = "skv_device";

export type Viewer =
  | { role: "parent"; familyId: string; email?: string }
  | { role: "device"; familyId: string; deviceId: string; deviceName: string }
  | { role: "none"; familyId: null };

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
    const isParent = c.get(PARENT_COOKIE)?.value === "1";
    return isParent
      ? { role: "parent", familyId: DEFAULT_FAMILY_ID }
      : { role: "device", familyId: DEFAULT_FAMILY_ID, deviceId: "local", deviceName: "This device" };
  }

  // Parent?
  const sb = await supabaseAuthClient();
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const familyId = await familyForUser(user.id);
    return { role: "parent", familyId, email: user.email };
  }

  // Paired device?
  const token = c.get(DEVICE_COOKIE)?.value;
  if (token) {
    const { data } = await supabaseAdmin()
      .from("devices")
      .select("id,family_id,name,revoked_at")
      .eq("token_hash", sha(token))
      .maybeSingle();
    if (data && !data.revoked_at) {
      void supabaseAdmin().from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
      return { role: "device", familyId: data.family_id, deviceId: data.id, deviceName: data.name };
    }
  }
  return { role: "none", familyId: null };
}

/** The family a signed-in parent owns, created on first sign-in. */
async function familyForUser(userId: string): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("families").select("id").eq("owner_user_id", userId).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await sb
    .from("families")
    .insert({ owner_user_id: userId, pin_hash: "1234", kid_age: 6 })
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
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { error } = await sb.from("pairing_codes").insert({ code, family_id: familyId, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
  }
  throw new Error("Could not generate a pairing code; try again");
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
    .select("id,name,paired_at,last_seen_at,revoked_at")
    .eq("family_id", familyId)
    .order("paired_at", { ascending: false });
  return (data ?? []) as { id: string; name: string; paired_at: string; last_seen_at: string | null; revoked_at: string | null }[];
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
