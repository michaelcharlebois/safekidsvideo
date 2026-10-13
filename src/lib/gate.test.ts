import { describe, expect, it } from "vitest";
import { authorize, buildLibrary, canPlay, cardProblems, grantIndex, needsDecision, nextAuthorized, playableFor, reviewEligibility, REASON, screen } from "@/lib/gate";
import type { Confirmation, ContentCard, Video, WhitelistEntry } from "@/lib/types";
import { CH_OTHER, CH_SCIENCE, CH_SONGS, FAM, LEO, MAYA, card, grant, leo, maya, video } from "../../test/fixtures";

function lib(opts: { videos: Video[]; cards?: ContentCard[]; grants?: WhitelistEntry[]; confirmations?: Confirmation[]; profileId?: string }) {
  return buildLibrary({ videos: opts.videos, channels: [], cards: opts.cards ?? [], confirmations: opts.confirmations ?? [], whitelist: opts.grants ?? [], profileId: opts.profileId });
}
const one = (opts: Parameters<typeof lib>[0]) => lib(opts)[0];

const approvedChannels = [grant("channel", CH_SONGS), grant("channel", CH_SCIENCE)];

describe("review eligibility", () => {
  it.each([
    ["missing card", undefined, false],
    ["sample card", card("v", { model: "sample" }), false],
    ["low confidence", card("v", { confidence: 0.5 }), false],
    ["confidence exactly at threshold", card("v", { confidence: 0.7 }), true],
    ["malformed card", { ...card("v"), concerns: undefined } as unknown as ContentCard, false],
    ["real card", card("v"), true],
  ])("%s → eligible=%s", (_n, c, ok) => {
    expect(reviewEligibility(c as ContentCard | undefined).eligible).toBe(ok);
  });
});

describe("approved channel ≠ approval of its videos", () => {
  for (const [name, s] of [["Maya (open)", maya()], ["Maya (ask first)", maya({ mode: "open_ask" })], ["Leo (locked)", leo()]] as const) {
    it(`${name}: unreviewed video on an approved channel does not play`, () => {
      const v = one({ videos: [video("v1", CH_SONGS)], grants: approvedChannels, profileId: s.profileId });
      expect(v.inLibrary).toBe(true);
      expect(authorize(v, s)).toMatchObject({ allow: false, reasons: [REASON.unreviewed] });
    });
    it(`${name}: sample-reviewed video on an approved channel does not play`, () => {
      const v = one({ videos: [video("v1", CH_SONGS)], cards: [card("v1", { model: "sample" })], grants: approvedChannels, profileId: s.profileId });
      expect(canPlay(v, s)).toBe(false);
    });
    it(`${name}: low-confidence review does not play`, () => {
      const v = one({ videos: [video("v1", CH_SONGS)], cards: [card("v1", { confidence: 0.4 })], grants: approvedChannels, profileId: s.profileId });
      expect(authorize(v, s)).toMatchObject({ allow: false, reasons: [REASON.lowConfidence] });
    });
    it(`${name}: reviewed, passing video on an approved channel plays (basis: library)`, () => {
      const v = one({ videos: [video("v1", CH_SONGS)], cards: [card("v1")], grants: approvedChannels, profileId: s.profileId });
      expect(authorize(v, s)).toMatchObject({ allow: true, basis: "library" });
    });
  }
  it("the old hideUnreviewed=false escape hatch no longer lets unreviewed videos through", () => {
    const s = maya({ hideUnreviewed: false });
    const v = one({ videos: [video("v1", CH_SONGS)], grants: approvedChannels, profileId: MAYA });
    expect(canPlay(v, s)).toBe(false);
  });
});

describe("modes, for reviewed videos outside the library", () => {
  const base = { videos: [video("v1", CH_OTHER)], cards: [card("v1")] };
  it("Open: plays (basis: open)", () => expect(authorize(one({ ...base, profileId: MAYA }), maya())).toMatchObject({ allow: true, basis: "open" }));
  it("Ask First: does not play", () => expect(authorize(one({ ...base, profileId: MAYA }), maya({ mode: "open_ask" }))).toMatchObject({ allow: false, reasons: [REASON.notInLibrary] }));
  it("Locked: does not play", () => expect(authorize(one({ ...base, profileId: LEO }), leo())).toMatchObject({ allow: false, reasons: [REASON.notInLibrary] }));
});

