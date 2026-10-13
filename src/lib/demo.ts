import "server-only";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { DEFAULT_PROFILE } from "@/lib/db/store";
import { familyForUser } from "@/lib/family";

/*
 * Demo access: a secret link that signs a reviewer into a separate, pre-filled demo family —
 * no email code, no pairing code. Off unless DEMO_KEY is set; optionally expires at DEMO_EXPIRES.
 * The demo family never touches real families' data, is never an admin, and never sees billing.
 */

export const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@siftkids.com";

export function demoEnabled(): boolean {
  if (!supabaseEnabled || !process.env.DEMO_KEY || !process.env.DEMO_PASSWORD) return false;
  const exp = process.env.DEMO_EXPIRES;
  return !exp || Date.now() < Date.parse(exp);
}

export function demoKeyOk(key: string | null | undefined): boolean {
  const want = process.env.DEMO_KEY;
  if (!demoEnabled() || !want || !key) return false;
  const a = Buffer.from(key), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The demo parent's auth user, created on first use. */
export async function ensureDemoUser(): Promise<string> {
  const admin = supabaseAdmin();
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL.toLowerCase());
  if (existing) {
    // Keep the password in sync with the env so rotating DEMO_PASSWORD just works.
    await admin.auth.admin.updateUserById(existing.id, { password: process.env.DEMO_PASSWORD! });
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password: process.env.DEMO_PASSWORD!, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? "could not create demo user");
  return data.user.id;
}

/**
 * Make sure the demo family looks lived-in: two kids, the best-reviewed channels in the shared
 * library approved, onboarding done, billing off. `reset` wipes the family's choices first.
 */
export async function ensureDemoFamily(userId: string, reset = false): Promise<string> {
  const fid = await familyForUser(userId);
  const sb = supabaseAdmin();
  if (reset) {
    await Promise.all([
      sb.from("whitelist").delete().eq("family_id", fid),
      sb.from("watch_requests").delete().eq("family_id", fid),
      sb.from("watch_events").delete().eq("family_id", fid),
      sb.from("kid_checks").delete().eq("family_id", fid),
      sb.from("kid_days").delete().eq("family_id", fid),
      sb.from("confirmations").delete().eq("family_id", fid),
      sb.from("devices").delete().eq("family_id", fid),
    ]);
    await sb.from("profiles").delete().eq("family_id", fid);
  }
  await db.updateFamily(fid, { onboardedAt: new Date().toISOString(), plan: "free" });

  const profiles = await db.listProfiles(fid); // creates a default "My kid" if none
  if (profiles.length < 2) {
    const [first] = profiles;
    await db.upsertProfile({ ...first, name: "Maya", age: 6, avatar: "🦄", interests: ["animals", "drawing", "space"], mode: "open_ask", dailyMinutes: 45, skipLimit: 3 });
    await db.upsertProfile({ ...DEFAULT_PROFILE(fid, "Leo", 4), id: "", avatar: "🦖", interests: ["dinosaurs", "trucks", "songs"], mode: "locked", sort: 1 });
  }

  const wl = await db.listWhitelist(fid);
  if (!wl.some((w) => w.kind === "channel")) {
    // Approve the channels with the most real, passing cards.
    const [videos, channels] = await Promise.all([db.listVideos(), db.listChannels()]);
    const cards = await db.listCards(videos.map((v) => v.id));
    const good = new Map<string, number>();
    for (const c of cards) {
      if (c.reviewer.model === "sample") continue;
      if (c.concerns.some((f) => f.present && f.intensity >= 2)) continue;
      const v = videos.find((x) => x.id === c.videoId);
      if (v) good.set(v.channelId, (good.get(v.channelId) ?? 0) + 1);
    }
    const pick = channels.filter((c) => (good.get(c.id) ?? 0) >= 2).sort((a, b) => (good.get(b.id) ?? 0) - (good.get(a.id) ?? 0)).slice(0, 7);
    for (const c of pick) await db.addToWhitelist({ familyId: fid, kind: "channel", targetId: c.id });
  }
  return fid;
}
