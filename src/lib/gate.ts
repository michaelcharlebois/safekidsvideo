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
  CONCERN_LABELS, CONCERN_TAGS, FORMAT_LABELS, FORMATS,
  type Channel, type ConcernFinding, type ConcernTag, type Confirmation, type ContentCard, type FamilySettings,
  type Video, type VideoFormat, type VideoWithCard, type WhitelistEntry,
} from "@/lib/types";

/** Below this the reviewer isn't sure enough for a video to play without a parent. */
export const MIN_CONFIDENCE = 0.7;

export const REASON = {
  blocked: "Blocked by a parent",
  keptHidden: "A parent chose to keep it hidden",
  noChild: "Choose who's watching",
  noAge: "Add this child's age",
  unreviewed: "Not reviewed yet",
  lowConfidence: "Review wasn't confident enough",
  invalidReview: "Review was incomplete",
  notInLibrary: "Not in this child's library",
} as const;

// ---- review eligibility ---------------------------------------------------------------------

const isInt = (n: unknown, lo: number, hi: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
const TAGS = new Set<string>(CONCERN_TAGS);
const FORMAT_SET = new Set<string>(FORMATS);

/**
 * Is every field the gate relies on present and in range? Anything else is treated as "no review".
 * Checks: age minimum/maximum (integers 0–18, min ≤ max), confidence (a finite number 0–1), format
 * (a known one, so a blocked format can't slip through as an unknown string), and concerns (exactly one
 * well-formed finding — known tag, boolean present, integer intensity 0–3 — for EVERY tag in the
 * taxonomy, so an unassessed tag can't read as "absent").
 */
export function cardProblems(card: unknown): string[] {
  const out: string[] = [];
  if (!card || typeof card !== "object") return ["not an object"];
  const c = card as Record<string, unknown>;
  const age = c.ageFit as Record<string, unknown> | undefined;
  if (!age || typeof age !== "object") out.push("ageFit missing");
  else {
    if (!isInt(age.min, 0, 18)) out.push("ageFit.min invalid");
    if (!isInt(age.max, 0, 18)) out.push("ageFit.max invalid");
    if (isInt(age.min, 0, 18) && isInt(age.max, 0, 18) && age.min > age.max) out.push("ageFit.min > max");
  }
  if (typeof c.confidence !== "number" || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1) out.push("confidence invalid");
  if (typeof c.format !== "string" || !FORMAT_SET.has(c.format)) out.push("format invalid");
  if (!Array.isArray(c.concerns)) out.push("concerns missing");
  else {
    const seen = new Set<string>();
    for (const f of c.concerns as unknown[]) {
      const x = f as Record<string, unknown> | null;
      if (!x || typeof x !== "object" || typeof x.tag !== "string" || !TAGS.has(x.tag)) { out.push("concern with unknown tag"); continue; }
      if (seen.has(x.tag)) out.push(`concern ${x.tag} duplicated`);
      seen.add(x.tag);
      if (typeof x.present !== "boolean") out.push(`concern ${x.tag}.present invalid`);
      if (!isInt(x.intensity, 0, 3)) out.push(`concern ${x.tag}.intensity invalid`);
    }
    for (const t of CONCERN_TAGS) if (!seen.has(t)) out.push(`concern ${t} not assessed`);
  }
  return out;
}

/** Is this card a genuine, usable AI review? Missing, sample, malformed and low-confidence reviews are not. */
export function reviewEligibility(card: ContentCard | undefined | null): { eligible: boolean; reason?: string } {
  if (!card) return { eligible: false, reason: REASON.unreviewed };
  const model = typeof card.reviewer?.model === "string" ? card.reviewer.model.trim() : "";
  if (!model || model === "sample") return { eligible: false, reason: REASON.unreviewed };
  if (cardProblems(card).length) return { eligible: false, reason: REASON.invalidReview };
  if (card.confidence < MIN_CONFIDENCE) return { eligible: false, reason: REASON.lowConfidence };
  return { eligible: true };
}

// ---- what counts as a finding -----------------------------------------------------------------

/**
 * A concern is FOUND when its intensity is 1–3, and it can hold a video back when intensity ≥ 2.
 * Intensity is authoritative: a contradictory `present` flag is ignored by review normalization, by the
 * gate and by every display, so a restriction can never be invisible (or shown when it isn't one).
 */
export const BLOCKING_INTENSITY = 2;
export const isFound = (f: { intensity: number }) => f.intensity >= 1;
export function foundConcerns<F extends { intensity: number }>(card: { concerns?: F[] } | undefined | null): F[] {
  return Array.isArray(card?.concerns) ? card.concerns.filter(isFound) : [];
}

// ---- child rules -----------------------------------------------------------------------------

/** Why a child's rules hold a reviewed video back, as data (ruleReasons() is the string form). */
export type RuleHit =
  | { kind: "noAge" }
  | { kind: "age"; min: number; kidAge: number }
  | { kind: "format"; format: VideoFormat }
  /** `ai` = the AI's finding when it reached BLOCKING_INTENSITY; `parents` = parent "missed it" flags when they reached the threshold. */
  | { kind: "concern"; tag: ConcernTag; ai?: ConcernFinding; parents?: number };

export function ruleHits(v: Pick<VideoWithCard, "card" | "confirmations">, s: FamilySettings): RuleHit[] {
  const out: RuleHit[] = [];
  const c = v.card;
  if (s.kidAge == null) out.push({ kind: "noAge" });
  else if (c && c.ageFit.min > s.kidAge) out.push({ kind: "age", min: c.ageFit.min, kidAge: s.kidAge });
  if (c?.format && s.blockedFormats.includes(c.format)) out.push({ kind: "format", format: c.format });
  for (const tag of s.blockedTags) {
    const f = c?.concerns.find((x) => x.tag === tag);
    const ai = f && f.intensity >= BLOCKING_INTENSITY ? f : undefined;
    const flags = v.confirmations.flaggedTags[tag] ?? 0;
    const parents = flags >= s.flagThreshold ? flags : undefined;
    if (ai || parents) out.push({ kind: "concern", tag, ai, parents });
  }
  return out;
}

/**
 * Restrictions from this child's rules, given an eligible review. Peer feedback can only ADD
 * restrictions ("missed" flags); "over-called" votes never neutralize an AI flag.
 * Age: the lower bound gates; the upper bound is informational.
 */
export function ruleReasons(v: Pick<VideoWithCard, "card" | "confirmations">, s: FamilySettings): string[] {
  return ruleHits(v, s).map((h) =>
    h.kind === "noAge" ? REASON.noAge
    : h.kind === "age" ? `Rated for ages ${h.min}+`
    : h.kind === "format" ? FORMAT_LABELS[h.format]
    : CONCERN_LABELS[h.tag]);
}

// ---- the decision ----------------------------------------------------------------------------

export type AuthBasis = "explicit" | "library" | "open";
export type AuthDecision = { allow: boolean; basis: AuthBasis | null; reasons: string[] };

/**
 * THE gate. Order: no child → deny; "Never" (block) → deny; "Allow for <child>" → allow;
 * "Keep hidden" → deny; no eligible review → deny; child's rules → deny; source (library / Open mode) → allow.
 * `v` must come from buildLibrary/getLibrary scoped to the same child as `s`
 * (v.scopedTo === s.profileId); a mismatch fails closed.
 */
export function authorize(v: VideoWithCard, s: FamilySettings): AuthDecision {
  const deny = (...reasons: string[]): AuthDecision => ({ allow: false, basis: null, reasons });
  if (!s.profileId) return deny(REASON.noChild);
  if (v.scopedTo !== s.profileId) return deny(REASON.noChild); // flags computed for a different child (or family-wide)
  if (v.blockedByParent) return deny(REASON.blocked);
  if (v.overridden) return { allow: true, basis: "explicit", reasons: [] };
  // "Keep hidden" is a standing decision for this child: it holds even if the review improves or the
  // filters relax, until a parent allows the video (which replaces it) or undoes it.
  if (v.dismissed) return deny(REASON.keptHidden);

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
  if (v.dismissed && !v.overridden) return { pass: false, reasons: [REASON.keptHidden] };
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
