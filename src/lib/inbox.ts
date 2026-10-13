// The parent's Review inbox: every pending decision across all children, deduplicated. Pure, so the
// Review page, the Review badge and the tests all count the same things.
//
// What counts as one decision:
//   request — each pending kid request. A request names the child who asked; an old request that didn't
//             record a child is its own item (the parent picks the child).
//   held    — a reviewed video in a child's library that the gate holds back for THAT child and the parent
//             hasn't decided on (needsDecision). One item per (child, video).
//   legacy  — each unresolved pre-0018 approval waiting to be assigned or dismissed.
// Dedup: a held item is dropped when the same child already has a pending request for the same video (the
// request IS that decision). Different children deciding on the same video are different decisions.
import { needsDecision } from "@/lib/gate";
import type { FamilySettings, LegacyGrant, Profile, VideoWithCard, WatchRequest } from "@/lib/types";

export type InboxItem =
  | { kind: "request"; key: string; requestId: string; videoId: string; profileId: string | null; createdAt: string }
  | { kind: "held"; key: string; videoId: string; profileId: string; publishedAt?: string }
  | { kind: "legacy"; key: string; legacyId: string; videoId: string; legacyKind: LegacyGrant["kind"]; candidateIds: string[]; createdAt: string };

export type ChildLibrary = { profile: Pick<Profile, "id">; settings: FamilySettings; lib: VideoWithCard[] };

export function pendingDecisions(input: { requests: WatchRequest[]; children: ChildLibrary[]; legacy: LegacyGrant[] }): InboxItem[] {
  const childIds = new Set(input.children.map((c) => c.profile.id));
  const pending = input.requests.filter((r) => r.status === "pending" && (!r.profileId || childIds.has(r.profileId)));
  const requested = new Set(pending.filter((r) => r.profileId).map((r) => `${r.profileId}:${r.videoId}`));
  const items: InboxItem[] = pending.map((r) => ({ kind: "request", key: `r:${r.id}`, requestId: r.id, videoId: r.videoId, profileId: r.profileId ?? null, createdAt: r.createdAt }));
  for (const c of input.children) {
    for (const v of c.lib) {
      if (!needsDecision(v, c.settings) || requested.has(`${c.profile.id}:${v.id}`)) continue;
      items.push({ kind: "held", key: `h:${c.profile.id}:${v.id}`, videoId: v.id, profileId: c.profile.id, publishedAt: v.publishedAt });
    }
  }
  for (const g of input.legacy.filter((x) => !x.resolvedAt)) {
    items.push({ kind: "legacy", key: `l:${g.id}`, legacyId: g.id, videoId: g.targetId, legacyKind: g.kind, candidateIds: g.candidateProfileIds, createdAt: g.createdAt });
  }
  return items;
}

/** Items that concern one child (unattributed requests and old records with that child as a candidate included). */
export function forChild(items: InboxItem[], profileId: string): InboxItem[] {
  return items.filter((i) =>
    i.kind === "request" ? i.profileId === profileId || i.profileId === null
    : i.kind === "held" ? i.profileId === profileId
    : i.candidateIds.length === 0 || i.candidateIds.includes(profileId));
}
