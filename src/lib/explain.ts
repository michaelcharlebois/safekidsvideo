// Plain-language explanations of why a video is held back for one child, built from the gate's structured
// reasons (ruleHits / reviewEligibility) — never from free text — so the words can't drift from the rule
// that's actually applied. AI findings and other parents' flags are always attributed to their real source.
import { REASON, reviewEligibility, ruleHits } from "@/lib/gate";
import { CONCERN_LABELS, FORMAT_LABELS, type ConcernTag, type FamilySettings, type VideoWithCard } from "@/lib/types";

export type Evidence = {
  tag?: ConcernTag;
  label: string;
  /** "ai": the AI review found it; "parents": other parents flagged it (the AI didn't, or not strongly enough). */
  source: "ai" | "parents" | "review" | "settings";
  severity?: "Mild" | "Moderate" | "Strong";
  timestamp?: string;
  evidence?: string;
  parents?: number;
};

export type HoldExplanation = { summary: string; evidence: Evidence[] };

const SEVERITY = ["", "Mild", "Moderate", "Strong"] as const;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Why `v` doesn't play for this child, from the gate's point of view (null when nothing in the review or the
 * child's settings holds it back). Covers: no usable review (missing / low confidence / incomplete), the
 * child's age, blocked formats, concerns the AI found, and concerns other parents flagged.
 */
export function holdExplanation(v: VideoWithCard, s: FamilySettings): HoldExplanation | null {
  const name = s.profileName ?? "this child";
  const review = reviewEligibility(v.card);
  if (!review.eligible) {
    const c = v.card;
    const summary =
      c?.reviewer?.model === "sample" ? "There's only a sample card, not a real AI review."
      : review.reason === REASON.lowConfidence ? `The AI review wasn't confident enough (${Math.round((c?.confidence ?? 0) * 100)}%) to rely on.`
      : review.reason === REASON.invalidReview ? "The AI review came back incomplete, so it can't be relied on."
      : "It hasn't had an AI review yet.";
    return { summary, evidence: [{ label: summary, source: "review" }] };
  }

  const hits = ruleHits(v, s);
  if (!hits.length) return null;
  const sentences: string[] = [];
  const evidence: Evidence[] = [];

  const ai = hits.flatMap((h) => (h.kind === "concern" && h.ai ? [h] : []));
  const parentsOnly = hits.flatMap((h) => (h.kind === "concern" && !h.ai && h.parents ? [h] : []));
  if (ai.length) {
    sentences.push(`The AI review found ${list(ai.map((h) => `${CONCERN_LABELS[h.tag].toLowerCase()} (${SEVERITY[h.ai!.intensity].toLowerCase()})`))}, which ${name}'s settings hold back.`);
    for (const h of ai) evidence.push({ tag: h.tag, label: CONCERN_LABELS[h.tag], source: "ai", severity: SEVERITY[h.ai!.intensity] as Evidence["severity"], timestamp: h.ai!.timestamp, evidence: h.ai!.evidence, parents: h.parents });
  }
  if (parentsOnly.length) {
    sentences.push(`Other parents reported ${list(parentsOnly.map((h) => CONCERN_LABELS[h.tag].toLowerCase()))}, which ${name}'s settings hold back. The AI review didn't flag ${parentsOnly.length === 1 ? "it" : "them"} as moderate or strong.`);
    for (const h of parentsOnly) evidence.push({ tag: h.tag, label: CONCERN_LABELS[h.tag], source: "parents", parents: h.parents });
  }
  for (const h of hits) {
    if (h.kind === "age") {
      sentences.push(`The AI review suggests ages ${h.min} and up; ${name} is ${h.kidAge}.`);
      evidence.push({ label: `Ages ${h.min}+`, source: "ai" });
    }
    if (h.kind === "format") {
      sentences.push(`It's a ${FORMAT_LABELS[h.format].toLowerCase()} video, a kind ${name}'s settings hold back.`);
      evidence.push({ label: FORMAT_LABELS[h.format], source: "settings" });
    }
    if (h.kind === "noAge") {
      sentences.push(`${name}'s age isn't set, so the age check can't pass.`);
      evidence.push({ label: "Age not set", source: "settings" });
    }
  }
  return { summary: sentences.join(" "), evidence };
}
