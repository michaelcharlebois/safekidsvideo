// Shared selectors: the parent dashboard and the kid home screen select the same child's content, and the
// Review badge counts every child's pending decisions with explicit dedup rules.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLibrary, canPlay } from "@/lib/gate";
import { inventoryFor, kidHome, readyFor } from "@/lib/kid-home";
import { forChild, pendingDecisions } from "@/lib/inbox";
import { playStatus } from "@/lib/status";
import type { ContentCard, LegacyGrant, Video, WatchRequest, WhitelistEntry } from "@/lib/types";
import { CH_OTHER, CH_SONGS, FAM, LEO, MAYA, card, grant, leo, maya, video } from "./fixtures";

const taste = { channelMinutes: {}, formatMinutes: {}, finishedIds: new Set<string>(), recentIds: new Set<string>(), total: 0 };
const lib = (profileId: string, videos: Video[], cards: ContentCard[], wl: WhitelistEntry[]) =>
  buildLibrary({ videos, channels: [], cards, confirmations: [], whitelist: wl, profileId });
const ids = (vs: { id: string }[]) => vs.map((v) => v.id).sort();

describe("inventory vs. playback (shared by kid home and parent dashboard)", () => {
  const videos = [video("vOk", CH_SONGS), video("vBlocked", CH_SONGS), video("vHidden", CH_SONGS), video("vNoReview", CH_SONGS), video("vAuto", CH_OTHER), video("vOverMaya", CH_OTHER)];
  const cards = ["vOk", "vBlocked", "vHidden", "vAuto", "vOverMaya"].map((id) => card(id));
  const wl = [
    grant("channel", CH_SONGS),
    grant("block", "vBlocked", MAYA),
    grant("dismissed", "vHidden", MAYA),
    grant("auto", "vAuto", MAYA), // Maya's old Open-mode clearance
    grant("override", "vOverMaya", MAYA),
  ];

  it("REGRESSION: a blocked source video stays in the parent's inventory (status Blocked) but never plays", () => {
    const l = lib(MAYA, videos, cards, wl);
    const inv = inventoryFor(l, maya());
    const blocked = inv.find((v) => v.id === "vBlocked")!;
    expect(blocked).toBeDefined();
    expect(playStatus(blocked, maya()).status).toBe("blocked");
    expect(ids(readyFor(l, maya()))).not.toContain("vBlocked");
  });

  it("kept-hidden and unreviewed source videos are in the inventory, not playable", () => {
    const l = lib(MAYA, videos, cards, wl);
    expect(ids(inventoryFor(l, maya()))).toEqual(expect.arrayContaining(["vHidden", "vNoReview"]));
    expect(ids(readyFor(l, maya()))).toEqual(["vAuto", "vOk", "vOverMaya"]);
  });

  it("REGRESSION: a stale Open-mode clearance is NOT inventory once the child is Locked or Ask First", () => {
    for (const mode of ["locked", "open_ask"] as const) {
      const s = maya({ mode });
      const l = lib(MAYA, videos, cards, wl);
      expect(ids(inventoryFor(l, s))).not.toContain("vAuto");
      expect(ids(readyFor(l, s))).toEqual(["vOk", "vOverMaya"]);
    }
    expect(ids(inventoryFor(lib(MAYA, videos, cards, wl), maya({ mode: "open" })))).toContain("vAuto");
  });

  it("another child's approvals and clearances never enter this child's inventory", () => {
    const l = lib(LEO, videos, cards, wl);
    expect(ids(inventoryFor(l, leo()))).toEqual(["vBlocked", "vHidden", "vNoReview", "vOk"]); // just the channel
    expect(ids(readyFor(l, leo()))).toEqual(["vBlocked", "vHidden", "vOk"]); // Maya's block/hide don't apply to Leo
  });

  it("flags computed for a different child give an empty inventory (fail closed)", () => {
    expect(inventoryFor(lib(LEO, videos, cards, wl), maya())).toEqual([]);
  });

  it("the kid home screen draws only playable videos, and the dashboard's 'ready' is the same set", () => {
    for (const s of [maya(), maya({ mode: "locked" }), leo()]) {
      const l = lib(s.profileId!, videos, cards, wl);
      const home = kidHome({ lib: l, settings: s, recentIds: [], approvedIds: new Set(), taste, now: 0 });
      expect(ids(home.playable)).toEqual(ids(readyFor(l, s)));
      const onScreen = home.shelves.flatMap((x) => x.videos);
      expect(onScreen.every((v) => canPlay(v, s))).toBe(true);
      expect(ids([...new Map(onScreen.map((v) => [v.id, v])).values()])).toEqual(ids(home.playable));
    }
  });

  it("'Keep watching' never shows a video the gate refuses", () => {
    const l = lib(MAYA, videos, cards, wl);
    const home = kidHome({ lib: l, settings: maya({ mode: "locked" }), recentIds: ["vAuto", "vBlocked", "vOk"], approvedIds: new Set(), taste, now: 0 });
    expect(ids(home.keepWatching)).toEqual(["vOk"]);
  });
});

