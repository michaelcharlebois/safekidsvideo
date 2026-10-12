import "server-only";
import { db } from "@/lib/db";
import { CONCERN_LABELS, FORMAT_LABELS, type FamilySettings, type VideoWithCard } from "@/lib/types";

/** Every known video, joined with channel, AI card, confirmation tallies, and whitelist status. */
export async function getLibrary(familyId: string): Promise<VideoWithCard[]> {
  const [videos, channels, whitelist] = await Promise.all([db.listVideos(), db.listChannels(), db.listWhitelist(familyId)]);
  const ids = videos.map((v) => v.id);
  const [cards, confirmations] = await Promise.all([db.listCards(ids), db.listConfirmations(ids)]);

  const channelById = new Map(channels.map((c) => [c.id, c]));
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  const wlVideos = new Set(whitelist.filter((w) => w.kind === "video").map((w) => w.targetId));
  const wlChannels = new Set(whitelist.filter((w) => w.kind === "channel").map((w) => w.targetId));
  const overrides = new Set(whitelist.filter((w) => w.kind === "override").map((w) => w.targetId));
  const autos = new Set(whitelist.filter((w) => w.kind === "auto").map((w) => w.targetId));

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
    whitelisted: wlVideos.has(v.id) || wlChannels.has(v.channelId) || overrides.has(v.id) || autos.has(v.id),
    overridden: overrides.has(v.id),
    autoApproved: autos.has(v.id),
  }));
}

/**
 * Does this video trip the family's blocked tags?
 * A tag counts if the AI found it at intensity >= 2, OR enough parents flagged it.
 */
export function blockedReasons(v: VideoWithCard, s: FamilySettings): string[] {
  const out: string[] = [];
  if (v.overridden) return out;
  if (!v.card && s.hideUnreviewed) return ["Not reviewed yet"];
  if (v.card?.format && s.blockedFormats.includes(v.card.format)) out.push(FORMAT_LABELS[v.card.format]);
  for (const tag of s.blockedTags) {
    const ai = v.card?.concerns.find((c) => c.tag === tag);
    const aiHit = !!ai && ai.present && ai.intensity >= 2;
    const parentHit = (v.confirmations.flaggedTags[tag] ?? 0) >= s.flagThreshold;
    if (aiHit || parentHit) out.push(CONCERN_LABELS[tag]);
  }
  return out;
}

/** What the kid actually sees: whitelisted AND not blocked by the family's filters. */
export async function getKidFeed(familyId: string) {
  const [lib, settings] = await Promise.all([getLibrary(familyId), db.getSettings(familyId)]);
  return lib.filter((v) => v.whitelisted && blockedReasons(v, settings).length === 0);
}

/**
 * Kid screen, both rows: what plays now, and what the kid may *ask* for —
 * videos from approved channels that a filter or a missing review is hiding.
 * Nothing outside approved channels/videos is ever shown.
 */
export async function getKidScreen(familyId: string) {
  const [lib, settings] = await Promise.all([getLibrary(familyId), db.getSettings(familyId)]);
  const playable: VideoWithCard[] = [];
  const askable: VideoWithCard[] = [];
  for (const v of lib) {
    if (!v.whitelisted) continue;
    if (blockedReasons(v, settings).length === 0) playable.push(v);
    else askable.push(v);
  }
  return { playable, askable };
}

/**
 * Would the AI card alone justify playing this without a parent? Used in open mode.
 * Requires: a real card, no blocked reasons, decent confidence, and an age fit that includes the kid.
 */
export function aiPasses(v: VideoWithCard, s: FamilySettings): { pass: boolean; reasons: string[] } {
  const c = v.card;
  if (!c || c.reviewer.model === "sample") return { pass: false, reasons: ["Not reviewed yet"] };
  const reasons = blockedReasons(v, s);
  if (c.confidence < 0.7) reasons.push("AI wasn't confident");
  const age = s.kidAge ?? 6;
  if (c.ageFit.min > age) reasons.push(`Rated for ages ${c.ageFit.min}+`);
  return { pass: reasons.length === 0, reasons };
}

/** The single play gate for kid mode. */
export function canPlay(v: VideoWithCard, s: FamilySettings): boolean {
  if (v.whitelisted) return blockedReasons(v, s).length === 0;
  return s.mode === "open" && aiPasses(v, s).pass;
}
