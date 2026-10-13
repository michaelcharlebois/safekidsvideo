// The single authorization decision for kid playback. Pure (no server-only import) so scripts,
// evals and tests use exactly what production uses.
//
// A video may play automatically for a child only if
//   (a) a parent explicitly allowed that specific video for that child, or
//   (b) it has an eligible AI review, passes that child's rules, and has a source that lets it in
//       for that child: it's in the library (approved channel / added video), or the child is in Open mode.
// Nothing else grants playback: not a channel approval on its own, not another child's approval,
// not peer feedback, not a stale open-mode clearance.

import {
  CONCERN_LABELS, FORMAT_LABELS,
  type Channel, type ConcernTag, type Confirmation, type ContentCard, type FamilySettings,
  type Video, type VideoWithCard, type WhitelistEntry,
} from "@/lib/types";

/** Below this the reviewer isn't sure enough for a video to play without a parent. */
export const MIN_CONFIDENCE = 0.7;

export const REASON = {
  blocked: "Blocked by a parent",
  noChild: "Choose who's watching",
  noAge: "Add this child's age",
  unreviewed: "Not reviewed yet",
  lowConfidence: "Review wasn't confident enough",
  notInLibrary: "Not in this child's library",
} as const;

// ---- review eligibility ---------------------------------------------------------------------

/** Is this card a genuine, usable AI review? Missing, sample, failed and low-confidence reviews are not. */
export function reviewEligibility(card: ContentCard | undefined | null): { eligible: boolean; reason?: string } {
  if (!card) return { eligible: false, reason: REASON.unreviewed };
  const model = card.reviewer?.model ?? "";
  if (!model || model === "sample") return { eligible: false, reason: REASON.unreviewed };
  if (!Array.isArray(card.concerns) || !card.ageFit || typeof card.confidence !== "number" || Number.isNaN(card.confidence)) {
    return { eligible: false, reason: REASON.unreviewed }; // malformed / failed parse
  }
  if (card.confidence < MIN_CONFIDENCE) return { eligible: false, reason: REASON.lowConfidence };
  return { eligible: true };
}

// ---- child rules -----------------------------------------------------------------------------

/**
 * Restrictions from this child's rules, given an eligible review. Peer feedback can only ADD
 * restrictions ("missed" flags); "over-called" votes never neutralize an AI flag.
 * Age: the lower bound gates; the upper bound is informational.
 */
export function ruleReasons(v: Pick<VideoWithCard, "card" | "confirmations">, s: FamilySettings): string[] {
  const out: string[] = [];
  const c = v.card;
  if (s.kidAge == null) out.push(REASON.noAge);
  else if (c && c.ageFit.min > s.kidAge) out.push(`Rated for ages ${c.ageFit.min}+`);
  if (c?.format && s.blockedFormats.includes(c.format)) out.push(FORMAT_LABELS[c.format]);
  for (const tag of s.blockedTags) {
    const ai = c?.concerns.find((f) => f.tag === tag);
    const aiHit = !!ai && ai.present && ai.intensity >= 2;
    const peerHit = (v.confirmations.flaggedTags[tag] ?? 0) >= s.flagThreshold;
    if (aiHit || peerHit) out.push(CONCERN_LABELS[tag]);
  }
  return out;
}

// ---- the decision ----------------------------------------------------------------------------

export type AuthBasis = "explicit" | "library" | "open";
export type AuthDecision = { allow: boolean; basis: AuthBasis | null; reasons: string[] };

/**
 * THE gate. `v` must come from buildLibrary/getLibrary scoped to the same child as `s`
 * (v.scopedTo === s.profileId); a mismatch fails closed.
 */
export function authorize(v: VideoWithCard, s: FamilySettings): AuthDecision {
  const deny = (...reasons: string[]): AuthDecision => ({ allow: false, basis: null, reasons });
  if (!s.profileId) return deny(REASON.noChild);
  if (v.scopedTo !== s.profileId) return deny(REASON.noChild); // flags computed for a different child (or family-wide)
  if (v.blockedByParent) return deny(REASON.blocked);
  if (v.overridden) return { allow: true, basis: "explicit", reasons: [] };

  const review = reviewEligibility(v.card);
  if (!review.eligible) return deny(review.reason!);
  const rules = ruleReasons(v, s);
  if (rules.length) return deny(...rules);

  if (v.inLibrary) return { allow: true, basis: "library", reasons: [] };
  if (s.mode === "open") return { allow: true, basis: "open", reasons: [] };
  return deny(REASON.notInLibrary);
}

export const canPlay = (v: VideoWithCard, s: FamilySettings) => authorize(v, s).allow;

/** Why a video is hidden from this child (empty when it plays). For display. */
export function blockedReasons(v: VideoWithCard, s: FamilySettings): string[] {
  const d = authorize(v, s);
  return d.allow ? [] : d.reasons;
}

/** Would the review alone (no source, no explicit approval) clear this for the child? Used to explain open-mode checks. */
export function screen(v: VideoWithCard, s: FamilySettings): { pass: boolean; reasons: string[] } {
  if (v.blockedByParent) return { pass: false, reasons: [REASON.blocked] };
  const review = reviewEligibility(v.card);
  if (!review.eligible) return { pass: false, reasons: [review.reason!] };
  const reasons = ruleReasons(v, s);
  return { pass: reasons.length === 0, reasons };
}

// ---- building the child-scoped library -------------------------------------------------------

export type GrantIndex = {
  channels: Set<string>; videos: Set<string>; overrides: Set<string>; autos: Set<string>; blocks: Set<string>; dismissed: Set<string>;
};

