import { describe, expect, it } from "vitest";
import { liveTimeRequests, timeAskState, type TimeRequest } from "@/lib/time-requests";

const TODAY = "2026-10-13", YESTERDAY = "2026-10-12";
const r = (o: Partial<TimeRequest>): TimeRequest => ({ id: Math.random().toString(36), familyId: "f", profileId: "maya", kind: "limit", day: TODAY, status: "pending", createdAt: "2026-10-13T18:00:00Z", ...o });

describe("timeAskState", () => {
  it("bedtime never offers extra minutes (they wouldn't lift it)", () => {
    expect(timeAskState("bedtime", [], "maya", TODAY)).toBe("not-offered");
  });
  it("nothing asked today → can ask", () => {
    expect(timeAskState("limit", [], "maya", TODAY)).toBe("can-ask");
  });
  it("an ask from any screen is pending for every screen of that child", () => {
    expect(timeAskState("limit", [r({ deviceId: "tv" })], "maya", TODAY)).toBe("pending");
  });
  it("another child's ask doesn't count", () => {
    expect(timeAskState("limit", [r({ profileId: "leo" })], "maya", TODAY)).toBe("can-ask");
  });
  it("declined → not again today", () => {
    expect(timeAskState("limit", [r({ status: "denied" })], "maya", TODAY)).toBe("declined");
  });
  it("approved and used up → can ask again", () => {
    expect(timeAskState("limit", [r({ status: "approved", grantedMinutes: 15 })], "maya", TODAY)).toBe("can-ask");
  });
  it("the latest answer wins", () => {
    expect(timeAskState("limit", [r({ status: "approved", createdAt: "2026-10-13T17:00:00Z" }), r({ status: "denied", createdAt: "2026-10-13T19:00:00Z" })], "maya", TODAY)).toBe("declined");
  });
  it("yesterday's pending or declined ask has expired", () => {
    expect(timeAskState("limit", [r({ day: YESTERDAY }), r({ day: YESTERDAY, status: "denied" })], "maya", TODAY)).toBe("can-ask");
  });
});

describe("liveTimeRequests (the parent's inbox)", () => {
  it("only today's pending asks, oldest first", () => {
    const a = r({ createdAt: "2026-10-13T19:00:00Z" }), b = r({ profileId: "leo", createdAt: "2026-10-13T18:00:00Z" });
    expect(liveTimeRequests([a, b, r({ day: YESTERDAY }), r({ status: "approved", grantedMinutes: 30 })], TODAY)).toEqual([b, a]);
  });
});
