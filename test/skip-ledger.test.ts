// The recorded outcome (finished / skipped) agrees with the skip budget's verdict.
import { describe, expect, it } from "vitest";
import { leavingCounts, leavingOutcome } from "@/app/watch/[id]/skip-ledger";

const cfg = { limit: 3, regen: 1, cooldownSec: 120, freePeekSec: 30 };
const last = (watchedSec: number, durationSec: number) => ({ id: "v", title: "t", watchedSec, durationSec, finished: false });

describe("leavingOutcome", () => {
  it("REGRESSION: seeking to the end after a few seconds is recorded as skipped, as the budget charges it", () => {
    expect(leavingCounts(last(40, 300), cfg)).toBe("skip");
    expect(leavingOutcome(40, 300)).toBe("skipped");
  });
  it("most of it played → finished, and the budget agrees", () => {
    expect(leavingCounts(last(250, 300), cfg)).toBe("finished");
    expect(leavingOutcome(250, 300)).toBe("finished");
  });
  it("never 'finished' when the budget says skip (whole grid)", () => {
    for (let d = 10; d <= 900; d += 37) for (let w = 0; w <= d * 1.5; w += 7) {
      if (leavingCounts(last(w, d), cfg) === "skip") expect(leavingOutcome(w, d)).toBe("skipped");
      if (leavingCounts(last(w, d), cfg) === "finished") expect(leavingOutcome(w, d)).toBe("finished");
    }
  });
  it("unknown length → skipped (it can't be shown to be finished)", () => {
    expect(leavingOutcome(100, 0)).toBe("skipped");
  });
});
