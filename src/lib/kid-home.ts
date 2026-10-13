// One child's content, computed once and shared by every screen that claims to show it: the kid home
// screen, the parent dashboard (counts, inventory, kid-screen preview) and the tests. Pure.
//
// Two separate questions, never conflated:
//   inventory — what is in this child's library at all (a content source for them, an explicit "Allow for
//               <child>", or — only while they're in Open mode — a video their own search check cleared).
//               Blocked / kept-hidden / unreviewed videos stay IN the inventory; their status says why they
//               don't play. A stale Open-mode clearance does NOT put a video in a Locked/Ask-First child's
//               inventory.
//   playable  — inventory ∩ authorize(). Exactly what the kid home screen can show.
import { canPlay, reviewEligibility } from "@/lib/gate";
import { forKid, orderShelves, type Taste } from "@/lib/arrange";
import type { Channel, FamilySettings, VideoWithCard } from "@/lib/types";

/** Is this video part of the child's library (regardless of whether it plays right now)? */
export function inInventory(v: VideoWithCard, s: FamilySettings): boolean {
  if (!s.profileId || v.scopedTo !== s.profileId) return false; // flags computed for another child: not theirs
  return v.inLibrary || v.overridden || (v.autoApproved && s.mode === "open");
}

export const inventoryFor = (lib: VideoWithCard[], s: FamilySettings) => lib.filter((v) => inInventory(v, s));

/** The library videos this child can play right now. */
export const readyFor = (lib: VideoWithCard[], s: FamilySettings) => inventoryFor(lib, s).filter((v) => canPlay(v, s));

export type ChannelShelf = { id: string; channelId: string; channel?: Channel; title: string; videos: VideoWithCard[]; checking: number };
export type KidHome = {
  inventory: VideoWithCard[];
  playable: VideoWithCard[];
  justApproved: VideoWithCard[];
  keepWatching: VideoWithCard[];
  forYou: VideoWithCard[];
  channels: ChannelShelf[];
  /** The shelves in the order the kid screen draws them. */
  shelves: { id: string; title: string; videos: VideoWithCard[] }[];
};

/** The kid home screen, exactly. `approvedIds`: requests approved in the last day; `recentIds`: newest first. */
export function kidHome(input: {
  lib: VideoWithCard[]; settings: FamilySettings; recentIds: string[]; approvedIds: Set<string>; taste: Taste; now: number;
}): KidHome {
  const { lib, settings: s } = input;
  const byId = new Map(lib.map((v) => [v.id, v]));
  const ok = (v: VideoWithCard) => canPlay(v, s);
  const inventory = inventoryFor(lib, s);
  const playable = inventory.filter(ok);
  const justApproved = playable.filter((v) => input.approvedIds.has(v.id));
  // "Keep watching" may include an Open-mode find outside the library — it still has to pass the gate.
  const keepWatching = input.recentIds.map((id) => byId.get(id)).filter((v): v is VideoWithCard => !!v && ok(v));
  const forYou = playable.length >= 6 ? forKid(playable, s, input.taste, 8) : [];

  const FRESH_MS = 30 * 60 * 1000;
  const byChannel = new Map<string, VideoWithCard[]>();
  for (const v of inventory) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  const channels = orderShelves(
    [...byChannel.entries()]
      .map(([channelId, vids]) => {
        const videos = vids.filter(ok).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
        const unreviewed = vids.filter((v) => !reviewEligibility(v.card).eligible).length;
        const added = vids[0].channel?.createdAt ? Date.parse(vids[0].channel.createdAt) : 0;
        return {
          id: channelId, channelId, channel: vids[0].channel,
          title: vids[0].channel?.title ?? channelId.replace(/^@/, ""),
          videos,
          // A channel added in the last half hour with nothing playable yet is still being checked.
          checking: videos.length === 0 && unreviewed > 0 && input.now - added < FRESH_MS ? unreviewed : 0,
        };
      })
      .filter((x) => x.videos.length > 0 || x.checking > 0),
    s.channelOrder,
  );
  const name = s.profileName ?? "you";
  const shelves = [
    ...(justApproved.length ? [{ id: "approved", title: "A grown-up said yes!", videos: justApproved }] : []),
    ...(keepWatching.length ? [{ id: "recent", title: "Keep watching", videos: keepWatching }] : []),
    ...(forYou.length ? [{ id: "for-you", title: `For ${name}`, videos: forYou }] : []),
    ...channels.filter((c) => c.videos.length).map((c) => ({ id: c.channelId, title: c.title, videos: c.videos })),
  ];
  return { inventory, playable, justApproved, keepWatching, forYou, channels, shelves };
}
