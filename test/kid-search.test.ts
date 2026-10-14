import { describe, expect, it } from "vitest";
import { buildLibrary } from "@/lib/gate";
import { copyFor, searchState } from "@/lib/kid-search";
import { CH_OTHER, CH_SONGS, MAYA, card, grant, maya, video } from "./fixtures";

const videos = [video("ok", CH_SONGS), video("viol", CH_SONGS), video("unsure", CH_SONGS), video("new", CH_OTHER), video("never", CH_SONGS), video("fine", CH_OTHER)];
const cards = [card("ok"), card("viol", { tags: { violence: 3 } }), card("unsure", { confidence: 0.4 }), card("never"), card("fine")];
const lib = (wl = [grant("channel", CH_SONGS), grant("block", "never", MAYA)]) => buildLibrary({ videos, channels: [], cards, confirmations: [], whitelist: wl, profileId: MAYA });
const st = (id: string | undefined, mode: "open" | "open_ask" | "locked", o = { pending: false, declined: false }) =>
  searchState(id ? lib().find((v) => v.id === id) : undefined, maya({ mode }), o);

describe("kid search states come from the gate", () => {
  it("Open: plays, needs checking, needs a grown-up for a reason", () => {
    expect(st("ok", "open").kind).toBe("play");
    expect(st("fine", "open").kind).toBe("play");          // reviewed and passes: Open lets it play
    expect(st(undefined, "open").kind).toBe("check");       // not in Brightframe yet
    expect(st("new", "open").kind).toBe("check");           // no review
    expect(st("viol", "open")).toEqual({ kind: "ask", why: "settings" });
    expect(st("unsure", "open")).toEqual({ kind: "ask", why: "unsure" });
  });
  it("Ask first: anything not already playable needs a grown-up first — never 'check and play'", () => {
    expect(st("ok", "open_ask").kind).toBe("play");
    for (const id of [undefined, "new", "fine", "viol", "unsure"]) expect(st(id, "open_ask")).toEqual({ kind: "ask", why: "parent-first" });
  });
  it("a pending ask shows as waiting (never as playable); a recent no shows as not this time; never means never", () => {
    expect(st("viol", "open", { pending: true, declined: false }).kind).toBe("waiting");
    expect(st("viol", "open", { pending: false, declined: true }).kind).toBe("declined");
    expect(st("never", "open", { pending: true, declined: false }).kind).toBe("blocked");
    expect(st("ok", "open", { pending: true, declined: false }).kind).toBe("play"); // approved since: it plays
  });
  it("only some states offer an action, and the words match", () => {
    expect(copyFor({ kind: "waiting" }).action).toBeUndefined();
    expect(copyFor({ kind: "declined" }).action).toBeUndefined();
    expect(copyFor({ kind: "blocked" }).action).toBeUndefined();
    expect(copyFor({ kind: "check" }).action).toBe("Check it");
    expect(copyFor({ kind: "ask", why: "settings" }).note).toMatch(/settings/);
  });
});
