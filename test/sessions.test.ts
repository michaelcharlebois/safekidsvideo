// One interpretation of watch events for every viewing number: completed, skipped, abandoned and repeated
// plays; duplicates, delays and out-of-order rows; the old player's double row; and attribution.
import { describe, expect, it } from "vitest";
import { attributedTo, sessionSeconds, sessionsFrom, type RawWatchEvent } from "@/lib/sessions";

const DUR: Record<string, number> = { a: 600, b: 120 };
const dur = (id: string) => DUR[id];
const at = (min: number) => new Date(Date.UTC(2026, 9, 13, 16, 0) + min * 60_000).toISOString();
const start = (v: string, m: number, sid?: string, p = "maya"): RawWatchEvent => ({ videoId: v, profileId: p, startedAt: at(m), completed: false, sessionId: sid });
const endRow = (v: string, m: number, outcome: "finished" | "skipped" | "left", sec: number, sid?: string, p = "maya"): RawWatchEvent =>
  ({ videoId: v, profileId: p, startedAt: at(m), completed: outcome === "finished", outcome, endedAtSec: sec, sessionId: sid });
const total = (ev: RawWatchEvent[]) => sessionsFrom(ev, dur).reduce((s, x) => s + sessionSeconds(x, dur(x.videoId)), 0);

describe("sessions (current rows, with session ids)", () => {
  it("a completed play is one play and counts the video's full length", () => {
    const s = sessionsFrom([start("a", 0, "s1"), endRow("a", 10, "finished", 600, "s1")], dur);
    expect(s).toHaveLength(1);
    expect(s[0].outcome).toBe("finished");
    expect(total([start("a", 0, "s1"), endRow("a", 10, "finished", 600, "s1")])).toBe(600);
  });

  it("a skipped play counts how far it got", () => {
    expect(total([start("a", 0, "s1"), endRow("a", 1, "skipped", 45, "s1")])).toBe(45);
  });

  it("an abandoned play (no end row) gets the documented estimate", () => {
    const s = sessionsFrom([start("a", 0, "s1")], dur);
    expect(s[0].outcome).toBe("unknown");
    expect(sessionSeconds(s[0], 600)).toBe(360);       // 60%
    expect(sessionSeconds(s[0], 60)).toBe(60);         // never more than the video
    expect(sessionSeconds({ ...s[0] }, 1000)).toBe(600); // at least 2 min, 60% here
  });

  it("repeated plays of the same video are separate plays", () => {
    const ev = [start("b", 0, "s1"), endRow("b", 2, "finished", 120, "s1"), start("b", 3, "s2"), endRow("b", 5, "finished", 120, "s2")];
    expect(sessionsFrom(ev, dur)).toHaveLength(2);
    expect(total(ev)).toBe(240);
  });

  it("duplicate, delayed and out-of-order rows don't add plays or time", () => {
    const ev = [endRow("a", 10, "finished", 600, "s1"), start("a", 0, "s1"), start("a", 0, "s1"), endRow("a", 11, "finished", 600, "s1"), endRow("a", 12, "skipped", 30, "s1")];
    const s = sessionsFrom(ev, dur);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ outcome: "finished", startedAt: at(0) });
    expect(total(ev)).toBe(600);
  });

  it("an end row whose start was lost still counts once, starting when it must have", () => {
    const s = sessionsFrom([endRow("a", 10, "left", 120, "s9")], dur);
    expect(s).toHaveLength(1);
    expect(s[0].startedAt).toBe(at(8));
    expect(sessionSeconds(s[0], 600)).toBe(120);
  });
});

describe("sessions (older rows, no session id)", () => {
  it("REGRESSION: the old player's start + completion row + finished marker is ONE play of the full length", () => {
    const ev = [start("a", 0), { ...start("a", 10), completed: true }, endRow("a", 10, "finished", 600)];
    expect(sessionsFrom(ev, dur)).toHaveLength(1);
    expect(total(ev)).toBe(600); // was 360 + 600 before
  });

  it("the demo seeder's shape (start marked completed, then the end row) is one play", () => {
    const ev = [{ ...start("a", 0), completed: true }, endRow("a", 10, "finished", 600)];
    expect(sessionsFrom(ev, dur)).toHaveLength(1);
    expect(total(ev)).toBe(600);
  });

  it("skips, abandons and repeats", () => {
    const ev = [start("a", 0), endRow("a", 1, "skipped", 50), start("b", 2), start("b", 30), endRow("b", 32, "finished", 120)];
    const s = sessionsFrom(ev, dur);
    expect(s.map((x) => x.outcome)).toEqual(["skipped", "unknown", "finished"]);
    expect(total(ev)).toBe(50 + 120 + 120);
  });

  it("an end row never attaches to a much older play, and racing inserts merge", () => {
    const ev = [start("b", 0), endRow("b", 120, "skipped", 20)]; // two hours later: its own session
    expect(sessionsFrom(ev, dur)).toHaveLength(2);
    const race = [endRow("b", 5, "skipped", 30), start("b", 5.1)]; // start written just after its end
    expect(sessionsFrom(race, dur)).toHaveLength(1);
  });

  it("children are kept apart even for the same video at the same time", () => {
    const ev = [start("a", 0, undefined, "maya"), start("a", 0, undefined, "leo"), endRow("a", 10, "finished", 600, undefined, "maya")];
    const s = sessionsFrom(ev, dur);
    expect(s.map((x) => [x.profileId, x.outcome]).sort()).toEqual([["leo", "unknown"], ["maya", "finished"]]);
  });
});

describe("attribution", () => {
  it("unattributed viewing belongs to the only child, or to no child when there are several", () => {
    expect(attributedTo(undefined, "maya", 1)).toBe(true);
    expect(attributedTo(undefined, "maya", 2)).toBe(false);
    expect(attributedTo("leo", "maya", 2)).toBe(false);
    expect(attributedTo("maya", "maya", 2)).toBe(true);
  });
});
