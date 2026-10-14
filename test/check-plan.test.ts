// Asking a grown-up vs the AI-review allowance (regression for: Ask First blocked by checksToday).
import { describe, expect, it } from "vitest";
import { MAX_PENDING_REQUESTS_PER_CHILD, planCheck, type CheckInput } from "@/lib/check-plan";

const base: CheckInput = { mode: "open_ask", playable: false, reviewed: false, tooLong: false, reviewerConfigured: true, aiChecksToday: 0, aiDailyLimit: 20, alreadyAsked: false, pendingForChild: 0 };
const exhausted = { aiChecksToday: 20, aiDailyLimit: 20 };

describe("Ask first", () => {
  it("REGRESSION: with today's automatic checks used up, the child can still ask a grown-up", () => {
    expect(planCheck({ ...base, ...exhausted })).toEqual({ do: "request", reason: "Asked to watch", reviewAfter: false });
  });
  it("with allowance left, the request goes in now and a review runs in the background for the parent", () => {
    expect(planCheck(base)).toEqual({ do: "request", reason: "Asked to watch", reviewAfter: true });
  });
  it("a reviewed video is a request too (Ask first never plays anything new), and uses no allowance", () => {
    expect(planCheck({ ...base, reviewed: true })).toEqual({ do: "request", reason: "Asked to watch", reviewAfter: false });
  });
  it("asking twice is a no-op; too many unanswered asks are refused", () => {
    expect(planCheck({ ...base, alreadyAsked: true })).toEqual({ do: "already-asked" });
    expect(planCheck({ ...base, pendingForChild: MAX_PENDING_REQUESTS_PER_CHILD })).toEqual({ do: "too-many-requests" });
  });
});

describe("Open", () => {
  const open = { ...base, mode: "open" as const };
  it("not reviewed, allowance left → automatic review", () => {
    expect(planCheck(open)).toEqual({ do: "review" });
  });
  it("REGRESSION: allowance used up → a grown-up decides (no dead end, no review)", () => {
    expect(planCheck({ ...open, ...exhausted })).toEqual({ do: "request", reason: "Today's automatic checks are used up", reviewAfter: false });
  });
  it("reviewed → decided from the stored review, with no allowance used (even when it's exhausted)", () => {
    expect(planCheck({ ...open, reviewed: true, ...exhausted })).toEqual({ do: "settle" });
  });
  it("too long, or no reviewer → a grown-up decides", () => {
    expect(planCheck({ ...open, tooLong: true })).toMatchObject({ do: "request", reviewAfter: false });
    expect(planCheck({ ...open, reviewerConfigured: false })).toMatchObject({ do: "request", reviewAfter: false });
  });
});

describe("authorization is not bypassed", () => {
  it("only an authorize() yes plays; every other path is a request, a stored-review decision or a review", () => {
    for (const mode of ["open", "open_ask"] as const) for (const reviewed of [true, false]) for (const n of [0, 20]) {
      const p = planCheck({ ...base, mode, reviewed, aiChecksToday: n });
      expect(p.do).not.toBe("play");
    }
    expect(planCheck({ ...base, playable: true, ...exhausted })).toEqual({ do: "play" });
  });
});