describe("Review badge: pending decisions across all children", () => {
  // Maya (6, Open) and Leo (4, Locked) both block violence; Leo also has a lower age.
  const videos = [video("v1", CH_SONGS), video("v2", CH_SONGS), video("v3", CH_SONGS), video("v4", CH_OTHER), video("v5", CH_SONGS)];
  const cards = [card("v1", { tags: { violence: 3 } }), card("v2", { tags: { violence: 2 } }), card("v3", { ageMin: 5 }), card("v4"), card("v5")];
  const wl = [grant("channel", CH_SONGS), grant("override", "v2", MAYA)]; // Maya already allowed v2
  const req = (id: string, videoId: string, profileId?: string): WatchRequest => ({ id, familyId: FAM, videoId, profileId, status: "pending", createdAt: "2026-10-13T00:00:00Z" });
  const children = [
    { profile: { id: MAYA }, settings: maya(), lib: lib(MAYA, videos, cards, wl) },
    { profile: { id: LEO }, settings: leo(), lib: lib(LEO, videos, cards, wl) },
  ];
  const legacy: LegacyGrant[] = [{ id: "lg1", familyId: FAM, kind: "auto", targetId: "v5", createdAt: "", candidateProfileIds: [MAYA, LEO] }];
  const requests = [req("r1", "v1", MAYA), req("r2", "v4", LEO), req("r3", "v5")];
  const items = pendingDecisions({ requests, children, legacy });
  const keys = items.map((i) => i.key).sort();

  it("counts each child's decisions separately, with dedup", () => {
    expect(keys).toEqual([
      `h:${LEO}:v1`,      // Leo: v1 held by violence (Maya's v1 is covered by her request)
      `h:${LEO}:v2`,      // Leo: v2 held (Maya's allow is hers only)
      `h:${LEO}:v3`,      // Leo: v3 rated 5+, he's 4
      "l:lg1",            // an old record waiting to be assigned
      "r:r1",             // Maya asked for v1 (her held v1 is NOT counted again)
      "r:r2",             // Leo asked for v4
      "r:r3",             // a request that didn't record a child
    ].sort());
    expect(items).toHaveLength(7);
  });

  it("the total doesn't depend on which child is selected", () => {
    const reversed = pendingDecisions({ requests, children: [...children].reverse(), legacy });
    expect(reversed.map((i) => i.key).sort()).toEqual(keys);
  });

  it("filtering to one child: their requests + held items, plus unattributed requests and old records naming them", () => {
    expect(forChild(items, MAYA).map((i) => i.key).sort()).toEqual(["l:lg1", "r:r1", "r:r3"]);
    expect(forChild(items, LEO).map((i) => i.key).sort()).toEqual([`h:${LEO}:v1`, `h:${LEO}:v2`, `h:${LEO}:v3`, "l:lg1", "r:r2", "r:r3"].sort());
  });

  it("resolved requests, resolved old records and other families' children don't count", () => {
    const more = pendingDecisions({
      requests: [...requests, { ...req("r9", "v3", MAYA), status: "approved" }, req("r10", "v3", "someone-else")],
      children, legacy: [...legacy, { ...legacy[0], id: "lg2", resolvedAt: "2026-10-01" }],
    });
    expect(more).toHaveLength(7);
  });

  it("the parent layout's badge uses this function (not one child's view)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../src/app/parent/layout.tsx"), "utf8");
    expect(src).toMatch(/pendingDecisions\(/);
    expect(src).toMatch(/getLibraries\(/);
    expect(src).not.toMatch(/needsDecision\(x, settings\)/);
  });
});
