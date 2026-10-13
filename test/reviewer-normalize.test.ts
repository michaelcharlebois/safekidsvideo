// The AI-response layer: a review is accepted only if the model genuinely assessed every concern tag
// exactly once. Nothing is synthesized; incomplete answers are rejected (and so never stored).
import { describe, expect, it } from "vitest";
import { IncompleteReviewError, normalizeReview, REVIEWER_VERSION } from "@/lib/reviewer";
import { reviewEligibility } from "@/lib/gate";
import { CONCERN_TAGS } from "@/lib/types";

const meta = { videoId: "vvvvvvvvvv1", reviewer: { model: "gemini-test", version: REVIEWER_VERSION, reviewedAt: "2026-10-13T00:00:00Z" } };
const finding = (tag: string, intensity = 0) => ({ tag, present: intensity > 0, intensity, ...(intensity ? { timestamp: "0:10", evidence: "seen" } : {}) });
function response(concerns: unknown[] = CONCERN_TAGS.map((t) => finding(t)), extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    synopsis: "s", format: "song", ageFit: { min: 2, max: 6 }, concerns, pace: "calm",
    educationalValue: 3, rating: 4, parentRecommendation: "ok", confidence: 0.9, ...extra,
  });
}
const rejects = (text: string | null) => {
  try { normalizeReview(text, meta); } catch (e) { expect(e).toBeInstanceOf(IncompleteReviewError); return (e as IncompleteReviewError).problems; }
  throw new Error("expected IncompleteReviewError");
};

describe("normalizeReview — completeness", () => {
  it("accepts a complete review, in taxonomy order, eligible at the gate", () => {
    const shuffled = [...CONCERN_TAGS].reverse().map((t) => finding(t, t === "violence" ? 2 : 0));
    const card = normalizeReview(response(shuffled), meta);
    expect(card.concerns.map((c) => c.tag)).toEqual([...CONCERN_TAGS]);
    expect(card.concerns.find((c) => c.tag === "violence")).toMatchObject({ present: true, intensity: 2 });
    expect(reviewEligibility(card).eligible).toBe(true);
  });

  it("REGRESSION: a missing tag is rejected, not filled in as 'absent'", () => {
    const problems = rejects(response(CONCERN_TAGS.filter((t) => t !== "scary_imagery").map((t) => finding(t))));
    expect(problems).toContain("scary_imagery not assessed");
  });

  it("several missing tags are all named", () => {
    const problems = rejects(response(CONCERN_TAGS.slice(0, 3).map((t) => finding(t))));
    expect(problems.filter((p) => p.endsWith("not assessed"))).toHaveLength(CONCERN_TAGS.length - 3);
  });

  it("an empty concerns list is rejected", () => {
    expect(rejects(response([]))).toContain("violence not assessed");
  });

  it("a duplicated tag is rejected, even when the copies disagree", () => {
    const problems = rejects(response([...CONCERN_TAGS.map((t) => finding(t)), finding("violence", 3)]));
    expect(problems).toContain("violence assessed 2 times");
  });

  it("a duplicate that replaces a missing tag (right count, wrong set) is rejected", () => {
    const list = CONCERN_TAGS.map((t) => finding(t === "monsters" ? "violence" : t));
    const problems = rejects(response(list));
    expect(problems).toEqual(expect.arrayContaining(["monsters not assessed", "violence assessed 2 times"]));
  });

  it("an unknown tag, a bad intensity or a non-boolean present is rejected", () => {
    rejects(response([...CONCERN_TAGS.map((t) => finding(t)).slice(1), finding("gore", 3)]));
    rejects(response(CONCERN_TAGS.map((t) => ({ ...finding(t), intensity: t === "violence" ? 5 : 0 }))));
    rejects(response(CONCERN_TAGS.map((t) => ({ ...finding(t), present: t === "violence" ? "yes" : false }))));
  });

  it("missing essentials or out-of-range values are rejected", () => {
    rejects(response(undefined, { confidence: 1.4 }));
    rejects(response(undefined, { confidence: undefined }));
    rejects(response(undefined, { ageFit: { min: 7, max: 3 } }));
    rejects(response(undefined, { ageFit: undefined }));
    rejects(response(undefined, { format: "podcast" }));
  });

  it("empty, null and non-JSON responses are rejected", () => {
    expect(rejects(null)).toEqual(["empty response"]);
    expect(rejects("  ")).toEqual(["empty response"]);
    expect(rejects("Sorry, I can't watch that video.")).toEqual(["response is not JSON"]);
  });

  it("new reviews carry the strict reviewer version", () => {
    expect(REVIEWER_VERSION).toBe("2");
    expect(normalizeReview(response(), meta).reviewer.version).toBe("2");
  });
});