describe("child rules", () => {
  const inLib = (c: ContentCard, profileId = MAYA) => one({ videos: [video(c.videoId, CH_SONGS)], cards: [c], grants: approvedChannels, profileId });
  it("blocked tag at intensity 2 is hidden", () => expect(authorize(inLib(card("v", { tags: { violence: 2 } })), maya()).reasons).toEqual(["Violence / fighting"]));
  it("blocked tag at intensity 1 still plays", () => expect(canPlay(inLib(card("v", { tags: { violence: 1 } })), maya())).toBe(true));
  it("unblocked tag at intensity 3 plays", () => expect(canPlay(inLib(card("v", { tags: { potty_humor: 3 } })), maya())).toBe(true));
  it("blocked format is hidden", () => expect(canPlay(inLib(card("v", { format: "gameplay_commentary" })), maya())).toBe(false));
  it("age minimum above the child is hidden", () => {
    expect(authorize(inLib(card("v", { ageMin: 5 }), LEO), leo())).toMatchObject({ allow: false, reasons: ["Rated for ages 5+"] });
    expect(canPlay(inLib(card("v", { ageMin: 5 }), MAYA), maya())).toBe(true);
  });
  it("age maximum is informational only", () => expect(canPlay(inLib(card("v", { ageMin: 2, ageMax: 3 })), maya())).toBe(true));
  it("a child with no age set fails closed", () => expect(authorize(inLib(card("v")), maya({ kidAge: undefined }))).toMatchObject({ allow: false, reasons: [REASON.noAge] }));
});

describe("peer feedback only restricts", () => {
  const conf = (vote: "missed" | "overcall", n: number): Confirmation[] =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, videoId: "v", familyId: `f${i}`, verdict: vote === "missed" ? "too_lenient" : "too_strict", tagVotes: { violence: vote }, createdAt: "" }));
  it("enough 'missed' votes hide a video the AI passed", () => {
    const v = one({ videos: [video("v", CH_SONGS)], cards: [card("v")], grants: approvedChannels, confirmations: conf("missed", 3), profileId: MAYA });
    expect(authorize(v, maya()).reasons).toEqual(["Violence / fighting"]);
  });
  it("enough 'over-called' votes do NOT clear an AI safety flag", () => {
    const v = one({ videos: [video("v", CH_SONGS)], cards: [card("v", { tags: { violence: 2 } })], grants: approvedChannels, confirmations: conf("overcall", 10), profileId: MAYA });
    expect(canPlay(v, maya())).toBe(false);
  });
});

describe("explicit approvals are child-scoped", () => {
  const grants = [...approvedChannels, grant("override", "v1", MAYA)];
  it("Allow for Maya plays for Maya even unreviewed and outside the library", () => {
    const v = one({ videos: [video("v1", CH_OTHER)], grants, profileId: MAYA });
    expect(authorize(v, maya({ mode: "locked" }))).toMatchObject({ allow: true, basis: "explicit" });
  });
  it("Allow for Maya overrides Maya's filters", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [card("v1", { tags: { violence: 3 } })], grants, profileId: MAYA });
    expect(canPlay(v, maya())).toBe(true);
  });
  it("Allow for Maya does NOT authorize Leo", () => {
    const v = one({ videos: [video("v1", CH_OTHER)], grants, profileId: LEO });
    expect(v.overridden).toBe(false);
    expect(canPlay(v, leo())).toBe(false);
  });
  it("a family-wide override row (pre-migration shape) grants nobody", () => {
    const v = one({ videos: [video("v1", CH_OTHER)], grants: [grant("override", "v1", null)], profileId: MAYA });
    expect(canPlay(v, maya({ mode: "locked" }))).toBe(false);
  });
});

