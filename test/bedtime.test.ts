// Bedtime and the one-night extension: nights and the 4 AM rollover, bedtimes after midnight, time zones,
// daylight-saving nights, the authorized cutoff surviving a changed bedtime, cancellation, the 60-min cap.
import { describe, expect, it } from "vitest";
import { bedtimeNow, extensionChoices, extensionCutoff, nightOf, nightWindow, zonedInstant, type BedtimeExtension } from "@/lib/bedtime";

const LA = "America/Los_Angeles", NY = "America/New_York";
const at = (iso: string) => new Date(iso);
const ext = (o: Partial<BedtimeExtension>): BedtimeExtension => ({ id: "e", familyId: "f", profileId: "maya", night: "2026-10-13", baseBedtime: "19:30", extraMinutes: 30, cutoffAt: "2026-10-14T03:00:00.000Z", createdAt: "", ...o });

describe("nights and the rollover", () => {
  it("before 04:00 local it's still last night", () => {
    expect(nightOf(at("2026-10-14T10:59:00Z"), LA)).toBe("2026-10-13"); // 03:59 PDT
    expect(nightOf(at("2026-10-14T11:00:00Z"), LA)).toBe("2026-10-14"); // 04:00 PDT
  });
  it("a 19:30 bedtime: scheduled 19:30 local, ends 04:00 next morning", () => {
    const w = nightWindow("2026-10-13", "19:30", LA)!;
    expect(w.scheduled.toISOString()).toBe("2026-10-14T02:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-14T11:00:00.000Z");
  });
  it("in bedtime from the scheduled time until 04:00, not before or after", () => {
    expect(bedtimeNow(at("2026-10-14T02:29:00Z"), "19:30", LA).inBedtime).toBe(false);
    expect(bedtimeNow(at("2026-10-14T02:30:00Z"), "19:30", LA).inBedtime).toBe(true);
    expect(bedtimeNow(at("2026-10-14T10:59:00Z"), "19:30", LA).inBedtime).toBe(true); // 03:59
    expect(bedtimeNow(at("2026-10-14T11:00:00Z"), "19:30", LA).inBedtime).toBe(false); // 04:00: a new day
  });
  it("REGRESSION: a bedtime after midnight (00:30) doesn't start the evening before", () => {
    expect(bedtimeNow(at("2026-10-14T05:00:00Z"), "00:30", LA).inBedtime).toBe(false); // 22:00
    expect(bedtimeNow(at("2026-10-14T07:30:00Z"), "00:30", LA).inBedtime).toBe(true);  // 00:30
    expect(bedtimeNow(at("2026-10-14T07:30:00Z"), "00:30", LA).night).toBe("2026-10-13");
  });
  it("the family's time zone decides", () => {
    const now = at("2026-10-14T00:00:00Z"); // 20:00 New York, 17:00 Los Angeles
    expect(bedtimeNow(now, "19:30", NY).inBedtime).toBe(true);
    expect(bedtimeNow(now, "19:30", LA).inBedtime).toBe(false);
  });
});

describe("daylight saving", () => {
  it("fall back (Nov 1 2026, LA): the night is 25 hours; bedtime and rollover are local wall-clock", () => {
    const w = nightWindow("2026-10-31", "19:30", LA)!;
    expect(w.scheduled.toISOString()).toBe("2026-11-01T02:30:00.000Z"); // 19:30 PDT
    expect(w.end.toISOString()).toBe("2026-11-01T12:00:00.000Z");       // 04:00 PST
  });
  it("fall back: 01:30 happens twice; the first (PDT) is used", () => {
    expect(zonedInstant("2026-11-01", 90, LA).toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });
  it("spring forward (Mar 8 2026, LA): a 02:30 bedtime doesn't exist and resolves to the shifted hour", () => {
    const t = zonedInstant("2026-03-08", 150, LA);
    expect(t.toISOString()).toBe("2026-03-08T10:30:00.000Z"); // shown as 03:30 PDT
    expect(nightWindow("2026-03-07", "02:30", LA)!.scheduled.getTime()).toBeLessThan(nightWindow("2026-03-07", "02:30", LA)!.end.getTime());
  });
});

describe("the one-night extension", () => {
  const night = "2026-10-13";
  it("the cutoff is the scheduled bedtime plus 15/30/45/60 minutes", () => {
    expect(extensionCutoff(night, "19:30", 30, LA)!.toISOString()).toBe("2026-10-14T03:00:00.000Z"); // 20:00
    expect(extensionChoices(at("2026-10-14T01:00:00Z"), "19:30", LA).map((c) => c.minutes)).toEqual([15, 30, 45, 60]);
  });
  it("never past 03:59 (a 03:30 bedtime + 60)", () => {
    expect(extensionCutoff(night, "03:30", 60, LA)!.toISOString()).toBe("2026-10-14T10:59:00.000Z");
  });
  it("lets videos play until the authorized cutoff, then bedtime", () => {
    const e = [ext({})]; // until 20:00
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), "19:30", LA, e).inBedtime).toBe(false); // 19:45
    expect(bedtimeNow(at("2026-10-14T03:00:00Z"), "19:30", LA, e).inBedtime).toBe(true);  // 20:00
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), "19:30", LA, e).stopsAt!.toISOString()).toBe("2026-10-14T03:00:00.000Z");
  });
  it("the authorized cutoff stays put when the recurring bedtime changes", () => {
    const e = [ext({})]; // granted as 19:30 + 30 = 20:00
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), "19:00", LA, e).stopsAt!.toISOString()).toBe("2026-10-14T03:00:00.000Z"); // still 20:00
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), "21:00", LA, e).stopsAt!.toISOString()).toBe("2026-10-14T04:00:00.000Z"); // a later bedtime wins
  });
  it("is for one night only: it expires at the rollover and never applies to another night", () => {
    const e = [ext({})];
    expect(bedtimeNow(at("2026-10-15T02:45:00Z"), "19:30", LA, e).inBedtime).toBe(true); // the next evening, 19:45
    expect(bedtimeNow(at("2026-10-15T02:45:00Z"), "19:30", LA, e).extension).toBeNull();
  });
  it("a cancelled extension does nothing", () => {
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), "19:30", LA, [ext({ cancelledAt: "x" })]).inBedtime).toBe(true);
  });
  it("with no bedtime set, an extension is ignored", () => {
    expect(bedtimeNow(at("2026-10-14T02:45:00Z"), undefined, LA, [ext({})])).toMatchObject({ inBedtime: false, stopsAt: null, extension: null });
  });
  it("choices whose cutoff has already passed are marked", () => {
    const c = extensionChoices(at("2026-10-14T03:05:00Z"), "19:30", LA); // 20:05
    expect(c.filter((x) => x.passed).map((x) => x.minutes)).toEqual([15, 30]);
  });
});
