// Pure gating logic (no server-only import) so scripts and evals can use it too.
import { CONCERN_LABELS, FORMAT_LABELS, type FamilySettings, type VideoWithCard } from "@/lib/types";

/**
 * Does this video trip the family's blocked tags?
 * A tag counts if the AI found it at intensity >= 2 (unless enough parents say it over-called),
 * OR enough parents say the AI missed it.
 */
export function blockedReasons(v: VideoWithCard, s: FamilySettings): string[] {
  const out: string[] = [];
  if (v.overridden) return out;
  if (!v.card && s.hideUnreviewed) return ["Not reviewed yet"];
  if (v.card?.format && s.blockedFormats.includes(v.card.format)) out.push(FORMAT_LABELS[v.card.format]);
  for (const tag of s.blockedTags) {
    const ai = v.card?.concerns.find((c) => c.tag === tag);
    const overcalled = (v.confirmations.overcalledTags[tag] ?? 0) >= s.flagThreshold;
    const aiHit = !!ai && ai.present && ai.intensity >= 2 && !overcalled;
    const parentHit = (v.confirmations.flaggedTags[tag] ?? 0) >= s.flagThreshold;
    if (aiHit || parentHit) out.push(CONCERN_LABELS[tag]);
  }
  return out;
}

