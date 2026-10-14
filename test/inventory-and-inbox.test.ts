// Shared selectors: the parent dashboard and the kid home screen select the same child's content, and the
// Review inbox holds only requests and old records (automatic holds are Library statuses).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildLibrary, canPlay } from "@/lib/gate";
import { inventoryFor, kidHome, readyFor } from "@/lib/kid-home";
import { forChild, inboxOrder, isChildRequest, pendingDecisions, requestsFrom } from "@/lib/inbox";
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

describe("Review: requests and old records only (automatic holds live in Library)", () => {
  // Maya (6, Open) and Leo (4, Locked) both block violence. v1–v3 and v6 are held back automatically for
  // someone (violence, age, an uncertain review, a video added one by one); none of that is a Review task.
  const videos = [video("v1", CH_SONGS), video("v2", CH_SONGS), video("v3", CH_SONGS), video("v4", CH_OTHER), video("v5", CH_SONGS), video("v6", CH_OTHER)];
  const cards = [card("v1", { tags: { violence: 3 } }), card("v2", { tags: { violence: 2 } }), card("v3", { ageMin: 5 }), card("v4"), card("v5"), card("v6", { confidence: 0.4 })];
  const wl = [grant("channel", CH_SONGS), grant("video", "v6"), grant("override", "v2", MAYA)];
  const req = (id: string, videoId: string, profileId?: string, createdAt = "2026-10-13T00:00:00Z"): WatchRequest => ({ id, familyId: FAM, videoId, profileId, status: "pending", createdAt });
  const legacy: LegacyGrant[] = [{ id: "lg1", familyId: FAM, kind: "auto", targetId: "v5", createdAt: "2026-01-01T00:00:00Z", candidateProfileIds: [MAYA, LEO] }];
  const requests = [req("r1", "v1", MAYA), req("r2", "v4", LEO, "2026-10-12T00:00:00Z"), req("r3", "v5")];
  const childIds = [MAYA, LEO];
  const items = pendingDecisions({ requests, childIds, legacy });
  const keys = items.map((i) => i.key).sort();

  it("contains each pending request and each unresolved old record — nothing else", () => {
    expect(keys).toEqual(["l:lg1", "r:r1", "r:r2", "r:r3"]);
  });

  it("automatically held videos create no Review item: channel holds, a directly added video, an uncertain review", () => {
    const kids = [{ s: maya(), id: MAYA }, { s: leo(), id: LEO }];
    // Sanity: these really are held back for someone right now.
    const held = kids.flatMap(({ s, id }) => lib(id, videos, cards, wl).filter((v) => v.inLibrary && !canPlay(v, s)).map((v) => `${id}:${v.id}`));
    expect(held).toEqual(expect.arrayContaining([`${LEO}:v1`, `${LEO}:v3`, `${MAYA}:v6`, `${LEO}:v6`]));
    expect(pendingDecisions({ requests: [], childIds, legacy: [] })).toEqual([]);
    expect(items.some((i) => ["v2", "v3", "v6"].includes(i.videoId))).toBe(false);
  });

  it("the library statuses say why, with uncertain reviews kept separate from filter holds", () => {
    const l = lib(LEO, videos, cards, wl);
    const st = (id: string) => playStatus(l.find((v) => v.id === id)!, leo()).status;
    expect(st("v1")).toBe("held");     // violence, for Leo
    expect(st("v3")).toBe("held");     // rated 5+, he's 4
    expect(st("v6")).toBe("uncertain"); // a real review with low confidence
    expect(playStatus(lib(LEO, [video("v7", CH_SONGS)], [], wl)[0], leo()).status).toBe("reviewing"); // no review at all
  });

  it("a child's own count is only the requests they made; unattributed and old records stay separate", () => {
    expect(requestsFrom(items, MAYA).map((i) => i.key)).toEqual(["r:r1"]);
    expect(requestsFrom(items, LEO).map((i) => i.key)).toEqual(["r:r2"]);
    expect(items.filter(isChildRequest).map((i) => i.key).sort()).toEqual(["r:r1", "r:r2"]);
  });

  it("filtering Review to one child also shows historical items that may concern them, labelled as such", () => {
    expect(forChild(items, MAYA).map((i) => i.key).sort()).toEqual(["l:lg1", "r:r1", "r:r3"]);
    expect(forChild(items, LEO).map((i) => i.key).sort()).toEqual(["l:lg1", "r:r2", "r:r3"]);
  });

  it("order: named children's requests newest first, then older unattributed requests, then old records", () => {
    expect([...items].sort(inboxOrder).map((i) => i.key)).toEqual(["r:r1", "r:r2", "r:r3", "l:lg1"]);
  });

  it("resolved requests, resolved old records and other families' children don't count", () => {
    const more = pendingDecisions({
      requests: [...requests, { ...req("r9", "v3", MAYA), status: "approved" }, req("r10", "v3", "someone-else")],
      childIds, legacy: [...legacy, { ...legacy[0], id: "lg2", resolvedAt: "2026-10-01" }],
    });
    expect(more).toHaveLength(4);
  });

  it("the badge, Kids and Review count without reading any child's library (no catalogue scan)", () => {
    const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
    const layout = read("src/app/parent/layout.tsx");
    expect(layout).toMatch(/pendingDecisions\(/);
    expect(layout).not.toMatch(/getLibraries|getLibrary\(/);
    expect(layout).toMatch(/requestsFrom\(/);
    const review = read("src/app/parent/review/page.tsx");
    expect(review).not.toMatch(/getLibraries\(/);
    expect(review).toMatch(/getLibrariesFor\(/);
    expect(read("src/lib/kid-facts.ts")).toMatch(/requestsFrom\(/);
  });
});
