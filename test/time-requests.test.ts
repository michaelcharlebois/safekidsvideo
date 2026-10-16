import { describe, expect, it } from "vitest";
import { liveTimeRequests, timeAskState, type TimeRequest } from "@/lib/time-requests";

const TODAY = "2026-10-13", YESTERDAY = "2026-10-12";
const W = { today: TODAY, night: TODAY };
const r = (o: Partial<TimeRequest>): TimeRequest => ({ id: Math.random().toString(36), familyId: "f", profileId: "maya", kind: "limit", day: TODAY, status: "pending", createdAt: "2026-10-13T18:00:00Z", ...o });

describe("timeAskState", () => {
  it("bedtime: one ask per night — can ask, pending, declined, or fulfilled (no second ask)", () => {
    const b = (o: Partial<TimeRequest>) => r({ kind: "bedtime", ...o });
    expect(timeAskState("bedtime", [], "maya", W)).toBe("can-ask");
    expect(timeAskState("bedtime", [b({})], "maya", W)).toBe("pending");
    expect(timeAskState("bedtime", [b({ status: "denied" })], "maya", W)).toBe("declined");
    expect(timeAskState("bedtime", [b({ status: "approved", grantedMinutes: 30 })], "maya", W)).toBe("fulfilled");
  });
  it("bedtime: a daily-minutes ask doesn't count, and vice versa", () => {
    expect(timeAskState("bedtime", [r({})], "maya", W)).toBe("can-ask");
    expect(timeAskState("limit", [r({ kind: "bedtime" })], "maya", W)).toBe("can-ask");
  });
  it("bedtime: an ask made after midnight belongs to the night before (day = the night)", () => {
    expect(timeAskState("bedtime", [r({ kind: "bedtime", day: YESTERDAY })], "maya", { today: TODAY, night: YESTERDAY })).toBe("pending");
    expect(timeAskState("bedtime", [r({ kind: "bedtime", day: YESTERDAY })], "maya", W)).toBe("can-ask"); // last night's: expired
  });
  it("bedtime: not offered when tonight already has the full 60-minute extension", () => {
    expect(timeAskState("bedtime", [], "maya", { ...W, extensionMinutes: 60 })).toBe("not-offered");
    expect(timeAskState("bedtime", [], "maya", { ...W, extensionMinutes: 30 })).toBe("can-ask");
  });
  it("does not offer a bedtime ask after every allowed cutoff has passed", () => {
    expect(timeAskState("bedtime", [], "maya", { ...W, bedtimeExtensionAvailable: false })).toBe("not-offered");
    expect(timeAskState("bedtime", [], "maya", { ...W, bedtimeExtensionAvailable: true })).toBe("can-ask");
    expect(timeAskState("bedtime", [r({ kind: "bedtime", status: "pending" })], "maya",
      { ...W, bedtimeExtensionAvailable: false })).toBe("pending");
  });
  it("nothing asked today → can ask", () => {
    expect(timeAskState("limit", [], "maya", W)).toBe("can-ask");
  });
  it("an ask from any screen is pending for every screen of that child", () => {
    expect(timeAskState("limit", [r({ deviceId: "tv" })], "maya", W)).toBe("pending");
  });
  it("another child's ask doesn't count", () => {
    expect(timeAskState("limit", [r({ profileId: "leo" })], "maya", W)).toBe("can-ask");
  });
  it("declined → not again today", () => {
    expect(timeAskState("limit", [r({ status: "denied" })], "maya", W)).toBe("declined");
  });
  it("approved and used up → can ask again", () => {
    expect(timeAskState("limit", [r({ status: "approved", grantedMinutes: 15 })], "maya", W)).toBe("can-ask");
  });
  it("the latest answer wins", () => {
    expect(timeAskState("limit", [r({ status: "approved", createdAt: "2026-10-13T17:00:00Z" }), r({ status: "denied", createdAt: "2026-10-13T19:00:00Z" })], "maya", W)).toBe("declined");
  });
  it("yesterday's pending or declined ask has expired", () => {
    expect(timeAskState("limit", [r({ day: YESTERDAY }), r({ day: YESTERDAY, status: "denied" })], "maya", W)).toBe("can-ask");
  });
});

describe("liveTimeRequests (the parent's inbox)", () => {
  it("a bedtime ask is live for its night, even after midnight", () => {
    const n = r({ kind: "bedtime", day: YESTERDAY });
    expect(liveTimeRequests([n], TODAY, YESTERDAY)).toEqual([n]);
    expect(liveTimeRequests([n], TODAY, TODAY)).toEqual([]);
  });
  it("only today's pending asks, oldest first", () => {
    const a = r({ createdAt: "2026-10-13T19:00:00Z" }), b = r({ profileId: "leo", createdAt: "2026-10-13T18:00:00Z" });
    expect(liveTimeRequests([a, b, r({ day: YESTERDAY }), r({ status: "approved", grantedMinutes: 30 })], TODAY, TODAY)).toEqual([b, a]);
  });
});
