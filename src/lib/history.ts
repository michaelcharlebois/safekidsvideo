// Viewing history for Activity: what one child watched, day by day, from recorded watch events. Pure.
// Minutes use the same estimate as the viewing stats (a finished video counts its full length, otherwise
// ~60% of it, at least 2 minutes), and the page says so.
import type { Video } from "@/lib/types";

export type HistoryEvent = { videoId: string; profileId?: string; startedAt: string; completed: boolean; outcome?: "skipped" | "finished" | "left" };
export type HistoryItem = { video: Video; at: string; minutes: number; ended?: "finished" | "skipped" | "left" };
export type HistoryDay = { day: string; minutes: number; items: HistoryItem[] };

export const estimateMinutes = (completed: boolean, v?: Pick<Video, "durationSeconds">) => {
  const dur = (v?.durationSeconds ?? 300) / 60;
  return Math.round(completed ? dur : Math.min(dur, Math.max(2, dur * 0.6)));
};

/**
 * Plays for this child (and plays from screens that didn't record a child), newest day first and newest
 * play first within a day. An end marker (skipped / finished / left) is attached to the play it ended.
 * Plays of videos no longer in the catalogue are counted in `unknown`, not shown.
 */
export function historyByDay(events: HistoryEvent[], videoById: Map<string, Video>, dayOf: (iso: string) => string, profileId?: string): { days: HistoryDay[]; unattributed: number; unknown: number } {
  const mine = events.filter((e) => !profileId || e.profileId === profileId || !e.profileId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const plays: (HistoryItem & { e: HistoryEvent })[] = [];
  let unknown = 0;
  for (const e of mine) {
    if (e.outcome) {
      // Only the most recent play of that video can be the one that ended (never an older one).
      const p = [...plays].reverse().find((x) => x.e.videoId === e.videoId && x.e.profileId === e.profileId);
      if (p && (!p.ended || p.ended === e.outcome)) p.ended = e.outcome;
      continue;
    }
    const video = videoById.get(e.videoId);
    if (!video) { unknown++; continue; }
    plays.push({ e, video, at: e.startedAt, minutes: estimateMinutes(e.completed, video), ended: e.completed ? "finished" : undefined });
  }
  const byDay = new Map<string, HistoryItem[]>();
  for (const p of plays) {
    const d = dayOf(p.at);
    byDay.set(d, [...(byDay.get(d) ?? []), { video: p.video, at: p.at, minutes: p.minutes, ended: p.ended }]);
  }
  const days = [...byDay.entries()]
    .map(([day, items]) => ({ day, items: items.reverse(), minutes: items.reduce((a, i) => a + i.minutes, 0) }))
    .sort((a, b) => b.day.localeCompare(a.day));
  return { days, unattributed: mine.filter((e) => !e.outcome && !e.profileId).length, unknown };
}
