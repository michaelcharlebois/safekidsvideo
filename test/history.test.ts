import { describe, expect, it } from "vitest";
import { estimateMinutes, historyByDay } from "@/lib/history";
import type { Video } from "@/lib/types";

const v = (id: string, sec = 600): Video => ({ id, channelId: "c", title: id, durationSeconds: sec, createdAt: "" } as Video);
const vids = new Map([v("a"), v("b", 120), v("c")].map((x) => [x.id, x]));
const dayOf = (iso: string) => iso.slice(0, 10);

describe("viewing history", () => {
  const events = [
    { videoId: "a", profileId: "maya", startedAt: "2026-10-12T17:00:00Z", completed: true },
    { videoId: "b", profileId: "maya", startedAt: "2026-10-13T08:00:00Z", completed: false },
    { videoId: "b", profileId: "maya", startedAt: "2026-10-13T08:01:00Z", completed: false, outcome: "skipped" as const },
    { videoId: "c", profileId: "leo", startedAt: "2026-10-13T09:00:00Z", completed: true },
    { videoId: "a", startedAt: "2026-10-13T10:00:00Z", completed: false },          // a screen that didn't record a child
    { videoId: "gone", profileId: "maya", startedAt: "2026-10-13T11:00:00Z", completed: true }, // no longer in the catalogue
  ];
  const h = historyByDay(events, vids, dayOf, "maya");

  it("groups this child's plays by day, newest first, with the same minute estimate as the stats", () => {
    expect(h.days.map((d) => d.day)).toEqual(["2026-10-13", "2026-10-12"]);
    expect(h.days[0].items.map((i) => i.video.id)).toEqual(["a", "b"]);
    expect(h.days[1]).toMatchObject({ minutes: 10, items: [{ ended: "finished", minutes: 10 }] });
    expect(estimateMinutes(false, { durationSeconds: 600 })).toBe(6);
    expect(estimateMinutes(false, { durationSeconds: 60 })).toBe(1);
  });

  it("attaches a skip to the play it ended; another child's plays are excluded", () => {
    expect(h.days[0].items.find((i) => i.video.id === "b")?.ended).toBe("skipped");
    expect(h.days.flatMap((d) => d.items).some((i) => i.video.id === "c")).toBe(false);
  });

  it("an end marker never attaches to an older play of the same video", () => {
    const h2 = historyByDay([
      { videoId: "b", profileId: "maya", startedAt: "2026-10-13T08:00:00Z", completed: false },
      { videoId: "b", profileId: "maya", startedAt: "2026-10-13T09:00:00Z", completed: true },
      { videoId: "b", profileId: "maya", startedAt: "2026-10-13T09:03:00Z", completed: true, outcome: "finished" as const },
    ], vids, dayOf, "maya");
    expect(h2.days[0].items.map((i) => i.ended)).toEqual(["finished", undefined]);
  });

  it("reports what it can't attribute or show, instead of hiding it", () => {
    expect(h.unattributed).toBe(1);
    expect(h.unknown).toBe(1);
  });
});
