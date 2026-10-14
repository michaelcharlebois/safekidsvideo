// Version-1 AI reviews: what the gate actually does with them (regression for the staging plan's claim
// that they "show Couldn't be sure until re-reviewed" — they don't). Eligibility depends on the card's
// content (real model, complete well-formed findings, confidence), never on reviewer.version.
import { describe, expect, it } from "vitest";
import { authorize, buildLibrary, reviewEligibility, REASON } from "@/lib/gate";
import { playStatus } from "@/lib/status";
import { card, CH_SONGS, grant, maya, MAYA, video } from "./fixtures";
import type { ContentCard } from "@/lib/types";

const withVersion = (c: ContentCard, version: string): ContentCard => ({ ...c, reviewer: { ...c.reviewer, version } });
const v1 = (o: Parameters<typeof card>[1] = {}) => withVersion(card("vid0000001a", o), "1");
const v2 = (o: Parameters<typeof card>[1] = {}) => withVersion(card("vid0000001a", o), "2");
const libFor = (c: ContentCard) => buildLibrary({ videos: [video("vid0000001a", CH_SONGS)], channels: [], cards: [c], confirmations: [], whitelist: [grant("channel", CH_SONGS)], profileId: MAYA })[0];

describe("version-1 reviews at the gate", () => {
  it("a complete, confident version-1 card is eligible, exactly like version 2", () => {
    expect(reviewEligibility(v1())).toEqual({ eligible: true });
    expect(reviewEligibility(v1())).toEqual(reviewEligibility(v2()));
  });
  it("…so a library video with a clean version-1 card plays for a child whose rules it fits", () => {
    expect(authorize(libFor(v1()), maya()).allow).toBe(true);
    expect(playStatus(libFor(v1()), maya()).status).toBe("plays");
  });
  it("its findings still hold videos back (a blocked tag at intensity 2)", () => {
    expect(authorize(libFor(v1({ tags: { violence: 2 } })), maya()).allow).toBe(false);
  });
  it("what makes ANY review ineligible: low confidence, a sample model, an unassessed category — version is irrelevant", () => {
    expect(reviewEligibility(v1({ confidence: 0.2 })).reason).toBe(REASON.lowConfidence);
    expect(reviewEligibility(v2({ confidence: 0.2 })).reason).toBe(REASON.lowConfidence);
    expect(reviewEligibility(v1({ model: "sample" })).reason).toBe(REASON.unreviewed);
    const missing = { ...v1(), concerns: v1().concerns.slice(1) };
    expect(reviewEligibility(missing).reason).toBe(REASON.invalidReview);
    expect(reviewEligibility({ ...missing, reviewer: { ...missing.reviewer, version: "2" } }).reason).toBe(REASON.invalidReview);
  });
});
