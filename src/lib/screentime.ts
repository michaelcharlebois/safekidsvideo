import "server-only";
import { db } from "@/lib/db";
import { localDay, watchEventsSince, type WatchEvent } from "@/lib/checkin";
import { attributedTo, sessionSeconds, sessionsFrom } from "@/lib/sessions";
import type { FamilySettings, Video } from "@/lib/types";

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

/**
 * Minutes this child has watched today, from viewing sessions (lib/sessions.ts) — the same count Activity
 * and Home show. Unattributed rows count only in a one-child family. Without a child, nothing is counted.
 */
export async function minutesUsedToday(familyId: string, profileId: string | undefined, tz?: string): Promise<number> {
  if (!profileId) return 0;
  const day = localDay(tz);
  const [raw, profiles] = await Promise.all([watchEventsSince(familyId, new Date(Date.now() - 30 * 3600 * 1000).toISOString()), db.listProfiles(familyId)]);
  // Sessions that started today (a session is counted on the day it started).
  const events = raw.filter((e) => attributedTo(e.profileId, profileId, profiles.length));
  if (!events.length) return 0;
  const ids = [...new Set(events.map((e) => e.videoId))];
  const videos = await Promise.all(ids.map((id) => db.getVideo(id)));
  const videoById = new Map(videos.filter(Boolean).map((v) => [v!.id, v!]));
  return usedMinutesOn(events, videoById, (iso) => localDay(tz, new Date(iso)), day);
}

/** Pure: minutes of sessions that started on `day`. */
export function usedMinutesOn(events: WatchEvent[], videoById: Map<string, Video>, dayOf: (iso: string) => string, day: string): number {
  const sec = sessionsFrom(events, (id) => videoById.get(id)?.durationSeconds)
    .filter((s) => dayOf(s.startedAt) === day)
    .reduce((a, s) => a + sessionSeconds(s, videoById.get(s.videoId)?.durationSeconds), 0);
  return Math.round(sec / 60);
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

export async function grantBonusMinutes(profileId: string, minutes: number, tz?: string) {
  const p = await db.getProfile(profileId);
  if (!p) return;
  const today = localDay(tz);
  const current = p.bonusDay === today ? p.bonusMinutes ?? 0 : 0;
  await db.upsertProfile({ ...p, bonusMinutes: Math.max(0, current + minutes), bonusDay: today });
}
