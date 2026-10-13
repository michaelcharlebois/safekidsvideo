// Every write that changes what a child may watch goes through here. Each one names the child,
// checks the child belongs to the family, and never widens access for anyone else.
// Takes the store as a parameter so tests can run it against a temporary local database.
import type { Store } from "@/lib/db/store";
import type { LegacyGrant, Profile } from "@/lib/types";

export class GrantError extends Error {}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function childOf(store: Store, familyId: string, profileId: string | null | undefined): Promise<Profile> {
  if (!profileId) throw new GrantError("Choose which child this is for");
  const p = await store.getProfile(profileId);
  if (!p || p.familyId !== familyId) throw new GrantError("That child isn't in this family");
  return p;
}

function checkVideoId(videoId: string) {
  if (!VIDEO_ID.test(videoId)) throw new GrantError("Not a video");
}

/** Clear this child's earlier decisions on a video (other children and family-wide rows untouched). */
async function clearChildDecisions(store: Store, familyId: string, profileId: string, videoId: string) {
  for (const k of ["override", "block", "dismissed"] as const) await store.removeFromWhitelist(familyId, k, videoId, profileId);
}

/** "Allow for <child>": the explicit approval. Plays for that child even if unreviewed or filtered. */
export async function allowForChild(store: Store, familyId: string, profileId: string, videoId: string) {
  checkVideoId(videoId);
  await childOf(store, familyId, profileId);
  await clearChildDecisions(store, familyId, profileId, videoId);
  await store.addToWhitelist({ familyId, profileId, kind: "override", targetId: videoId });
}

/** Review-queue decisions, for one child. */
export async function decideForChild(store: Store, familyId: string, profileId: string, videoId: string, decision: "allow" | "hide" | "never" | "undo") {
  checkVideoId(videoId);
  await childOf(store, familyId, profileId);
  await clearChildDecisions(store, familyId, profileId, videoId);
  if (decision === "allow") await store.addToWhitelist({ familyId, profileId, kind: "override", targetId: videoId });
  if (decision === "never") await store.addToWhitelist({ familyId, profileId, kind: "block", targetId: videoId });
  if (decision === "hide") await store.addToWhitelist({ familyId, profileId, kind: "dismissed", targetId: videoId });
}

/** A child's open-mode check passed: a record for that child only. Grants nothing outside Open mode. */
export async function recordOpenClearance(store: Store, familyId: string, profileId: string, videoId: string) {
  checkVideoId(videoId);
  await childOf(store, familyId, profileId);
  await store.addToWhitelist({ familyId, profileId, kind: "auto", targetId: videoId });
}

/** "Add & review": the video becomes a family content source. It still needs a review and each child's rules. */
export async function addVideoToLibrary(store: Store, familyId: string, videoId: string) {
  checkVideoId(videoId);
  await store.addToWhitelist({ familyId, profileId: null, kind: "video", targetId: videoId });
}

/**
 * Approving a kid's request allows it for the child who asked. Legacy requests with no child need the
 * parent to choose (`chosenProfileId`); we never fall back to "everyone".
 */
export async function approveRequest(store: Store, familyId: string, request: { videoId: string; profileId?: string | null }, chosenProfileId?: string | null) {
  const pid = request.profileId ?? chosenProfileId;
  if (!pid) throw new GrantError("This request doesn't say which child asked — choose one");
  await allowForChild(store, familyId, pid, request.videoId);
  return pid;
}

/** A parent re-assigns a pre-0018 approval to one child, or dismisses it. */
export async function resolveLegacy(store: Store, familyId: string, legacyId: string, action: { allowFor: string } | "dismiss"): Promise<LegacyGrant | undefined> {
  if (action === "dismiss") return store.resolveLegacyGrant(familyId, legacyId, "dismissed");
  const open = await store.listLegacyGrants(familyId);
  const g = open.find((x) => x.id === legacyId);
  if (!g) throw new GrantError("Already handled");
  await childOf(store, familyId, action.allowFor);
  if (g.kind === "override") await allowForChild(store, familyId, action.allowFor, g.targetId);
  else await recordOpenClearance(store, familyId, action.allowFor, g.targetId);
  return store.resolveLegacyGrant(familyId, legacyId, `allowed:${action.allowFor}`);
}
