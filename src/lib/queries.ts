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

/**
 * Every child's library from ONE read of the shared data (the inbox and the Review badge look at all
 * children at once). Each entry is scoped to its child exactly like getLibrary(familyId, profileId).
 */
export async function getLibraries(familyId: string) {
  const [videos, channels, whitelist, profiles] = await Promise.all([db.listVideos(), db.listChannels(), db.listWhitelist(familyId), db.listProfiles(familyId)]);
  const ids = videos.map((v) => v.id);
  const [cards, confirmations] = await Promise.all([db.listCards(ids), db.listConfirmations(ids)]);
  return Promise.all(profiles.map(async (profile) => ({
    profile,
    settings: await db.getSettings(familyId, profile.id),
    lib: buildLibrary({ videos, channels, cards, confirmations, whitelist, profileId: profile.id }),
  })));
}

/**
 * Like getLibraries, but only for the named videos (the handful a Review page shows). Same flags and gate
 * decisions per child, without reading the whole catalogue.
 */
export async function getLibrariesFor(familyId: string, videoIds: string[]) {
  const ids = [...new Set(videoIds)];
  const [videos, channels, whitelist, profiles, cards, confirmations] = await Promise.all([
    Promise.all(ids.map((id) => db.getVideo(id))).then((vs) => vs.filter((v): v is NonNullable<typeof v> => !!v)),
    db.listChannels(), db.listWhitelist(familyId), db.listProfiles(familyId),
    ids.length ? db.listCards(ids) : Promise.resolve([]), ids.length ? db.listConfirmations(ids) : Promise.resolve([]),
  ]);
  return Promise.all(profiles.map(async (profile) => ({
    profile,
    settings: await db.getSettings(familyId, profile.id),
    lib: buildLibrary({ videos, channels, cards, confirmations, whitelist, profileId: profile.id }),
  })));
}

/** One video as each child in the family sees it: flags + the gate's decision, per child. */
export async function videoForChildren(familyId: string, videoId: string) {
  const [video, channels, card, confirmations, whitelist, profiles] = await Promise.all([
    db.getVideo(videoId), db.listChannels(), db.getCard(videoId), db.listConfirmations([videoId]), db.listWhitelist(familyId), db.listProfiles(familyId),
  ]);
  if (!video) return null;
  const base = { videos: [video], channels, cards: card ? [card] : [], confirmations, whitelist };
  const family = buildLibrary({ ...base })[0];
  const familyBlocked = whitelist.some((w) => w.kind === "block" && w.targetId === videoId && w.profileId == null);
  // What each child would get if the family-wide block were lifted (to preview "Unblock for everyone").
  const unblocked = { ...base, whitelist: whitelist.filter((w) => !(w.kind === "block" && w.targetId === videoId && w.profileId == null)) };
  const perChild = await Promise.all(profiles.map(async (p) => {
    const settings = await db.getSettings(familyId, p.id);
    const v = buildLibrary({ ...base, profileId: p.id })[0];
    const ifUnblocked = familyBlocked ? authorize(buildLibrary({ ...unblocked, profileId: p.id })[0], settings) : null;
    return { profile: p, settings, v, decision: authorize(v, settings), ifUnblocked, childBlocked: v.blockedByParent && !familyBlocked };
  }));
  const addedDirectly = whitelist.some((w) => w.kind === "video" && w.targetId === videoId && w.profileId == null);
  const channelApproved = whitelist.some((w) => w.kind === "channel" && w.targetId === video.channelId && w.profileId == null);
  return { video: family, perChild, addedDirectly, channelApproved, familyBlocked };
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
