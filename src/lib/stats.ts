import "server-only";
import { db } from "@/lib/db";
import { localDay, watchEventsSince, type WatchEvent } from "@/lib/checkin";
import { FORMAT_LABELS, type ContentCard, type Video, type VideoFormat } from "@/lib/types";

/* Viewing stats for one kid over a window. Minutes are estimated: completed → full length, else ~60%. */

export type KidStats = {
  days: number;
  minutes: number;
  plays: number;
  activeDays: number;
  prevMinutes: number; // same-length window before this one
  byDay: { day: string; minutes: number }[];
  byChannel: { id: string; title: string; minutes: number; plays: number }[];
  byFormat: { format: VideoFormat; label: string; minutes: number }[];
  byHour: number[]; // 24 buckets, minutes
  pace: { calm: number; moderate: number; frenetic: number }; // minutes
  topVideos: { video: Video; plays: number; minutes: number }[];
  reviewedShare: number; // 0–1 of minutes on videos with a card
  skips: number;
  finishes: number;
  starts: number;
};

const minutesOf = (e: WatchEvent, v?: Video) => {
  const dur = (v?.durationSeconds ?? 300) / 60;
  return Math.round(e.completed ? dur : Math.min(dur, Math.max(2, dur * 0.6)));
};

function localHour(tz: string | undefined, d: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}

export async function kidStats(familyId: string, profileId: string | undefined, days: number, tz?: string): Promise<KidStats> {
  const now = Date.now();
  const since = new Date(now - days * 86_400_000);
  const prevSince = new Date(now - 2 * days * 86_400_000);
  const all = (await watchEventsSince(familyId, prevSince.toISOString())).filter((e) => !profileId || e.profileId === profileId || !e.profileId);
  const inWindow = all.filter((e) => Date.parse(e.startedAt) >= since.getTime());
  const cur = inWindow.filter((e) => !e.outcome); // plays
  const ends = inWindow.filter((e) => e.outcome);  // how plays ended
  const prev = all.filter((e) => Date.parse(e.startedAt) < since.getTime() && !e.outcome);

  const ids = [...new Set(all.map((e) => e.videoId))];
  const [videos, cards, channels] = await Promise.all([Promise.all(ids.map((id) => db.getVideo(id))), db.listCards(ids), db.listChannels()]);
  const videoById = new Map(videos.filter(Boolean).map((v) => [v!.id, v!]));
  const cardById = new Map(cards.filter((c) => c.reviewer.model !== "sample").map((c) => [c.videoId, c]));
  const channelTitle = (id: string) => channels.find((c) => c.id === id)?.title ?? id;

  const s: KidStats = {
    days, minutes: 0, plays: cur.length, activeDays: 0, prevMinutes: prev.reduce((a, e) => a + minutesOf(e, videoById.get(e.videoId)), 0),
    byDay: [], byChannel: [], byFormat: [], byHour: Array(24).fill(0), pace: { calm: 0, moderate: 0, frenetic: 0 }, topVideos: [], reviewedShare: 0,
    skips: ends.filter((e) => e.outcome === "skipped").length, finishes: ends.filter((e) => e.outcome === "finished").length, starts: cur.length,
  };
  const dayMap = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) dayMap.set(localDay(tz, new Date(now - i * 86_400_000)), 0);
  const chan = new Map<string, { minutes: number; plays: number }>();
  const fmt = new Map<VideoFormat, number>();
  const vid = new Map<string, { plays: number; minutes: number }>();
  let reviewedMinutes = 0;
  for (const e of cur) {
    const v = videoById.get(e.videoId);
    const m = minutesOf(e, v);
    s.minutes += m;
    const d = localDay(tz, new Date(e.startedAt));
    if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) ?? 0) + m);
    s.byHour[localHour(tz, new Date(e.startedAt))] += m;
    if (v) {
      const c = chan.get(v.channelId) ?? { minutes: 0, plays: 0 };
      c.minutes += m; c.plays++; chan.set(v.channelId, c);
      const t = vid.get(v.id) ?? { plays: 0, minutes: 0 };
      t.plays++; t.minutes += m; vid.set(v.id, t);
    }
    const card = cardById.get(e.videoId);
    if (card) {
      reviewedMinutes += m;
      fmt.set(card.format, (fmt.get(card.format) ?? 0) + m);
      s.pace[card.pace] += m;
    }
  }
  s.byDay = [...dayMap.entries()].map(([day, minutes]) => ({ day, minutes }));
  s.activeDays = s.byDay.filter((d) => d.minutes > 0).length;
  s.byChannel = [...chan.entries()].map(([id, x]) => ({ id, title: channelTitle(id), ...x })).sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  s.byFormat = [...fmt.entries()].map(([format, minutes]) => ({ format, label: FORMAT_LABELS[format], minutes })).sort((a, b) => b.minutes - a.minutes);
  s.topVideos = [...vid.entries()].map(([id, x]) => ({ video: videoById.get(id)!, ...x })).filter((x) => x.video).sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, 5);
  s.reviewedShare = s.minutes ? reviewedMinutes / s.minutes : 0;
  return s;
}

export type { ContentCard };
