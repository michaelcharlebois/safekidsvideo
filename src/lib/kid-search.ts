// What a search result means for THIS child, in words a child understands. Derived only from the gate
// (canPlay / reviewEligibility / ruleHits) plus the child's own request state. Pure.
import { canPlay, hasRealReview, reviewEligibility, ruleReasons } from "@/lib/gate";
import type { FamilySettings, VideoWithCard } from "@/lib/types";

export type SearchState =
  | { kind: "play" }                                   // plays now (the player still re-checks)
  | { kind: "waiting" }                                // this child asked; no answer yet
  | { kind: "declined" }                               // a grown-up said not now (in the last day)
  | { kind: "blocked" }                                // a grown-up said never: no asking
  | { kind: "check" }                                  // Open: no usable review yet; Brightframe checks it first
  | { kind: "ask"; why: "parent-first" | "settings" | "unsure" }; // needs a grown-up

export function searchState(row: VideoWithCard | undefined, s: FamilySettings, o: { pending: boolean; declined: boolean }): SearchState {
  if (row && canPlay(row, s)) return { kind: "play" };
  if (row?.blockedByParent) return { kind: "blocked" };
  if (o.pending) return { kind: "waiting" };
  if (o.declined) return { kind: "declined" };
  if (s.mode !== "open") return { kind: "ask", why: "parent-first" }; // Ask first: a grown-up says yes before anything new plays
  if (!row || !hasRealReview(row.card)) return { kind: "check" };
  if (!reviewEligibility(row.card).eligible) return { kind: "ask", why: "unsure" };
  if (row.dismissed || ruleReasons(row, s).length) return { kind: "ask", why: "settings" };
  return { kind: "ask", why: "parent-first" };
}

export const SEARCH_COPY: Record<SearchState["kind"] | "ask-settings" | "ask-unsure" | "ask-parent-first", { badge: string; note: string; action?: string }> = {
  play: { badge: "Ready", note: "You can watch this." },
  waiting: { badge: "Waiting for a grown-up", note: "You asked. A grown-up will look." },
  declined: { badge: "Not this time", note: "A grown-up said not now." },
  blocked: { badge: "Not this one", note: "A grown-up said this one isn't for you." },
  check: { badge: "Not checked yet", note: "Brightframe watches it first.", action: "Check it" },
  ask: { badge: "Ask a grown-up", note: "A grown-up says yes first.", action: "Ask a grown-up" },
  "ask-settings": { badge: "Needs a grown-up", note: "It doesn't fit your settings.", action: "Ask a grown-up" },
  "ask-unsure": { badge: "Needs a grown-up", note: "Brightframe isn't sure about it.", action: "Ask a grown-up" },
  "ask-parent-first": { badge: "Ask a grown-up", note: "A grown-up says yes first.", action: "Ask a grown-up" },
};
export const copyFor = (st: SearchState) => SEARCH_COPY[st.kind === "ask" ? (`ask-${st.why}` as const) : st.kind];
