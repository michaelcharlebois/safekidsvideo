import "server-only";
import { db } from "@/lib/db";
import type { FamilySettings, VideoWithCard } from "@/lib/types";
import { authorize, blockedReasons, buildLibrary, canPlay, needsDecision, playableFor, screen } from "@/lib/gate";
export { authorize, blockedReasons, canPlay, needsDecision, playableFor, screen };

/**
 * Every known video, joined with channel, AI card, crowd tallies, and the grants that apply to
 * `profileId`. Kid surfaces MUST pass the child; with no child you get the family-wide view, which
 * authorize() refuses for playback.
 */
export async function getLibrary(familyId: string, profileId?: string): Promise<VideoWithCard[]> {
  const [videos, channels, whitelist] = await Promise.all([db.listVideos(), db.listChannels(), db.listWhitelist(familyId)]);
  const ids = videos.map((v) => v.id);
  const [cards, confirmations] = await Promise.all([db.listCards(ids), db.listConfirmations(ids)]);
  return buildLibrary({ videos, channels, cards, confirmations, whitelist, profileId });
}

/** One video as each child in the family sees it: flags + the gate's decision, per child. */
export async function videoForChildren(familyId: string, videoId: string) {
  const [video, channels, card, confirmations, whitelist, profiles] = await Promise.all([
    db.getVideo(videoId), db.listChannels(), db.getCard(videoId), db.listConfirmations([videoId]), db.listWhitelist(familyId), db.listProfiles(familyId),
  ]);
  if (!video) return null;
  const base = { videos: [video], channels, cards: card ? [card] : [], confirmations, whitelist };
  const family = buildLibrary({ ...base })[0];
  const perChild = await Promise.all(profiles.map(async (p) => {
    const settings = await db.getSettings(familyId, p.id);
    const v = buildLibrary({ ...base, profileId: p.id })[0];
    return { profile: p, settings, v, decision: authorize(v, settings) };
  }));
  const addedDirectly = whitelist.some((w) => w.kind === "video" && w.targetId === videoId && w.profileId == null);
  const channelApproved = whitelist.some((w) => w.kind === "channel" && w.targetId === video.channelId && w.profileId == null);
  return { video: family, perChild, addedDirectly, channelApproved };
}

/** Settings for a specific child, or null — never "the first profile" — so kid surfaces fail closed. */
export async function childSettings(familyId: string, profileId: string | undefined): Promise<FamilySettings | null> {
  if (!profileId) return null;
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== familyId) return null;
  return db.getSettings(familyId, profileId);
}

/** What the kid sees: what plays now, and what's in their library but held back (askable). */
export async function getKidScreen(familyId: string, profileId: string) {
  const [lib, settings] = await Promise.all([getLibrary(familyId, profileId), childSettings(familyId, profileId)]);
  if (!settings) return { playable: [] as VideoWithCard[], askable: [] as VideoWithCard[], settings: null };
  const playable: VideoWithCard[] = [];
  const askable: VideoWithCard[] = [];
  for (const v of lib) {
    if (canPlay(v, settings)) playable.push(v);
    else if (v.inLibrary && !v.blockedByParent) askable.push(v);
  }
  return { playable, askable, settings };
}
