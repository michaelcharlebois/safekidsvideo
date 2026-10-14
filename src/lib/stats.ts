import "server-only";
import { localDay, type WatchEvent } from "@/lib/checkin";
import { attributedTo, sessionSeconds, sessionsFrom } from "@/lib/sessions";
import { FORMAT_LABELS, type Channel, type ContentCard, type Video, type VideoFormat } from "@/lib/types";

/*
 * Viewing stats for one child over a window, from viewing SESSIONS (lib/sessions.ts) — the same
 * interpretation as Home's "today", daily limits and check-ins. One session = one play. Seconds per
 * session: finished → full length; skipped / left → reported position; no end recorded → an estimate.
 * Unattributed rows count for the child only when the family has one child.
 */

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
  left: number;
  unknown: number; // sessions with no recorded end (estimated)
  starts: number;
  /** Plays in the window that couldn't be attributed to any child (several children, no child recorded). */
  unattributed: number;
};

function localHour(tz: string | undefined, d: Date): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}

/** The numbers from data already in hand (pure apart from the clock passed in). */
export function computeKidStats(input: {
  events: WatchEvent[]; videos: Video[]; cards: ContentCard[]; channels: Channel[]; profileId: string; childCount: number; days: number; tz?: string; now: number;
}): KidStats {
  const { profileId, childCount, days, tz, now, channels } = input;
  const since = now - days * 86_400_000;
  const prevSince = now - 2 * days * 86_400_000;
  const videoById = new Map(input.videos.map((v) => [v.id, v]));
  const cardById = new Map(input.cards.filter((c) => c.reviewer.model !== "sample").map((c) => [c.videoId, c]));
  const channelTitle = (id: string) => channels.find((c) => c.id === id)?.title ?? id;
  const sessions = sessionsFrom(input.events, (id) => videoById.get(id)?.durationSeconds);
  const inRange = (from: number, to = Infinity) => (s: { startedAt: string }) => { const t = Date.parse(s.startedAt); return t >= from && t < to; };
  const mine = sessions.filter((s) => attributedTo(s.profileId, profileId, childCount));
  const cur = mine.filter(inRange(since));
  const prev = mine.filter(inRange(prevSince, since));
  const secOf = (s: (typeof sessions)[number]) => sessionSeconds(s, videoById.get(s.videoId)?.durationSeconds);

  const st: KidStats = {
    days, minutes: 0, plays: cur.length, activeDays: 0, prevMinutes: Math.round(prev.reduce((a, s) => a + secOf(s), 0) / 60),
    byDay: [], byChannel: [], byFormat: [], byHour: Array(24).fill(0), pace: { calm: 0, moderate: 0, frenetic: 0 }, topVideos: [], reviewedShare: 0,
    skips: cur.filter((s) => s.outcome === "skipped").length, finishes: cur.filter((s) => s.outcome === "finished").length,
    left: cur.filter((s) => s.outcome === "left").length, unknown: cur.filter((s) => s.outcome === "unknown").length, starts: cur.length,
    unattributed: sessions.filter(inRange(since)).filter((s) => !s.profileId && childCount > 1).length,
  };
  const daySec = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) daySec.set(localDay(tz, new Date(now - i * 86_400_000)), 0);
  const hourSec = Array(24).fill(0);
  const chan = new Map<string, { sec: number; plays: number }>();
  const fmt = new Map<VideoFormat, number>();
  const vid = new Map<string, { plays: number; sec: number }>();
  const pace = { calm: 0, moderate: 0, frenetic: 0 };
  let total = 0, reviewed = 0;
  for (const s of cur) {
    const v = videoById.get(s.videoId);
    const sec = secOf(s);
    total += sec;
    const d = localDay(tz, new Date(s.startedAt));
    if (daySec.has(d)) daySec.set(d, (daySec.get(d) ?? 0) + sec);
    hourSec[localHour(tz, new Date(s.startedAt))] += sec;
    if (v) {
      const c = chan.get(v.channelId) ?? { sec: 0, plays: 0 };
      c.sec += sec; c.plays++; chan.set(v.channelId, c);
      const t = vid.get(v.id) ?? { plays: 0, sec: 0 };
      t.plays++; t.sec += sec; vid.set(v.id, t);
    }
    const card = cardById.get(s.videoId);
    if (card) { reviewed += sec; fmt.set(card.format, (fmt.get(card.format) ?? 0) + sec); pace[card.pace] += sec; }
  }
  const m = (sec: number) => Math.round(sec / 60);
  st.minutes = m(total);
  st.byDay = [...daySec.entries()].map(([day, sec]) => ({ day, minutes: m(sec) }));
  st.activeDays = [...daySec.values()].filter((x) => x > 0).length;
  st.byHour = hourSec.map(m);
  st.pace = { calm: m(pace.calm), moderate: m(pace.moderate), frenetic: m(pace.frenetic) };
  st.byChannel = [...chan.entries()].map(([id, x]) => ({ id, title: channelTitle(id), minutes: m(x.sec), plays: x.plays })).sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  st.byFormat = [...fmt.entries()].map(([format, sec]) => ({ format, label: FORMAT_LABELS[format], minutes: m(sec) })).sort((a, b) => b.minutes - a.minutes);
  st.topVideos = [...vid.entries()].map(([id, x]) => ({ video: videoById.get(id)!, plays: x.plays, minutes: m(x.sec) })).filter((x) => x.video).sort((a, b) => b.plays - a.plays || b.minutes - a.minutes).slice(0, 5);
  st.reviewedShare = total ? reviewed / total : 0;
  return st;
}

export type { ContentCard };
