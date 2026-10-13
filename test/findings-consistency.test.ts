// One meaning of "the AI found X" across review normalization, the gate, explanations and the UI.
// Intensity decides; a contradictory `present` flag can neither hide a restriction nor invent one.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { authorize, buildLibrary, foundConcerns, REASON } from "@/lib/gate";
import { normalizeReview, REVIEWER_VERSION } from "@/lib/reviewer";
import { holdExplanation } from "@/lib/explain";
import { Assessment } from "@/app/parent/assessment";
import { CONCERN_TAGS, type ContentCard } from "@/lib/types";
import { CH_SONGS, MAYA, card, grant, maya, video } from "./fixtures";

const lib = (c: ContentCard, flags: Record<string, number> = {}) => {
  const confirmations = Object.entries(flags).flatMap(([tag, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, videoId: c.videoId, familyId: `f${i}`, verdict: "flag" as const, tagVotes: { [tag]: "missed" as const }, createdAt: "" })));
  return buildLibrary({ videos: [video(c.videoId, CH_SONGS)], channels: [], cards: [c], confirmations, whitelist: [grant("channel", CH_SONGS)], profileId: MAYA })[0];
};
const withFinding = (tag: string, present: boolean, intensity: 0 | 1 | 2 | 3): ContentCard => {
  const c = card("v1");
  return { ...c, concerns: c.concerns.map((f) => (f.tag === tag ? { ...f, present, intensity, timestamp: "2:05", evidence: "A fight scene." } : f)) };
};
const html = (c: ContentCard) => renderToStaticMarkup(createElement(Assessment, { v: lib(c) }));

describe("contradictory AI findings", () => {
  it("present:false with strong intensity BLOCKS, and every surface shows it", () => {
    const c = withFinding("violence", false, 3);
    const v = lib(c);
    expect(authorize(v, maya())).toMatchObject({ allow: false, reasons: ["Violence / fighting"] });
    expect(foundConcerns(c).map((f) => f.tag)).toEqual(["violence"]);
    const why = holdExplanation(v, maya())!;
    expect(why.summary).toMatch(/AI review found violence \/ fighting \(strong\)/);
    expect(why.evidence[0]).toMatchObject({ label: "Violence / fighting", source: "ai", severity: "Strong", timestamp: "2:05" });
    expect(html(c)).toContain("Violence / fighting");
    expect(html(c)).toContain("Strong");
  });

  it("present:true with intensity 0 is NOT a finding: doesn't block, isn't shown", () => {
    const c = withFinding("violence", true, 0);
    expect(authorize(lib(c), maya())).toMatchObject({ allow: true });
    expect(foundConcerns(c)).toEqual([]);
    expect(holdExplanation(lib(c), maya())).toBeNull();
    expect(html(c)).not.toContain(">Violence / fighting<");
  });

  it("a mild finding is shown but doesn't hold the video back", () => {
    const c = withFinding("violence", true, 1);
    expect(authorize(lib(c), maya())).toMatchObject({ allow: true });
    expect(html(c)).toContain("Mild");
  });

  it("review normalization derives `present` from intensity in both directions", () => {
    const concerns = CONCERN_TAGS.map((tag) => ({ tag, present: tag === "monsters", intensity: tag === "violence" ? 2 : 0 }));
    const text = JSON.stringify({ synopsis: "s", format: "song", ageFit: { min: 2, max: 6 }, concerns, pace: "calm", educationalValue: 3, rating: 4, parentRecommendation: "ok", confidence: 0.9 });
    const out = normalizeReview(text, { videoId: "v1", reviewer: { model: "m", version: REVIEWER_VERSION, reviewedAt: "" } });
    expect(out.concerns.find((f) => f.tag === "violence")).toMatchObject({ present: true, intensity: 2 });
    expect(out.concerns.find((f) => f.tag === "monsters")).toMatchObject({ present: false, intensity: 0 });
  });
});

describe("explanations name the real reason and its source", () => {
  it("other parents' flags are never attributed to the AI", () => {
    const v = lib(card("v1"), { scary_imagery: 3 }); // AI found nothing; 3 parents flagged it (threshold 3)
    const why = holdExplanation(v, maya())!;
    expect(why.summary).toMatch(/^Other parents reported scary imagery/);
    expect(why.summary).not.toMatch(/AI review found/);
    expect(why.evidence).toEqual([expect.objectContaining({ label: "Scary imagery", source: "parents", parents: 3 })]);
  });

  it("age, format, low confidence and incomplete reviews each get their own wording", () => {
    expect(holdExplanation(lib(card("v1", { ageMin: 8 })), maya())!.summary).toBe("The AI review suggests ages 8 and up; Maya is 6.");
    expect(holdExplanation(lib(card("v1", { format: "gameplay_commentary" })), maya())!.summary).toMatch(/gameplay commentary .* a kind Maya's settings hold back/i);
    expect(holdExplanation(lib(card("v1", { confidence: 0.55 })), maya())!.summary).toBe("The AI review wasn't confident enough (55%) to rely on.");
    expect(holdExplanation(lib({ ...card("v1"), confidence: Number.NaN }), maya())!.summary).toMatch(/came back incomplete/);
    expect(holdExplanation(lib(card("v1", { model: "sample" })), maya())!.summary).toMatch(/sample card/);
  });

  it("AI and parents together are attributed to both", () => {
    const why = holdExplanation(lib(withFinding("violence", true, 2), { violence: 4 }), maya())!;
    expect(why.evidence[0]).toMatchObject({ source: "ai", parents: 4, severity: "Moderate" });
  });

  it("the gate's reasons and the explanation agree on what holds it back", () => {
    const v = lib(card("v1", { ageMin: 8, format: "gameplay_commentary", tags: { violence: 3 } }));
    const d = authorize(v, maya());
    expect(d.reasons).toEqual(["Rated for ages 8+", "Gameplay commentary (Minecraft, Roblox, etc.)", "Violence / fighting"]);
    expect(holdExplanation(v, maya())!.evidence.map((e) => e.label)).toEqual(["Violence / fighting", "Ages 8+", "Gameplay commentary (Minecraft, Roblox, etc.)"]);
    expect(d.reasons).not.toContain(REASON.unreviewed);
  });
});