describe("blocks", () => {
  it("block for Maya hides it for Maya only", () => {
    const g = [...approvedChannels, grant("block", "v1", MAYA)];
    const args = { videos: [video("v1", CH_SONGS)], cards: [card("v1")], grants: g };
    expect(authorize(one({ ...args, profileId: MAYA }), maya())).toMatchObject({ allow: false, reasons: [REASON.blocked] });
    expect(canPlay(one({ ...args, profileId: LEO }), leo())).toBe(true);
  });
  it("a family-wide block hides it for everyone", () => {
    const g = [...approvedChannels, grant("block", "v1", null)];
    const args = { videos: [video("v1", CH_SONGS)], cards: [card("v1")], grants: g };
    expect(canPlay(one({ ...args, profileId: MAYA }), maya())).toBe(false);
    expect(canPlay(one({ ...args, profileId: LEO }), leo())).toBe(false);
  });
  it("a block beats an explicit allow for the same child", () => {
    const g = [grant("override", "v1", MAYA), grant("block", "v1", MAYA)];
    expect(canPlay(one({ videos: [video("v1", CH_SONGS)], cards: [card("v1")], grants: g, profileId: MAYA }), maya())).toBe(false);
  });
  it("family channel approval + child block: channel stays, that video goes", () => {
    const g = [...approvedChannels, grant("block", "v2", LEO)];
    const all = lib({ videos: [video("v1", CH_SONGS), video("v2", CH_SONGS)], cards: [card("v1"), card("v2")], grants: g, profileId: LEO });
    expect(playableFor(all, leo()).map((v) => v.id)).toEqual(["v1"]);
  });
});

describe("open-mode clearances don't persist into stricter modes", () => {
  const g = [grant("auto", "v1", MAYA)];
  const args = { videos: [video("v1", CH_OTHER)], cards: [card("v1")], grants: g };
  it("Maya in Open: plays", () => expect(canPlay(one({ ...args, profileId: MAYA }), maya())).toBe(true));
  it("Maya switched to Ask First: does not play", () => expect(canPlay(one({ ...args, profileId: MAYA }), maya({ mode: "open_ask" }))).toBe(false));
  it("Maya switched to Locked: does not play", () => expect(canPlay(one({ ...args, profileId: MAYA }), maya({ mode: "locked" }))).toBe(false));
  it("Maya's clearance never reaches Leo", () => {
    const v = one({ ...args, profileId: LEO });
    expect(v.autoApproved).toBe(false);
    expect(v.whitelisted).toBe(false);
    expect(canPlay(v, leo())).toBe(false);
  });
});

describe("fail closed", () => {
  const args = { videos: [video("v1", CH_SONGS)], cards: [card("v1")], grants: approvedChannels };
  it("no child selected", () => expect(authorize(one({ ...args }), maya({ profileId: undefined as unknown as string }))).toMatchObject({ allow: false, reasons: [REASON.noChild] }));
  it("library built for a different child", () => expect(authorize(one({ ...args, profileId: LEO }), maya())).toMatchObject({ allow: false, reasons: [REASON.noChild] }));
  it("family-wide library (no child)", () => expect(canPlay(one({ ...args }), maya())).toBe(false));
});

describe("grant index scoping", () => {
  it("family-wide sources and restrictions apply to all; overrides and autos only to the named child", () => {
    const entries = [grant("channel", "c"), grant("video", "v"), grant("override", "o", MAYA), grant("auto", "a", MAYA), grant("block", "b"), grant("dismissed", "d", LEO)];
    const m = grantIndex(entries, MAYA), l = grantIndex(entries, LEO), fam = grantIndex(entries, undefined);
    expect([...m.channels, ...m.videos, ...m.overrides, ...m.autos, ...m.blocks]).toEqual(["c", "v", "o", "a", "b"]);
    expect(m.dismissed.size).toBe(0);
    expect([...l.overrides, ...l.autos]).toEqual([]);
    expect([...l.dismissed]).toEqual(["d"]);
    expect([...fam.overrides, ...fam.autos, ...fam.dismissed]).toEqual([]);
  });
});

