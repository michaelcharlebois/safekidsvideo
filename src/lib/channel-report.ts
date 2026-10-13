// A channel's report card, computed from every reviewed video we have for it. Pure; used by the
// parent page and the public /c/ page.
import { db } from "@/lib/db/resolve";
import { CONCERN_TAGS, type Channel, type ConcernTag, type ContentCard, type Video, type VideoFormat } from "@/lib/types";
import { isFound } from "@/lib/gate";

export type ChannelReport = {
  channel: Channel;
  videos: Video[];
  cards: Map<string, ContentCard>;
  reviewed: number;
  avgRating?: number;
  avgEducational?: number;
  ageFit?: { min: number; max: number }; // median min, median max
  pace: Record<ContentCard["pace"], number>;
  formats: Partial<Record<VideoFormat, number>>;
  /** per tag: how many reviewed videos have it at all, and at moderate+ intensity */
  tags: Partial<Record<ConcernTag, { any: number; strong: number }>>;
  bestPicks: Video[];
  watchOut?: { video: Video; why: string };
  avgMinutes?: number;
};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : undefined; };

export async function channelReport(channelId: string): Promise<ChannelReport | null> {
  const channel = await db.getChannel(channelId);
  if (!channel) return null;
  const videos = (await db.listVideos({ channelId })).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const cardList = (await db.listCards(videos.map((v) => v.id))).filter((c) => c.reviewer.model !== "sample");
  const cards = new Map(cardList.map((c) => [c.videoId, c]));
  const r: ChannelReport = { channel, videos, cards, reviewed: cardList.length, pace: { calm: 0, moderate: 0, frenetic: 0 }, formats: {}, tags: {}, bestPicks: [] };
  if (!cardList.length) return r;
  const avg = (f: (c: ContentCard) => number) => Math.round((cardList.reduce((a, c) => a + f(c), 0) / cardList.length) * 10) / 10;
  r.avgRating = avg((c) => c.rating);
  r.avgEducational = avg((c) => c.educationalValue);
  r.ageFit = { min: median(cardList.map((c) => c.ageFit.min))!, max: median(cardList.map((c) => c.ageFit.max))! };
  for (const c of cardList) {
    r.pace[c.pace]++;
    r.formats[c.format] = (r.formats[c.format] ?? 0) + 1;
    for (const f of c.concerns) {
      if (!isFound(f)) continue;
      const t = (r.tags[f.tag] ??= { any: 0, strong: 0 });
      t.any++;
      if (f.intensity >= 2) t.strong++;
    }
  }
  const byId = new Map(videos.map((v) => [v.id, v]));
  r.bestPicks = [...cardList].sort((a, b) => b.rating - a.rating || b.confidence - a.confidence).slice(0, 3).map((c) => byId.get(c.videoId)!).filter(Boolean);
  const worst = [...cardList].map((c) => ({ c, worst: Math.max(0, ...c.concerns.map((f) => (isFound(f) ? f.intensity : 0))) }))
    .sort((a, b) => b.worst - a.worst || a.c.rating - b.c.rating)[0];
  if (worst && worst.worst >= 2) {
    const f = worst.c.concerns.find((x) => isFound(x) && x.intensity === worst.worst)!;
    r.watchOut = { video: byId.get(worst.c.videoId)!, why: `${CONCERN_TAGS.includes(f.tag) ? f.tag.replace(/_/g, " ") : f.tag} at ${f.timestamp ?? "—"}${f.evidence ? ` — ${f.evidence}` : ""}` };
  }
  const durs = videos.map((v) => v.durationSeconds).filter((d): d is number => !!d);
  if (durs.length) r.avgMinutes = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length / 60);
  return r;
}

/** Public slug: the handle without "@" (falls back to the UC id). */
export const channelSlug = (c: Channel) => (c.handle ?? c.id).replace(/^@/, "");
export async function channelBySlug(slug: string): Promise<Channel | undefined> {
  const all = await db.listChannels();
  const s = slug.toLowerCase();
  return all.find((c) => c.id === slug) ?? all.find((c) => (c.handle ?? "").replace(/^@/, "").toLowerCase() === s);
}
