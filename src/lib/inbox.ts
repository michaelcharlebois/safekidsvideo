// The parent's Review inbox: permission decisions that are genuinely waiting on a parent. Pure, so the
// Review page, the Review badge, Kids and the tests all count the same things.
//
// What is in it:
//   request — each pending child request. `profileId` names the child who asked; an older request that
//             didn't record a child is kept distinguishable (`profileId: null`) and the parent picks one.
//   legacy  — each unresolved pre-0018 approval record, waiting to be assigned to a child or dismissed.
//
// What is NOT in it: videos a child's settings hold back automatically (filters, age, format, reports, or
// an uncertain AI review), whether they came from a channel or were added one by one. That is Brightframe
// working as intended; those videos live in Library with their reason and the Allow / Keep hidden / Never
// actions. Because of that, counting the inbox never needs any child's library — only requests, legacy
// records and the family's children (no catalogue scan).
import type { LegacyGrant, WatchRequest } from "@/lib/types";

export type InboxItem =
  | { kind: "request"; key: string; requestId: string; videoId: string; profileId: string | null; createdAt: string }
  | { kind: "legacy"; key: string; legacyId: string; videoId: string; legacyKind: LegacyGrant["kind"]; candidateIds: string[]; createdAt: string };

export function pendingDecisions(input: { requests: WatchRequest[]; childIds: string[]; legacy: LegacyGrant[] }): InboxItem[] {
  const childIds = new Set(input.childIds);
  const items: InboxItem[] = input.requests
    .filter((r) => r.status === "pending" && (!r.profileId || childIds.has(r.profileId)))
    .map((r) => ({ kind: "request", key: `r:${r.id}`, requestId: r.id, videoId: r.videoId, profileId: r.profileId ?? null, createdAt: r.createdAt }));
  for (const g of input.legacy.filter((x) => !x.resolvedAt)) {
    items.push({ kind: "legacy", key: `l:${g.id}`, legacyId: g.id, videoId: g.targetId, legacyKind: g.kind, candidateIds: g.candidateProfileIds, createdAt: g.createdAt });
  }
  return items;
}

/** A request a named child actually made. */
export const isChildRequest = (i: InboxItem): i is Extract<InboxItem, { kind: "request" }> & { profileId: string } =>
  i.kind === "request" && !!i.profileId;

/** Requests this child made themselves — what Kids ("Asking for more") and the per-child badges count. */
export const requestsFrom = (items: InboxItem[], profileId: string) => items.filter((i) => isChildRequest(i) && i.profileId === profileId);

/**
 * Review filtered to one child: their own requests, plus the historical items that may concern them (older
 * requests with no child recorded, and old approval records listing them as a candidate). Shown as such.
 */
export function forChild(items: InboxItem[], profileId: string): InboxItem[] {
  return items.filter((i) =>
    i.kind === "request" ? i.profileId === profileId || i.profileId === null
    : i.candidateIds.length === 0 || i.candidateIds.includes(profileId));
}

/** Review order: named children's requests (newest first), then older unattributed requests, then old records. */
export function inboxOrder(a: InboxItem, b: InboxItem): number {
  const rank = (i: InboxItem) => (isChildRequest(i) ? 0 : i.kind === "request" ? 1 : 2);
  return rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt);
}
