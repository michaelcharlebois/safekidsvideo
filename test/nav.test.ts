// The five destinations and which one each page belongs to.
import { describe, expect, it } from "vitest";
import { TABS } from "@/app/parent/parent-nav";

const owner = (p: string) => TABS.filter((t) => t.match(p)).map((t) => t.label);

describe("parent navigation", () => {
  it("has exactly Home, Review, Library, Activity, Kids", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Home", "Review", "Library", "Activity", "Kids"]);
  });
  it("puts each page under one destination (detail pages under Library, Account under none)", () => {
    expect(owner("/parent")).toEqual(["Home"]);
    expect(owner("/parent/review")).toEqual(["Review"]);
    expect(owner("/parent/reviewer")).toEqual([]); // Account area, not Review
    expect(owner("/parent/video/abc")).toEqual(["Library"]);
    expect(owner("/parent/channel/UC1")).toEqual(["Library"]);
    expect(owner("/parent/checkin")).toEqual(["Activity"]);
    expect(owner("/parent/settings")).toEqual(["Kids"]);
    for (const p of ["/parent/account", "/parent/devices", "/parent/billing"]) expect(owner(p)).toEqual([]);
  });
  it("carries the selected child on Home, Library and Activity only", () => {
    expect(TABS.filter((t) => t.perChild).map((t) => t.label)).toEqual(["Home", "Library", "Activity"]);
  });
});
