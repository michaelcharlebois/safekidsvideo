// Viewing history for Activity: what one child watched, day by day, as viewing sessions (lib/sessions.ts),
// so a play here is the same play the stats, Home's "today" and the daily limit count. Pure.
import { attributedTo, sessionSeconds, sessionsFrom, type RawWatchEvent, type SessionOutcome } from "@/lib/sessions";
import type { Video } from "@/lib/types";

export type HistoryEvent = RawWatchEvent;
export type HistoryItem = { video: Video; at: string; minutes: number; ended?: Exclude<SessionOutcome, "unknown"> };
export type HistoryDay = { day: string; minutes: number; items: HistoryItem[] };

/**
 * This child's plays, newest day first and newest play first within a day. Unattributed plays are this
 * child's only in a one-child family; otherwise they're counted in `unattributed` and not shown. Plays of
 * videos no longer in the catalogue are counted in `unknown`, not shown.
 */
export function historyByDay(events: HistoryEvent[], videoById: Map<string, Video>, dayOf: (iso: string) => string, profileId: string, childCount: number): { days: HistoryDay[]; unattributed: number; unknown: number } {
  const sessions = sessionsFrom(events, (id) => videoById.get(id)?.durationSeconds);
  const mine = sessions.filter((s) => attributedTo(s.profileId, profileId, childCount));
  let unknown = 0;
  const byDay = new Map<string, { sec: number; items: HistoryItem[] }>();
  for (const s of mine) {
    const video = videoById.get(s.videoId);
    if (!video) { unknown++; continue; }
    const sec = sessionSeconds(s, video.durationSeconds);
    const d = dayOf(s.startedAt);
    const day = byDay.get(d) ?? { sec: 0, items: [] };
    day.sec += sec;
    day.items.push({ video, at: s.startedAt, minutes: Math.round(sec / 60), ended: s.outcome === "unknown" ? undefined : s.outcome });
    byDay.set(d, day);
  }
  const days = [...byDay.entries()]
    .map(([day, x]) => ({ day, minutes: Math.round(x.sec / 60), items: x.items.reverse() }))
    .sort((a, b) => b.day.localeCompare(a.day));
  return { days, unattributed: sessions.filter((s) => !s.profileId && childCount > 1).length, unknown };
}
