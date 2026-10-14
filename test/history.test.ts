import { describe, expect, it } from "vitest";
import { historyByDay } from "@/lib/history";
import type { Video } from "@/lib/types";

const v = (id: string, sec = 600): Video => ({ id, channelId: "c", title: id, durationSeconds: sec, createdAt: "" } as Video);
const vids = new Map([v("a"), v("b", 120), v("c")].map((x) => [x.id, x]));
const dayOf = (iso: string) => iso.slice(0, 10);

describe("viewing history", () => {
  const events = [
    { videoId: "a", profileId: "maya", startedAt: "2026-10-12T17:00:00Z", completed: false },
    { videoId: "a", profileId: "maya", startedAt: "2026-10-12T17:10:00Z", completed: true },                       // old player's second row
    { videoId: "a", profileId: "maya", startedAt: "2026-10-12T17:10:00Z", completed: true, outcome: "finished" as const, endedAtSec: 600 },
    { videoId: "b", profileId: "maya", startedAt: "2026-10-13T08:00:00Z", completed: false },
    { videoId: "b", profileId: "maya", startedAt: "2026-10-13T08:01:00Z", completed: false, outcome: "skipped" as const, endedAtSec: 40 },
    { videoId: "c", profileId: "leo", startedAt: "2026-10-13T09:00:00Z", completed: true },
    { videoId: "a", startedAt: "2026-10-13T10:00:00Z", completed: false },                                         // no child recorded
    { videoId: "gone", profileId: "maya", startedAt: "2026-10-13T11:00:00Z", completed: true },
  ];

  it("one play per session, newest first, finished at full length and skipped at its position", () => {
    const h = historyByDay(events, vids, dayOf, "maya", 2);
    expect(h.days.map((d) => d.day)).toEqual(["2026-10-13", "2026-10-12"]);
    expect(h.days[1]).toMatchObject({ minutes: 10, items: [{ ended: "finished", minutes: 10 }] }); // not two plays
    expect(h.days[0].items.map((i) => [i.video.id, i.ended, i.minutes])).toEqual([["b", "skipped", 1]]);
  });

  it("with several children, unattributed plays belong to no child and are reported", () => {
    const h = historyByDay(events, vids, dayOf, "maya", 2);
    expect(h.days.flatMap((d) => d.items).some((i) => i.at === "2026-10-13T10:00:00Z")).toBe(false);
    expect(h.unattributed).toBe(1);
    expect(h.unknown).toBe(1);
  });

  it("with one child, unattributed plays are theirs", () => {
    const h = historyByDay(events.filter((e) => e.profileId !== "leo"), vids, dayOf, "maya", 1);
    expect(h.days[0].items.map((i) => i.video.id)).toEqual(["a", "b"]);
    expect(h.unattributed).toBe(0);
  });
});
