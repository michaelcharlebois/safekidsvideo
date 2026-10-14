// Library selector: one child's full inventory, with every status the gate can give, filters, search and
// channel grouping. Statuses come only from the gate.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readyFor } from "@/lib/kid-home";
import { buildLibrary, canPlay } from "@/lib/gate";
import { filterLibrary, groupByChannel, isLibraryFilter, libraryCounts, libraryFor } from "@/lib/library";
import type { Channel } from "@/lib/types";
import { CH_OTHER, CH_SCIENCE, CH_SONGS, LEO, MAYA, card, grant, leo, maya, video } from "./fixtures";

const channels: Channel[] = [
  { id: CH_SONGS, title: "Songs", createdAt: "" } as Channel,
  { id: CH_SCIENCE, title: "Science Kids", createdAt: "" } as Channel,
];
const videos = [
  video("ok1", CH_SONGS, { publishedAt: "2026-10-05" }), video("ok2", CH_SCIENCE, { publishedAt: "2026-10-04", title: "Volcanoes" }),
  video("viol", CH_SONGS, { publishedAt: "2026-10-03" }), video("unsure", CH_SONGS), video("none", CH_SCIENCE),
  video("hid", CH_SONGS), video("blk", CH_SONGS), video("mine", CH_OTHER), video("outside", CH_OTHER),
];
const cards = [card("ok1"), card("ok2"), card("viol", { tags: { violence: 3 } }), card("unsure", { confidence: 0.3 }), card("hid"), card("blk"), card("mine", { tags: { violence: 3 } }), card("outside")];
const wl = [grant("channel", CH_SONGS), grant("channel", CH_SCIENCE), grant("dismissed", "hid", MAYA), grant("block", "blk", MAYA), grant("override", "mine", MAYA)];
const lib = (pid: string) => buildLibrary({ videos, channels, cards, confirmations: [], whitelist: wl, profileId: pid });

describe("Library for one child", () => {
  const items = libraryFor(lib(MAYA), maya());
  const status = Object.fromEntries(items.map((i) => [i.v.id, i.status]));

  it("covers every library status, each from the gate", () => {
    expect(status).toEqual({ ok1: "plays", ok2: "plays", viol: "held", unsure: "uncertain", none: "reviewing", hid: "hidden", blk: "blocked", mine: "allowed" });
    for (const i of items) expect(canPlay(i.v, maya())).toBe(i.status === "plays" || i.status === "allowed");
  });

  it("a video outside the family's sources and not allowed isn't in the library at all", () => {
    expect(status.outside).toBeUndefined();
  });

  it("counts match the filters, and 'all' is the whole library", () => {
    const c = libraryCounts(items);
    expect(c).toMatchObject({ all: 8, plays: 2, allowed: 1, held: 1, uncertain: 1, reviewing: 1, hidden: 1, blocked: 1 });
    for (const f of ["plays", "allowed", "held", "uncertain", "reviewing", "hidden", "blocked"] as const) expect(filterLibrary(items, { filter: f })).toHaveLength(c[f]);
  });

  it("search matches title or channel name; channel filter narrows to one source", () => {
    expect(filterLibrary(items, { q: "volcano" }).map((i) => i.v.id)).toEqual(["ok2"]);
    expect(filterLibrary(items, { q: "science kids" }).map((i) => i.v.id).sort()).toEqual(["none", "ok2"]);
    expect(filterLibrary(items, { channelId: CH_SCIENCE, filter: "plays" }).map((i) => i.v.id)).toEqual(["ok2"]);
  });

  it("groups by channel in the child's order and says how many of each channel play", () => {
    const held = filterLibrary(items, { filter: "held" });
    const g = groupByChannel(held, items, [CH_SCIENCE, CH_SONGS]);
    expect(g.map((x) => [x.channelId, x.items.length, x.plays, x.total])).toEqual([[CH_SONGS, 1, 1, 5]]);
    expect(groupByChannel(items, items, [CH_SCIENCE, CH_SONGS]).map((x) => x.channelId)).toEqual([CH_SCIENCE, CH_SONGS, CH_OTHER]);
  });

  it("is per child: Maya's decisions don't show up in Leo's library", () => {
    const leoStatus = Object.fromEntries(libraryFor(lib(LEO), leo()).map((i) => [i.v.id, i.status]));
    expect(leoStatus.hid).toBe("plays");
    expect(leoStatus.blk).toBe("plays");
    expect(leoStatus.mine).toBeUndefined(); // Maya's allow isn't Leo's
  });

  it("Home's numbers are exactly the Library lists they open", () => {
    const c = libraryCounts(items);
    expect(c.ready).toBe(c.plays + c.allowed);
    expect(c.held_any).toBe(c.held + c.uncertain);
    expect(filterLibrary(items, { filter: "ready" }).map((i) => i.status).sort()).toEqual(["allowed", "plays", "plays"]);
    expect(filterLibrary(items, { filter: "held_any" }).map((i) => i.status).sort()).toEqual(["held", "uncertain"]);
    // "Ready" is the kid screen's playable set
    expect(c.ready).toBe(readyFor(lib(MAYA), maya()).length);
    const home = readFileSync(path.resolve(import.meta.dirname, "../src/app/parent/page.tsx"), "utf8");
    expect(home).toMatch(/status=ready/);
    expect(home).toMatch(/status=held_any/);
    expect(home).not.toMatch(/status=plays"|status=held"/);
  });

  it("only known filters are accepted from the URL", () => {
    expect(isLibraryFilter("held")).toBe(true);
    expect(isLibraryFilter("outside")).toBe(false);
    expect(isLibraryFilter("ready")).toBe(true);
    expect(isLibraryFilter("held_any")).toBe(true);
    expect(isLibraryFilter(undefined)).toBe(false);
  });
});