/**
 * Which grants apply to this child. Family-wide rows (null profile) apply to every child, EXCEPT
 * override/auto, which only ever count when they name this child. With no child (family view), only
 * family-wide rows count.
 */
export function grantIndex(entries: WhitelistEntry[], profileId: string | undefined): GrantIndex {
  const g: GrantIndex = { channels: new Set(), videos: new Set(), overrides: new Set(), autos: new Set(), blocks: new Set(), dismissed: new Set() };
  for (const e of entries) {
    const familyWide = e.profileId == null;
    const forChild = !!profileId && e.profileId === profileId;
    switch (e.kind) {
      case "channel": if (familyWide || forChild) g.channels.add(e.targetId); break;
      case "video": if (familyWide || forChild) g.videos.add(e.targetId); break;
      case "override": if (forChild) g.overrides.add(e.targetId); break;
      case "auto": if (forChild) g.autos.add(e.targetId); break;
      case "block": if (familyWide || forChild) g.blocks.add(e.targetId); break;
      case "dismissed": if (familyWide || forChild) g.dismissed.add(e.targetId); break;
    }
  }
  return g;
}

/** Crowd confirmations → per-video tallies. "missed" restricts; "overcall" is kept for display and learning only. */
export function tallyConfirmations(confirmations: Confirmation[]) {
  const blank = (): VideoWithCard["confirmations"] => ({ agree: 0, flag: 0, flaggedTags: {}, overcalledTags: {} });
  const tallies = new Map<string, VideoWithCard["confirmations"]>();
  for (const c of confirmations) {
    const t = tallies.get(c.videoId) ?? blank();
    if (c.verdict === "agree") t.agree++;
    else t.flag++;
    for (const tag of c.tags ?? []) if (!c.tagVotes?.[tag]) t.flaggedTags[tag] = (t.flaggedTags[tag] ?? 0) + 1;
    for (const [tag, vote] of Object.entries(c.tagVotes ?? {}) as [ConcernTag, string][]) {
      if (vote === "missed") t.flaggedTags[tag] = (t.flaggedTags[tag] ?? 0) + 1;
      if (vote === "overcall") t.overcalledTags[tag] = (t.overcalledTags[tag] ?? 0) + 1;
    }
    tallies.set(c.videoId, t);
  }
  return { get: (id: string) => tallies.get(id) ?? blank() };
}

/** Join videos with cards, crowd tallies and THIS child's grants. Pure; getLibrary() is the I/O wrapper. */
export function buildLibrary(input: {
  videos: Video[]; channels: Channel[]; cards: ContentCard[]; confirmations: Confirmation[];
  whitelist: WhitelistEntry[]; profileId?: string;
}): VideoWithCard[] {
  const channelById = new Map(input.channels.map((c) => [c.id, c]));
  const cardById = new Map(input.cards.map((c) => [c.videoId, c]));
  const g = grantIndex(input.whitelist, input.profileId);
  const tallies = tallyConfirmations(input.confirmations);
  return input.videos.map((v) => {
    const blocked = g.blocks.has(v.id);
    const inLibrary = g.channels.has(v.channelId) || g.videos.has(v.id);
    const overridden = g.overrides.has(v.id);
    const autoApproved = g.autos.has(v.id);
    return {
      ...v,
      channel: channelById.get(v.channelId),
      card: cardById.get(v.id),
      confirmations: tallies.get(v.id),
      inLibrary,
      whitelisted: !blocked && (inLibrary || overridden || autoApproved),
      blockedByParent: blocked,
      dismissed: g.dismissed.has(v.id),
      overridden,
      autoApproved,
      scopedTo: input.profileId,
    };
  });
}

/** A real AI review exists (possibly low-confidence) — as opposed to none / a sample placeholder. */
export const hasRealReview = (card: ContentCard | undefined | null) => !!card && !!card.reviewer?.model && card.reviewer.model !== "sample";

/**
 * Waiting on a parent's call for this child: in their library, has a real review, but the gate holds it
 * back (filters, age, low confidence), and the parent hasn't already allowed, hidden or blocked it.
 * Unreviewed videos are the pipeline's job, not the parent's.
 */
export function needsDecision(v: VideoWithCard, s: FamilySettings): boolean {
  return v.inLibrary && hasRealReview(v.card) && !v.dismissed && !v.overridden && !v.blockedByParent && !canPlay(v, s);
}

/** The ordered set a child may play right now. Every kid surface derives from this. */
export const playableFor = (lib: VideoWithCard[], s: FamilySettings) => lib.filter((v) => canPlay(v, s));

/**
 * What plays after `currentId`, re-derived from a FRESH playable list (so a restriction added mid-session
 * takes effect at the next advance). Returns null when nothing is playable.
 */
export function nextAuthorized<T extends { id: string }>(fresh: T[], currentId: string, order: string[] = []): T | null {
  if (!fresh.length) return null;
  // Follow the client's original order when we can (it reflects the shelf the kid started from).
  const pos = new Map(order.map((id, i) => [id, i]));
  const curPos = pos.get(currentId);
  if (curPos != null) {
    for (let k = 1; k <= order.length; k++) {
      const id = order[(curPos + k) % order.length];
      const hit = fresh.find((x) => x.id === id);
      if (hit && hit.id !== currentId) return hit;
    }
  }
  const i = fresh.findIndex((x) => x.id === currentId); // -1 when current was just restricted → start of list
  return fresh[(i + 1) % fresh.length];
}
