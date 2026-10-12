import "server-only";
import { db } from "@/lib/db";
import type { ConcernTag, FamilySettings, VideoWithCard } from "@/lib/types";

/** Every known video, joined with channel, AI card, confirmation tallies, and whitelist status. */
export async function getLibrary(familyId: string): Promise<VideoWithCard[]> {
  const [videos, channels, whitelist] = await Promise.all([db.listVideos(), db.listChannels(), db.listWhitelist(familyId)]);
  const ids = videos.map((v) => v.id);
  const [cards, confirmations] = await Promise.all([db.listCards(ids), db.listConfirmations(ids)]);

  const channelById = new Map(channels.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  const wlVideos = new Set(whitelist.filter((w) => w.kind === "video").map((w) => w.targetId));
  const wlChannels = new Set(whitelist.filter((w) => w.kind === "channel").map((w) => w.targetId));

  const tallies = new Map<string, VideoWithCard["confirmations"]>();
  for (const c of confirmations) {
    const t = tallies.get(c.videoId) ?? { agree: 0, flag: 0, flaggedTags: {} };
    if (c.verdict === "agree") t.agree++;
    else {
      t.flag++;
      for (const tag of c.tags ?? []) t.flaggedTags[tag] = (t.flaggedTags[tag] ?? 0) + 1;
    }
    tallies.set(c.videoId, t);
  }

  return videos.map((v) => ({
    ...v,
    channel: channelById.get(v.channelId),
    card: cardById.get(v.id),
    confirmations: tallies.get(v.id) ?? { agree: 0, flag: 0, flaggedTags: {} },
    whitelisted: wlVideos.has(v.id) || wlChannels.has(v.channelId),
  }));
}

/**
 * Does this video trip the family's blocked tags?
 * A tag counts if the AI found it at intensity >= 2, OR enough parents flagged it.
 */
export function blockedReasons(v: VideoWithCard, s: FamilySettings): ConcernTag[] {
  const out: ConcernTag[] = [];
  for (const tag of s.blockedTags) {
    const ai = v.card?.concerns.find((c) => c.tag === tag);
    const aiHit = !!ai && ai.present && ai.intensity >= 2;
    const parentHit = (v.confirmations.flaggedTags[tag] ?? 0) >= s.flagThreshold;
    if (aiHit || parentHit) out.push(tag);
  }
  return out;
}

/** What the kid actually sees: whitelisted AND not blocked by the family's filters. */
export async function getKidFeed(familyId: string) {
  const [lib, settings] = await Promise.all([getLibrary(familyId), db.getSettings(familyId)]);
  return lib.filter((v) => v.whitelisted && blockedReasons(v, settings).length === 0);
}
