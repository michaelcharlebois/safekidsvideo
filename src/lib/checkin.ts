import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { pushToFamily } from "@/lib/push";
import { CONCERN_LABELS, CONCERN_TAGS, FORMAT_LABELS, type ConcernTag, type ContentCard, type Video, type VideoFormat } from "@/lib/types";
import { isFound } from "@/lib/gate";

/* Daily mood check-in + the "what did the day look like" correlation. Supabase-only. */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
/** Whether viewing and check-ins are recorded at all here (they need the family account's database). */
export const historyRecorded = on;

export const MOODS = [
  { value: 1, emoji: "😤", label: "Rough" },
  { value: 2, emoji: "😐", label: "Meh" },
  { value: 3, emoji: "🙂", label: "Good" },
  { value: 4, emoji: "😄", label: "Great" },
] as const;

export type WatchEvent = { videoId: string; profileId?: string; startedAt: string; completed: boolean; outcome?: "skipped" | "finished" | "left"; endedAtSec?: number };
export type KidDay = { profileId: string; day: string; mood: number; note?: string };

/** Local calendar day for a timezone (defaults to America/Los_Angeles until we've learned the family's). */
export function localDay(tz: string | undefined, d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(d); // YYYY-MM-DD
}

export async function watchEventsSince(familyId: string, sinceIso: string): Promise<WatchEvent[]> {
  if (!on()) return [];
  const { data } = await supabaseAdmin().from("watch_events").select("video_id,profile_id,started_at,completed,outcome,ended_at_sec").eq("family_id", familyId).gte("started_at", sinceIso).order("started_at");
  return (data ?? []).map((r: { video_id: string; profile_id: string | null; started_at: string; completed: boolean; outcome: WatchEvent["outcome"] | null; ended_at_sec: number | null }) =>
    ({ videoId: r.video_id, profileId: r.profile_id ?? undefined, startedAt: r.started_at, completed: r.completed, outcome: r.outcome ?? undefined, endedAtSec: r.ended_at_sec ?? undefined }));
}

export async function listKidDays(familyId: string, sinceDay: string): Promise<KidDay[]> {
  if (!on()) return [];
  const { data } = await supabaseAdmin().from("kid_days").select("profile_id,day,mood,note").eq("family_id", familyId).gte("day", sinceDay);
  return (data ?? []).map((r: { profile_id: string; day: string; mood: number; note: string | null }) => ({ profileId: r.profile_id, day: r.day, mood: r.mood, note: r.note ?? undefined }));
}

export async function saveKidDay(familyId: string, d: KidDay) {
  if (!on()) return;
  const { error } = await supabaseAdmin().from("kid_days").upsert({ family_id: familyId, profile_id: d.profileId, day: d.day, mood: d.mood, note: d.note ?? null }, { onConflict: "profile_id,day" });
  if (error) throw new Error(error.message);
}

export async function saveTimezone(familyId: string, tz: string) {
  if (!on() || !/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(tz)) return;
  await supabaseAdmin().from("families").update({ timezone: tz }).eq("id", familyId);
}

/** Group one day's watching by kid: minutes, formats, tags present — the "day shape". */
export type DayShape = { minutes: number; videos: { video: Video; card?: ContentCard; minutes: number }[]; formats: Set<VideoFormat>; tags: Set<ConcernTag>; frenetic: number };
export function shapeDay(events: WatchEvent[], videoById: Map<string, Video>, cardById: Map<string, ContentCard>): DayShape {
  const shape: DayShape = { minutes: 0, videos: [], formats: new Set(), tags: new Set(), frenetic: 0 };
  for (const e of events) {
    if (e.outcome) continue; // end markers (skipped/finished/left) aren't plays
    const video = videoById.get(e.videoId);
    if (!video) continue;
    const card = cardById.get(e.videoId);
    const dur = (video.durationSeconds ?? 300) / 60;
    const minutes = Math.round(e.completed ? dur : Math.min(dur, Math.max(2, dur * 0.6)));
    shape.minutes += minutes;
    shape.videos.push({ video, card, minutes });
    if (card) {
      shape.formats.add(card.format);
      for (const c of card.concerns) if (isFound(c)) shape.tags.add(c.tag);
      if (card.pace === "frenetic") shape.frenetic += minutes;
    }
  }
  return shape;
}

export type Pattern = { label: string; withAvg: number; withoutAvg: number; withN: number; withoutN: number; delta: number };

/**
 * For one kid: compare average mood on days WITH a feature (a format, a tag, lots of minutes,
 * lots of frenetic pacing) vs days WITHOUT. Only reports patterns with at least 3 days on each side.
 */
export function findPatterns(days: { mood: number; shape: DayShape }[]): Pattern[] {
  const out: Pattern[] = [];
  const test = (label: string, has: (d: { shape: DayShape }) => boolean) => {
    const w = days.filter(has), wo = days.filter((d) => !has(d));
    if (w.length < 3 || wo.length < 3) return;
    const avg = (xs: typeof days) => xs.reduce((a, d) => a + d.mood, 0) / xs.length;
    const withAvg = avg(w), withoutAvg = avg(wo);
    out.push({ label, withAvg, withoutAvg, withN: w.length, withoutN: wo.length, delta: withAvg - withoutAvg });
  };
  for (const f of Object.keys(FORMAT_LABELS) as VideoFormat[]) test(`Watched ${FORMAT_LABELS[f].toLowerCase()}`, (d) => d.shape.formats.has(f));
  for (const t of CONCERN_TAGS) test(`Watched something with ${CONCERN_LABELS[t].toLowerCase()}`, (d) => d.shape.tags.has(t));
  test("More than 60 minutes", (d) => d.shape.minutes > 60);
  test("More than 20 frenetic minutes", (d) => d.shape.frenetic > 20);
  test("No screen time", (d) => d.shape.minutes === 0);
  return out.filter((p) => Math.abs(p.delta) >= 0.4).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Evening nudge: one push per family whose kids watched today and haven't been checked in. */
export async function sendCheckinNudges(log: (s: string) => void = () => {}): Promise<number> {
  if (!on()) return 0;
  const sb = supabaseAdmin();
  const { data: fams } = await sb.from("families").select("id,timezone");
  let sent = 0;
  for (const f of fams ?? []) {
    const day = localDay(f.timezone ?? undefined);
    const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const events = await watchEventsSince(f.id, since);
    if (!events.length) continue;
    const profiles = await db.listProfiles(f.id);
    const done = await listKidDays(f.id, day);
    const pending = profiles.filter((p) => events.some((e) => e.profileId === p.id || (!e.profileId && profiles.length === 1)) && !done.some((d) => d.profileId === p.id && d.day === day));
    if (!pending.length) continue;
    const names = pending.map((p) => p.name);
    const n = await pushToFamily(f.id, {
      title: `How ${names.length === 1 ? `was ${names[0]}` : `were ${names.join(" and ")}`} today?`,
      body: "One tap. Over a few weeks Brightframe connects it to what they watched.",
      url: "/parent/checkin",
      tag: `checkin-${day}`,
    });
    sent += n;
    if (n) log(`nudged ${f.id} for ${names.join(", ")}`);
  }
  return sent;
}
