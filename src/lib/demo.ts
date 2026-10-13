import "server-only";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { DEFAULT_PROFILE } from "@/lib/db/store";
import { familyForUser } from "@/lib/family";
import { hashPin } from "@/lib/pin";

export const DEMO_PIN = "1234";

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
  // Shared demo screens need a PIN to pick a kid; the demo page tells reviewers it's 1234.
  await sb.from("families").update({ pin_hash: hashPin(DEMO_PIN) }).eq("id", fid);

  const profiles = await db.listProfiles(fid);
  if (profiles.length < 2) {
    // Fresh (or reset) demo family: make Maya from whatever single profile exists, or from scratch, then add Leo.
    const base = profiles[0] ?? { ...DEFAULT_PROFILE(fid, "Maya", 6), id: "" };
    await db.upsertProfile({ ...base, familyId: fid, name: "Maya", age: 6, avatar: "🦄", interests: ["animals", "drawing", "space"], mode: "open_ask", dailyMinutes: 45, skipLimit: 3, sort: 0 });
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
  await seedDemoActivity(fid);
  return fid;
}

// ---- synthetic viewing history for the demo family ------------------------------------------

/** Small seeded PRNG so a reset produces a similar-looking month every time. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fill the demo family with ~30 days of believable viewing: after-school and weekend-morning
 * sessions, favourite channels, rewatches, more skipping on frenetic videos, a mood check-in most
 * evenings that dips on long or frantic days, and a couple of pending requests. Only runs when the
 * family has no watch history yet.
 */
export async function seedDemoActivity(fid: string, days = 30) {
  const sb = supabaseAdmin();
  const { count } = await sb.from("watch_events").select("id", { count: "exact", head: true }).eq("family_id", fid);
  if ((count ?? 0) > 0) return;
  await sb.from("families").update({ timezone: "America/Los_Angeles" }).eq("id", fid);

  const { getLibrary, canPlay, needsDecision } = await import("@/lib/queries");
  const profiles = await db.listProfiles(fid);
  const rand = rng(20261013);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const events: Record<string, unknown>[] = [];
  const kidDays: Record<string, unknown>[] = [];

  for (const [pi, p] of profiles.entries()) {
    const settings = await db.getSettings(fid, p.id);
    const lib = await getLibrary(fid, p.id);
    const playable = lib.filter((v) => canPlay(v, settings));
    if (!playable.length) continue;
    // Each kid gets 2–3 favourite channels that take most of their time, and a few favourite videos they rewatch.
    const channels = [...new Set(playable.map((v) => v.channelId))].sort(() => rand() - 0.5);
    const favChannels = new Set(channels.slice(0, Math.min(channels.length, pi === 0 ? 3 : 2)));
    const favVideos = playable.filter((v) => favChannels.has(v.channelId)).sort(() => rand() - 0.5).slice(0, 4).map((v) => v.id);
    const weight = (v: (typeof playable)[number]) => (favChannels.has(v.channelId) ? 4 : 1) * (favVideos.includes(v.id) ? 3 : 1);
    const pool = playable.flatMap((v) => Array(weight(v)).fill(v) as (typeof playable)[number][]);
    const baseMinutes = pi === 0 ? 42 : 26; // Maya watches more than Leo
    const skippy = pi === 0 ? 0.35 : 0.2; // and skips more

    for (let d = days; d >= 1; d--) {
      const day = new Date(Date.now() - d * 86_400_000);
      const dow = day.getUTCDay();
      const weekend = dow === 0 || dow === 6;
      if (rand() < 0.12) continue; // some days, no screen at all
      const target = baseMinutes * (weekend ? 1.5 : 1) * (0.6 + rand() * 0.9);
      // Session start in Pacific time: weekend mornings or after school.
      const startHourPT = weekend ? (rand() < 0.6 ? 8 + rand() * 2 : 15 + rand() * 2) : 15.5 + rand() * 2.5;
      let t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0) + (startHourPT + 7) * 3600_000; // PT ≈ UTC−7
      let minutes = 0, frantic = 0, skips = 0;
      while (minutes < target) {
        const v = pick(pool);
        const dur = v.durationSeconds ?? 300;
        const frenetic = v.card?.pace === "frenetic";
        const r = rand();
        const skipP = skippy + (frenetic ? 0.15 : 0) - (favVideos.includes(v.id) ? 0.2 : 0);
        const outcome: "finished" | "skipped" | "left" = r < skipP ? "skipped" : r < skipP + 0.06 ? "left" : "finished";
        const watched = outcome === "finished" ? dur : outcome === "skipped" ? Math.round(30 + rand() * Math.max(30, dur * 0.5)) : Math.round(dur * (0.3 + rand() * 0.4));
        const startedAt = new Date(t);
        events.push({ family_id: fid, profile_id: p.id, video_id: v.id, started_at: startedAt.toISOString(), completed: outcome === "finished" });
        events.push({ family_id: fid, profile_id: p.id, video_id: v.id, started_at: new Date(t + watched * 1000).toISOString(), completed: outcome === "finished", outcome, ended_at_sec: watched });
        t += (watched + 5 + rand() * 20) * 1000;
        minutes += watched / 60;
        if (frenetic) frantic += watched / 60;
        if (outcome === "skipped") skips++;
        if (outcome === "left") break;
      }
      // Evening check-in most days; rougher after long, frantic, skippy days.
      if (rand() < 0.8) {
        let mood = 3.2 + (rand() - 0.5) * 1.2;
        if (minutes > baseMinutes * 1.4) mood -= 0.8;
        if (frantic > 15) mood -= 0.7;
        if (skips >= 6) mood -= 0.5;
        if (weekend) mood += 0.3;
        const localDate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString().slice(0, 10);
        kidDays.push({ family_id: fid, profile_id: p.id, day: localDate, mood: Math.max(1, Math.min(4, Math.round(mood))), note: null });
      }
    }

    // A couple of pending "ask a grown-up" requests from the older kid, on videos their filters hide.
    if (pi === 0) {
      const hidden = lib.filter((v) => needsDecision(v, settings)).slice(0, 2);
      for (const v of hidden) await sb.from("watch_requests").insert({ family_id: fid, video_id: v.id, profile_id: p.id });
    }
  }

  for (let i = 0; i < events.length; i += 500) {
    const { error } = await sb.from("watch_events").insert(events.slice(i, i + 500));
    if (error) throw new Error(`seeding watch history: ${error.message}`);
  }
  if (kidDays.length) {
    const { error } = await sb.from("kid_days").upsert(kidDays, { onConflict: "profile_id,day" });
    if (error) throw new Error(`seeding check-ins: ${error.message}`);
  }
}