describe("advancing re-derives from a fresh playable list", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("next in original order", () => expect(nextAuthorized(items, "b", ["a", "b", "c", "d"])?.id).toBe("c"));
  it("skips a video restricted since the playlist was built", () => {
    const fresh = items.filter((x) => x.id !== "c");
    expect(nextAuthorized(fresh, "b", ["a", "b", "c", "d"])?.id).toBe("d");
  });
  it("wraps around", () => expect(nextAuthorized(items, "d", ["a", "b", "c", "d"])?.id).toBe("a"));
  it("current video itself was restricted: move on", () => expect(nextAuthorized(items.filter((x) => x.id !== "b"), "b", ["a", "b", "c", "d"])?.id).toBe("c"));
  it("nothing playable → null", () => expect(nextAuthorized([], "b", ["a", "b"])).toBeNull());
});

describe('"Keep hidden" is a standing restriction for that child', () => {
  // Maya's settings block "scary_imagery"; the first review flagged it, so the parent chose "Keep hidden".
  const hiddenForMaya = [...approvedChannels, grant("dismissed", "v1", MAYA)];
  const scary = card("v1", { tags: { scary_imagery: 2 } });
  const clean = card("v1"); // re-review: nothing flagged

  it("hidden while the review flags it", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [scary], grants: hiddenForMaya, profileId: MAYA });
    expect(authorize(v, maya())).toMatchObject({ allow: false, reasons: [REASON.keptHidden] });
  });
  it("REGRESSION: stays hidden after a more favorable re-review", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [clean], grants: hiddenForMaya, profileId: MAYA });
    expect(authorize(v, maya())).toMatchObject({ allow: false, reasons: [REASON.keptHidden] });
  });
  it("REGRESSION: stays hidden after the parent relaxes Maya's filters", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [scary], grants: hiddenForMaya, profileId: MAYA });
    expect(canPlay(v, maya({ blockedTags: [] }))).toBe(false);
  });
  it("stays hidden in every mode, and out of open-mode search results", () => {
    const v = one({ videos: [video("v1", CH_OTHER)], cards: [clean], grants: [grant("dismissed", "v1", MAYA)], profileId: MAYA });
    for (const mode of ["open", "open_ask", "locked"] as const) expect(canPlay(v, maya({ mode }))).toBe(false);
    expect(screen(v, maya())).toMatchObject({ pass: false, reasons: [REASON.keptHidden] });
  });
  it("is only for that child: Leo still sees it", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [clean], grants: hiddenForMaya, profileId: LEO });
    expect(canPlay(v, leo())).toBe(true);
  });
  it("leaves the review queue (no repeated asking)", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [scary], grants: hiddenForMaya, profileId: MAYA });
    expect(needsDecision(v, maya())).toBe(false);
  });
  it("an explicit Allow for that child replaces it", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [scary], grants: [...approvedChannels, grant("override", "v1", MAYA)], profileId: MAYA });
    expect(authorize(v, maya())).toMatchObject({ allow: true, basis: "explicit" });
  });
  it("a family-wide (pre-0018) Keep hidden applies to every child", () => {
    const g = [...approvedChannels, grant("dismissed", "v1")];
    expect(canPlay(one({ videos: [video("v1", CH_SONGS)], cards: [clean], grants: g, profileId: MAYA }), maya())).toBe(false);
    expect(canPlay(one({ videos: [video("v1", CH_SONGS)], cards: [clean], grants: g, profileId: LEO }), leo())).toBe(false);
  });
  it("undoing it (row removed) returns the video to the normal rules", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [clean], grants: approvedChannels, profileId: MAYA });
    expect(canPlay(v, maya())).toBe(true);
  });
});

