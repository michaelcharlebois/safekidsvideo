import { describe, expect, it } from "vitest";
import { PlaybackClock } from "@/lib/playback";

describe("PlaybackClock", () => {
  it("counts only playing time: pauses add nothing", () => {
    const c = new PlaybackClock();
    c.play(0); c.stop(10_000);          // 10 s
    c.play(70_000); c.stop(75_000);     // paused a minute, then 5 s
    expect(c.seconds(100_000)).toBe(15);
  });
  it("a seek doesn't move it (the clock knows nothing about position)", () => {
    const c = new PlaybackClock();
    c.play(0);
    // the child jumps 2 minutes ahead at t=3s: the player stops the clock while seeking, then plays on
    c.stop(3_000); c.play(3_200);
    expect(c.seconds(5_200)).toBe(5);
  });
  it("repeated play()/stop() calls are harmless; time while playing is live", () => {
    const c = new PlaybackClock();
    c.play(0); c.play(5_000); expect(c.playing).toBe(true); expect(c.seconds(8_000)).toBe(8);
    c.stop(8_000); c.stop(9_000); expect(c.seconds(20_000)).toBe(8);
  });
});
