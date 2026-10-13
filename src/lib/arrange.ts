// How a kid's home screen is arranged: the "For <kid>" row and the channel shelf order.
// Pure functions over data the pages already have, so the TV and the dashboard miniature agree.
import type { FamilySettings, VideoFormat, VideoWithCard } from "@/lib/types";

export type Taste = {
  channelMinutes: Record<string, number>;
  formatMinutes: Partial<Record<VideoFormat, number>>;
  finishedIds: Set<string>;
  recentIds: Set<string>; // watched in the last few days
  total: number;
};

/** Build a taste profile from watch events (plays + their outcomes) and the cards of what was played. */
export function tasteFrom(
  events: { videoId: string; startedAt: string; outcome?: "skipped" | "finished" | "left"; endedAtSec?: number }[],
  byId: Map<string, VideoWithCard>,
  recentDays = 3,
): Taste {
  const t: Taste = { channelMinutes: {}, formatMinutes: {}, finishedIds: new Set(), recentIds: new Set(), total: 0 };
  const recentCut = Date.now() - recentDays * 86_400_000;
  for (const e of events) {
    const v = byId.get(e.videoId);
    if (!v) continue;
    if (e.outcome === "finished") t.finishedIds.add(v.id);
    if (e.outcome) continue;
    if (Date.parse(e.startedAt) >= recentCut) t.recentIds.add(v.id);
    const m = Math.max(1, Math.round((v.durationSeconds ?? 300) / 60));
    t.total += m;
    t.channelMinutes[v.channelId] = (t.channelMinutes[v.channelId] ?? 0) + m;
    if (v.card) t.formatMinutes[v.card.format] = (t.formatMinutes[v.card.format] ?? 0) + m;
  }
  return t;
}

const PACE_SCORE = { calm: -1, moderate: 0, frenetic: 1 } as const;

/** Score one playable video for this kid. Higher = earlier in "For <kid>". */
export function scoreFor(v: VideoWithCard, s: FamilySettings, taste: Taste): number {
  const c = v.card;
  let score = c ? c.rating / 5 : 0.3; // parent-friendliness baseline
  if (taste.total > 0) {
    score += 1.5 * ((taste.channelMinutes[v.channelId] ?? 0) / taste.total); // channels they actually watch
    if (c) score += 1.0 * ((taste.formatMinutes[c.format] ?? 0) / taste.total); // kinds they actually watch
  }
  if (taste.finishedIds.has(v.id)) score += 0.3; // things they finish are things they like
  if (taste.recentIds.has(v.id)) score -= 0.6; // but don't lead with yesterday's video
  // Interests from the profile, matched against title + synopsis.
  const hay = `${v.title} ${c?.synopsis ?? ""}`.toLowerCase();
  for (const kw of s.interests ?? []) if (kw && hay.includes(kw.toLowerCase())) score += 0.8;
  // Parent nudges.
  const b = s.boosts ?? {};
  if (c) {
    score += 0.4 * (b.formats?.[c.format] ?? 0);
    if (b.pace) score += 0.25 * b.pace * PACE_SCORE[c.pace]; // + wants livelier, − wants calmer
    if (b.learning) score += 0.15 * b.learning * (c.educationalValue - 2.5);
  }
  // Freshness, lightly.
  if (v.publishedAt) {
    const ageDays = (Date.now() - Date.parse(v.publishedAt)) / 86_400_000;
    if (ageDays < 30) score += 0.2;
  }
  return score;
}

/** The "For <kid>" row: top N playable videos, at most two per channel so one channel can't fill it. */
export function forKid(playable: VideoWithCard[], s: FamilySettings, taste: Taste, n = 8): VideoWithCard[] {
  const ranked = playable.map((v) => ({ v, score: scoreFor(v, s, taste) })).sort((a, b) => b.score - a.score);
  const out: VideoWithCard[] = [];
  const perChannel = new Map<string, number>();
  for (const { v } of ranked) {
    const k = perChannel.get(v.channelId) ?? 0;
    if (k >= 2) continue;
    perChannel.set(v.channelId, k + 1);
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

/** Channel shelves in the parent's order first; unlisted ones follow by how much there is to watch. */
export function orderShelves<T extends { id: string; videos: unknown[] }>(shelves: T[], order: string[] = []): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...shelves].sort((a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return b.videos.length - a.videos.length;
  });
}
