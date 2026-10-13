// Every write that changes what a child may watch goes through here. Each one names the child,
// checks the child belongs to the family, and never widens access for anyone else.
// Takes the store as a parameter so tests can run it against a temporary local database.
import type { Store } from "@/lib/db/store";
import type { LegacyGrant, Profile } from "@/lib/types";
import { reviewEligibility } from "@/lib/gate";

export class GrantError extends Error {}

/**
 * Thrown when a parent tries to allow a video that has no eligible AI review without having confirmed
 * the disclosure. Every UI path catches this and shows the same "hasn't been reviewed" confirm step.
 */
export class NeedsUnreviewedConfirm extends GrantError {
  constructor(public videoId: string, public profileId: string, public reason: string) {
    super("This video hasn't been reviewed — confirm to allow it anyway");
  }
}

/** The video is blocked for every child by a family-wide block; no single child's Allow can override it. */
export class FamilyBlockError extends GrantError {
  constructor(public videoId: string) {
    super("This video is blocked for every child. Change that block first, then allow it for one child.");
  }
}

export async function hasFamilyBlock(store: Store, familyId: string, videoId: string) {
  return (await store.listWhitelist(familyId)).some((w) => w.kind === "block" && w.targetId === videoId && w.profileId == null);
}

/** Options for an explicit allow. `confirmedUnreviewed` = the parent saw and accepted the unreviewed disclosure. */
export type AllowOpts = { confirmedUnreviewed?: boolean };

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

/**
 * "Allow for <child>": the explicit approval. Plays for that child even if unreviewed or filtered — but
 * if there's no eligible review, only after the parent confirmed the disclosure (server-enforced here,
 * so no UI path can skip it).
 */
export async function allowForChild(store: Store, familyId: string, profileId: string, videoId: string, opts: AllowOpts = {}) {
  checkVideoId(videoId);
  await childOf(store, familyId, profileId);
  // A family-wide block (only pre-0018 data has these) beats any child's Allow. Refuse rather than write an
  // approval that would look successful but change nothing; the parent manages the block itself first.
  if (await hasFamilyBlock(store, familyId, videoId)) throw new FamilyBlockError(videoId);
  const review = reviewEligibility(await store.getCard(videoId));
  if (!review.eligible && !opts.confirmedUnreviewed) throw new NeedsUnreviewedConfirm(videoId, profileId, review.reason ?? "Not reviewed yet");
  await clearChildDecisions(store, familyId, profileId, videoId);
  await store.addToWhitelist({ familyId, profileId, kind: "override", targetId: videoId });
}

/**
 * Review-queue decisions, for one child:
 *  - allow: explicit approval (same as "Allow for <child>", including the unreviewed confirm)
 *  - hide ("Keep hidden"): a standing restriction for this child — stays hidden even if the review or
 *    the filters later change, until a parent allows or undoes it
 *  - never: blocked for this child
 *  - undo: back to the normal rules
 */
export async function decideForChild(
  store: Store, familyId: string, profileId: string, videoId: string, decision: "allow" | "hide" | "never" | "undo", opts: AllowOpts = {},
) {
  checkVideoId(videoId);
  if (decision === "allow") return allowForChild(store, familyId, profileId, videoId, opts);
  await childOf(store, familyId, profileId);
  await clearChildDecisions(store, familyId, profileId, videoId);
  if (decision === "never") await store.addToWhitelist({ familyId, profileId, kind: "block", targetId: videoId });
  if (decision === "hide") await store.addToWhitelist({ familyId, profileId, kind: "dismissed", targetId: videoId });
}

/** Lift a family-wide "Keep hidden" (only pre-0018 rows are family-wide). Children's own decisions are untouched. */
export async function unhideForFamily(store: Store, familyId: string, videoId: string) {
  checkVideoId(videoId);
  await store.removeFromWhitelist(familyId, "dismissed", videoId, null);
}

/**
 * Turn a family-wide block into one block per current child — the same restriction for everyone today,
 * but now each child's block can be changed on its own. Per-child rows are written BEFORE the family row
 * is removed, so there's never a moment the video is unblocked. (Children added later aren't covered.)
 */
export async function splitFamilyBlock(store: Store, familyId: string, videoId: string) {
  checkVideoId(videoId);
  if (!(await hasFamilyBlock(store, familyId, videoId))) throw new GrantError("This video isn't blocked for the whole family");
  for (const p of await store.listProfiles(familyId)) {
    await store.addToWhitelist({ familyId, profileId: p.id, kind: "block", targetId: videoId });
  }
  await store.removeFromWhitelist(familyId, "block", videoId, null);
}

/** Remove a family-wide block. Children's own blocks stay; everyone else goes back to the normal rules. */
export async function removeFamilyBlock(store: Store, familyId: string, videoId: string) {
  checkVideoId(videoId);
  await store.removeFromWhitelist(familyId, "block", videoId, null);
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
export async function approveRequest(
  store: Store, familyId: string, request: { videoId: string; profileId?: string | null }, chosenProfileId?: string | null, opts: AllowOpts = {},
) {
  const pid = request.profileId ?? chosenProfileId;
  if (!pid) throw new GrantError("This request doesn't say which child asked — choose one");
  await allowForChild(store, familyId, pid, request.videoId, opts);
  return pid;
}

/**
 * A parent reviews a pre-0018 record.
 *  - { allowFor }: the parent deliberately allows the video for that child → an explicit approval
 *    (override), whatever the old record was. An old open-mode clearance ("auto") is NOT re-created as
 *    another auto: those are inert outside Open mode, and the parent asked for "Allow".
 *  - "dismiss": nobody gets access; the record stays in legacy_grants as history.
 */
export async function resolveLegacy(
  store: Store, familyId: string, legacyId: string, action: { allowFor: string } | "dismiss", opts: AllowOpts = {},
): Promise<LegacyGrant | undefined> {
  const open = await store.listLegacyGrants(familyId);
  const g = open.find((x) => x.id === legacyId);
  if (!g) throw new GrantError("Already handled");
  if (action === "dismiss") return store.resolveLegacyGrant(familyId, legacyId, "dismissed");
  await allowForChild(store, familyId, action.allowFor, g.targetId, opts);
  return store.resolveLegacyGrant(familyId, legacyId, `allowed:${action.allowFor}`);
}
