// Screen-time limits, Activity stats and the check-in day shape all read viewing the same way.
import { describe, expect, it } from "vitest";
import { usedMinutesOn } from "@/lib/screentime";
import { computeKidStats } from "@/lib/stats";
import { shapeDay } from "@/lib/checkin";
import type { RawWatchEvent } from "@/lib/sessions";
import type { Video } from "@/lib/types";

const vid = (id: string, sec: number): Video => ({ id, channelId: "ch", title: id, durationSeconds: sec, createdAt: "" } as Video);
const videos = [vid("song", 180), vid("show", 1200)];
const byId = new Map(videos.map((v) => [v.id, v]));
const NOW = Date.parse("2026-10-13T20:00:00Z");
const at = (h: number, m = 0) => new Date(Date.parse("2026-10-13T00:00:00Z") + (h * 60 + m) * 60_000).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);
const E = (videoId: string, t: string, extra: Partial<RawWatchEvent> = {}): RawWatchEvent => ({ videoId, profileId: "maya", startedAt: t, completed: false, ...extra });

// Old player rows for one finished 20-minute show, one skipped song, one song left playing when the app closed.
const today: RawWatchEvent[] = [
  E("show", at(15)), E("show", at(15, 20), { completed: true }), E("show", at(15, 20), { completed: true, outcome: "finished", endedAtSec: 1200 }),
  E("song", at(16)), E("song", at(16, 1), { outcome: "skipped", endedAtSec: 30 }),
  E("song", at(17)),
];

describe("screen-time limit", () => {
  it("REGRESSION: a finished show counts once (20 min), not as two plays", () => {
    // 20 min show + 0.5 min skip + estimate for the abandoned 3-min song (2 min, capped at its length 3)
    expect(usedMinutesOn(today, byId, dayOf, "2026-10-13")).toBe(Math.round((1200 + 30 + 120) / 60));
  });
  it("a repeated play is counted each time; a 30-minute limit is reached after the second full show", () => {
    const two = [...today, E("show", at(18), { sessionId: "11111111-1111-4111-8111-111111111111" }), E("show", at(18, 20), { sessionId: "11111111-1111-4111-8111-111111111111", outcome: "finished", endedAtSec: 1200, completed: true })];
    const used = usedMinutesOn(two, byId, dayOf, "2026-10-13");
    expect(used).toBe(Math.round((1200 + 30 + 120 + 1200) / 60));
    expect(used >= 30).toBe(true);
    expect(usedMinutesOn(today, byId, dayOf, "2026-10-13") >= 30).toBe(false);
  });
  it("yesterday's viewing doesn't count today", () => {
    expect(usedMinutesOn([E("show", "2026-10-12T23:00:00Z")], byId, dayOf, "2026-10-13")).toBe(0);
  });
});

describe("Activity stats and the check-in day agree with the limit", () => {
  const stats = computeKidStats({ events: today, videos, cards: [], channels: [], profileId: "maya", childCount: 1, days: 7, tz: "UTC", now: NOW });
  it("plays, outcomes and minutes", () => {
    expect(stats).toMatchObject({ plays: 3, finishes: 1, skips: 1, unknown: 1, minutes: usedMinutesOn(today, byId, dayOf, "2026-10-13") });
  });
  it("the check-in's day shape uses the same sessions", () => {
    expect(shapeDay(today, byId, new Map()).minutes).toBe(stats.minutes);
    expect(shapeDay(today, byId, new Map()).videos).toHaveLength(3);
  });
  it("with several children, unattributed plays count for no child and are reported", () => {
    const anon = [E("show", at(12), { profileId: undefined })];
    const s2 = computeKidStats({ events: anon, videos, cards: [], channels: [], profileId: "maya", childCount: 2, days: 7, tz: "UTC", now: NOW });
    expect(s2).toMatchObject({ plays: 0, minutes: 0, unattributed: 1 });
    const s1 = computeKidStats({ events: anon, videos, cards: [], channels: [], profileId: "maya", childCount: 1, days: 7, tz: "UTC", now: NOW });
    expect(s1.plays).toBe(1);
  });
});
