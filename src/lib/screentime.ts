import "server-only";
import { db } from "@/lib/db";
import { localDay, watchEventsSince, type WatchEvent } from "@/lib/checkin";
import { attributedTo, sessionSeconds, sessionsFrom } from "@/lib/sessions";
import { bedtimeNow, nightOf } from "@/lib/bedtime";
import { listExtensions } from "@/lib/bedtime-store";
import type { FamilySettings, Video } from "@/lib/types";

/* Screen-time limits: minutes per day + a "done for the day" time, per kid, with parent-granted bonus minutes. */

export type TimeState =
  | {
      allowed: true; remainingMinutes?: number; bedtime?: string;
      /** When videos stop tonight (ISO): the scheduled bedtime, or a later cutoff a parent authorized. */
      stopsAt?: string;
      /** Set when tonight has a bedtime extension (the cutoff, ISO). */
      extendedUntil?: string;
      night: string;
    }
  | {
      allowed: false; reason: "limit" | "bedtime"; usedMinutes: number; limitMinutes?: number; bedtime?: string;
      night: string;
      /** Bedtime: the daily minutes are also used up (a later bedtime alone wouldn't bring videos back). */
      limitReached?: boolean;
      /** Minutes of tonight's extension (0 if none), for whether a bedtime ask is still possible. */
      extensionMinutes: number;
      /** Bedtime: when videos come back stopped (the cutoff that applied tonight, ISO). */
      stoppedAt?: string;
      /** Daily limit: when bedtime starts tonight, if it hasn't yet (ISO). */
      stopsAt?: string;
    };

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

/**
 * Whether this child may watch right now, on the server. Bedtime (with tonight's extension, lib/bedtime.ts)
 * is checked first and is never lifted by extra minutes; then the daily minutes (plus today's bonus), which
 * an extension never adds to.
 */
export async function timeState(familyId: string, settings: FamilySettings, tz?: string, now = new Date()): Promise<TimeState> {
  const today = localDay(tz, now);
  const night = nightOf(now, tz);
  const exts = settings.bedtime && settings.profileId ? (await listExtensions(familyId, night)).filter((e) => e.profileId === settings.profileId) : [];
  const b = bedtimeNow(now, settings.bedtime, tz, exts);
  const extensionMinutes = b.extension?.extraMinutes ?? 0;
  const bonus = settings.bonusDay === today ? settings.bonusMinutes ?? 0 : 0;
  const limit = settings.dailyMinutes ? settings.dailyMinutes + bonus : undefined;
  const used = limit ? await minutesUsedToday(familyId, settings.profileId, tz) : 0;
  if (b.inBedtime) {
    return { allowed: false, reason: "bedtime", usedMinutes: used, limitMinutes: limit, bedtime: settings.bedtime, night, extensionMinutes,
      limitReached: limit != null && used >= limit, stoppedAt: b.stopsAt?.toISOString() };
  }
  const stopsAt = b.stopsAt && b.end && now < b.end ? b.stopsAt.toISOString() : undefined;
  if (limit != null && used >= limit) return { allowed: false, reason: "limit", usedMinutes: used, limitMinutes: limit, bedtime: settings.bedtime, night, extensionMinutes, stopsAt };
  return { allowed: true, remainingMinutes: limit != null ? limit - used : undefined, bedtime: settings.bedtime, night, stopsAt, extendedUntil: b.extension ? stopsAt : undefined };
}

export async function grantBonusMinutes(profileId: string, minutes: number, tz?: string) {
  const p = await db.getProfile(profileId);
  if (!p) return;
  const today = localDay(tz);
  const current = p.bonusDay === today ? p.bonusMinutes ?? 0 : 0;
  await db.upsertProfile({ ...p, bonusMinutes: Math.max(0, current + minutes), bonusDay: today });
}
