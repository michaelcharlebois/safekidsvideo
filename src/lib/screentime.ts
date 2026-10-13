import "server-only";
import { db } from "@/lib/db";
import { localDay, shapeDay, watchEventsSince } from "@/lib/checkin";
import { pushToFamily } from "@/lib/push";
import type { FamilySettings } from "@/lib/types";

/* Screen-time limits: minutes per day + a "done for the day" time, per kid, with parent-granted bonus minutes. */

export type TimeState =
  | { allowed: true; remainingMinutes?: number; bedtime?: string }
  | { allowed: false; reason: "limit" | "bedtime"; usedMinutes: number; limitMinutes?: number; bedtime?: string };

function minutesOfDay(hhmm: string, tz?: string, d = new Date()): { now: number; at: number } {
  const [h, m] = hhmm.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const nh = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, nm = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { now: nh * 60 + nm, at: h * 60 + m };
}

/** Approximate minutes this kid has watched today (completed → full length, else ~60%). */
export async function minutesUsedToday(familyId: string, profileId: string | undefined, tz?: string): Promise<number> {
  const day = localDay(tz);
  const events = (await watchEventsSince(familyId, new Date(Date.now() - 30 * 3600 * 1000).toISOString()))
    .filter((e) => localDay(tz, new Date(e.startedAt)) === day && (!profileId || e.profileId === profileId || !e.profileId));
  if (!events.length) return 0;
  const ids = [...new Set(events.map((e) => e.videoId))];
  const videos = await Promise.all(ids.map((id) => db.getVideo(id)));
  const videoById = new Map(videos.filter(Boolean).map((v) => [v!.id, v!]));
  return shapeDay(events, videoById, new Map()).minutes;
}

export async function timeState(familyId: string, settings: FamilySettings, tz?: string): Promise<TimeState> {
  const today = localDay(tz);
  if (settings.bedtime) {
    const { now, at } = minutesOfDay(settings.bedtime, tz);
    // "Done for the day" applies from bedtime until 4am.
    if (now >= at || now < 4 * 60) {
      const used = settings.dailyMinutes ? await minutesUsedToday(familyId, settings.profileId, tz) : 0;
      return { allowed: false, reason: "bedtime", usedMinutes: used, limitMinutes: settings.dailyMinutes, bedtime: settings.bedtime };
    }
  }
  if (!settings.dailyMinutes) return { allowed: true, bedtime: settings.bedtime };
  const bonus = settings.bonusDay === today ? settings.bonusMinutes ?? 0 : 0;
  const limit = settings.dailyMinutes + bonus;
  const used = await minutesUsedToday(familyId, settings.profileId, tz);
  if (used >= limit) return { allowed: false, reason: "limit", usedMinutes: used, limitMinutes: limit, bedtime: settings.bedtime };
  return { allowed: true, remainingMinutes: limit - used, bedtime: settings.bedtime };
}

/** Kid taps "Ask for more time" → parent's phone. */
export async function askForMoreTime(familyId: string, profileId?: string) {
  const p = profileId ? await db.getProfile(profileId) : undefined;
  return pushToFamily(familyId, {
    title: `${p?.name ?? "Your kid"} is asking for more time`,
    body: "Tap to add 15 or 30 minutes for today, or say not today.",
    url: `/parent?more=${profileId ?? ""}`,
    tag: `more-time-${profileId ?? "kid"}`,
  });
}

export async function grantBonusMinutes(profileId: string, minutes: number, tz?: string) {
  const p = await db.getProfile(profileId);
  if (!p) return;
  const today = localDay(tz);
  const current = p.bonusDay === today ? p.bonusMinutes ?? 0 : 0;
  await db.upsertProfile({ ...p, bonusMinutes: Math.max(0, current + minutes), bonusDay: today });
}
