// What a video's state means for ONE child, in parent-facing words — derived only from the gate's
// decision, so the UI can never claim more than authorize() allows. Pure (used by components and tests).
import { authorize, hasRealReview, REASON } from "@/lib/gate";
import type { FamilySettings, VideoWithCard } from "@/lib/types";

export type PlayStatus =
  | "plays"      // passes the AI review + this child's rules, and has a source for them
  | "allowed"    // a parent explicitly allowed it for this child
  | "reviewing"  // no usable AI review yet (none, low confidence, or incomplete)
  | "held"       // reviewed, but this child's rules hold it back — waiting on a parent's call
  | "hidden"     // a parent chose "Keep hidden" for this child
  | "blocked"    // a parent chose "Never" (for this child or the whole family)
  | "outside";   // reviewed and fine, but not in this child's library (Locked / Ask First)

export const STATUS_LABEL: Record<PlayStatus, string> = {
  plays: "Plays",
  allowed: "Allowed by you",
  reviewing: "Being reviewed",
  held: "Held back",
  hidden: "Kept hidden",
  blocked: "Blocked",
  outside: "Not in library",
};

export function playStatus(v: VideoWithCard, s: FamilySettings): { status: PlayStatus; reasons: string[] } {
  const d = authorize(v, s);
  if (d.allow) return { status: d.basis === "explicit" ? "allowed" : "plays", reasons: [] };
  const first = d.reasons[0];
  if (first === REASON.blocked) return { status: "blocked", reasons: d.reasons };
  if (first === REASON.keptHidden) return { status: "hidden", reasons: d.reasons };
  if (first === REASON.unreviewed || first === REASON.lowConfidence || first === REASON.invalidReview) {
    return { status: hasRealReview(v.card) && first !== REASON.unreviewed ? "held" : "reviewing", reasons: d.reasons };
  }
  if (first === REASON.notInLibrary) return { status: "outside", reasons: d.reasons };
  return { status: "held", reasons: d.reasons };
}