describe("malformed AI reviews fail closed through authorize()", () => {
  // Each card is otherwise perfect, on an approved channel, for Maya in Open mode — it would play if valid.
  const playsIfValid = (c: unknown) => authorize(one({ videos: [video("v1", CH_SONGS)], cards: [c as ContentCard], grants: approvedChannels, profileId: MAYA }), maya());
  const good = card("v1");
  const without = (k: string) => { const c: Record<string, unknown> = { ...good }; delete c[k]; return c; };
  const withConcerns = (f: (cs: ContentCard["concerns"]) => unknown) => ({ ...good, concerns: f(good.concerns.map((x) => ({ ...x }))) });

  it("baseline: the valid card plays", () => expect(playsIfValid(good)).toMatchObject({ allow: true }));

  it.each([
    ["no ageFit", without("ageFit")],
    ["ageFit null", { ...good, ageFit: null }],
    ["age min missing", { ...good, ageFit: { max: 8 } }],
    ["age min a string", { ...good, ageFit: { min: "3", max: 8 } }],
    ["age min NaN", { ...good, ageFit: { min: NaN, max: 8 } }],
    ["age min negative", { ...good, ageFit: { min: -1, max: 8 } }],
    ["age min fractional", { ...good, ageFit: { min: 2.5, max: 8 } }],
    ["age min absurd", { ...good, ageFit: { min: 99, max: 99 } }],
    ["age min > max", { ...good, ageFit: { min: 6, max: 4 } }],
    ["age max missing", { ...good, ageFit: { min: 3 } }],
    ["no confidence", without("confidence")],
    ["confidence NaN", { ...good, confidence: NaN }],
    ["confidence Infinity", { ...good, confidence: Infinity }],
    ["confidence > 1", { ...good, confidence: 1.5 }],
    ["confidence 90 (percent, not fraction)", { ...good, confidence: 90 }],
    ["confidence negative", { ...good, confidence: -0.2 }],
    ["confidence a string", { ...good, confidence: "0.9" }],
    ["no format", without("format")],
    ["unknown format", { ...good, format: "gamplay" }],
    ["no concerns", without("concerns")],
    ["concerns not an array", { ...good, concerns: { violence: 0 } }],
    ["concerns empty (nothing assessed)", withConcerns(() => [])],
    ["a tag not assessed", withConcerns((cs) => cs.filter((x) => x.tag !== "violence"))],
    ["a duplicated tag", withConcerns((cs) => [...cs, { ...cs[0] }])],
    ["an unknown tag", withConcerns((cs) => [...cs, { tag: "gore", present: true, intensity: 3 }])],
    ["a null finding", withConcerns((cs) => [...cs, null])],
    ["intensity out of range", withConcerns((cs) => cs.map((x) => (x.tag === "violence" ? { ...x, intensity: 7 } : x)))],
    ["intensity a string", withConcerns((cs) => cs.map((x) => (x.tag === "violence" ? { ...x, intensity: "2" } : x)))],
    ["present not a boolean", withConcerns((cs) => cs.map((x) => (x.tag === "violence" ? { ...x, present: "no" } : x)))],
    ["reviewer missing", without("reviewer")],
    ["reviewer model blank", { ...good, reviewer: { ...good.reviewer, model: "  " } }],
    ["not an object at all", "card"],
  ])("%s → denied", (_name, c) => {
    const d = playsIfValid(c);
    expect(d.allow).toBe(false);
    expect([REASON.invalidReview, REASON.unreviewed]).toContain(d.reasons[0]);
  });

  it("malformed reviews are reported as incomplete (so the parent sees why)", () => {
    expect(playsIfValid({ ...good, confidence: 2 })).toMatchObject({ reasons: [REASON.invalidReview] });
    expect(cardProblems({ ...good, confidence: 2 })).toEqual(["confidence invalid"]);
    expect(cardProblems(good)).toEqual([]);
  });

  it("a malformed card can't open the door in Open mode either", () => {
    const v = one({ videos: [video("v1", CH_OTHER)], cards: [{ ...good, ageFit: { min: NaN, max: 8 } } as unknown as ContentCard], profileId: MAYA });
    expect(canPlay(v, maya())).toBe(false);
    expect(screen(v, maya()).pass).toBe(false);
  });

  it("an explicit Allow for the child still works (the parent's deliberate decision)", () => {
    const v = one({ videos: [video("v1", CH_SONGS)], cards: [{ ...good, confidence: NaN } as ContentCard], grants: [...approvedChannels, grant("override", "v1", MAYA)], profileId: MAYA });
    expect(authorize(v, maya())).toMatchObject({ allow: true, basis: "explicit" });
  });

  it("a finding with intensity ≥ 2 counts even if `present` says false", () => {
    const c = withConcerns((cs) => cs.map((x) => (x.tag === "violence" ? { ...x, present: false, intensity: 3 } : x)));
    expect(playsIfValid(c)).toMatchObject({ allow: false, reasons: ["Violence / fighting"] });
  });
});

describe("family id is carried through", () => it("fixtures use one family", () => expect(FAM).toBe("fam-1")));
