// Server-side bedtime and extensions against the real local store: timeState (what every kid page, the
// player and nextVideo enforce), asks and answers, duplicates, the daily-limit interaction, a changed
// recurring bedtime, cancellation, and the 60-minute cap.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TZ = "America/Los_Angeles";
const FAM = "00000000-0000-0000-0000-000000000001";
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
let dir: string;

async function setup(o: { bedtimeOffsetMin: number; dailyMinutes?: number; watchedSec?: number }) {
  const { __resetLocalStoreCache, localStore } = await import("@/lib/db/local");
  const file = path.join(dir, `db-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ channels: [], videos: [], cards: [], confirmations: [], whitelist: [], settings: [], schema: 18 }));
  process.env.SIFT_LOCAL_DB = file;
  __resetLocalStoreCache();
  const now = Date.now();
  const p = await localStore.upsertProfile({ familyId: FAM, id: "", name: "Maya", age: 6, avatar: "🦊", mode: "open", sort: 0, interests: [], blockedTags: [], blockedFormats: [], hideUnreviewed: true, dailyCheckLimit: 20, kidsOnlySearch: false, bedtime: hhmm(now + o.bedtimeOffsetMin * 60_000), dailyMinutes: o.dailyMinutes } as never);
  if (o.watchedSec) {
    const { localWatchEvents } = await import("@/lib/db/local");
    const sid = "33333333-3333-4333-8333-333333333333";
    await localWatchEvents.add({ familyId: FAM, videoId: "vvvvvvvvvv1", profileId: p.id, startedAt: new Date(now - 120_000).toISOString(), completed: false, sessionId: sid });
    await localWatchEvents.add({ familyId: FAM, videoId: "vvvvvvvvvv1", profileId: p.id, startedAt: new Date(now - 60_000).toISOString(), completed: true, outcome: "finished", endedAtSec: 180, watchedSec: o.watchedSec, sessionId: sid });
  }
  return p.id;
}
const state = async (pid: string) => {
  const { timeState } = await import("@/lib/screentime");
  const { db } = await import("@/lib/db/resolve");
  return timeState(FAM, await db.getSettings(FAM, pid), TZ);
};

beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "bf-bed-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { delete process.env.BF_PERMISSION_WRITES_PAUSED; });

describe("bedtime on the server", () => {
  it("past bedtime: refused, reason bedtime, and the child can ask once tonight", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const t = await state(pid);
    expect(t).toMatchObject({ allowed: false, reason: "bedtime", extensionMinutes: 0 });
    const { askForMoreTime } = await import("@/lib/more-time");
    expect(await askForMoreTime(FAM, pid, "bedtime")).toBe("created");
    expect(await askForMoreTime(FAM, pid, "bedtime")).toBe("pending"); // a second screen: same ask
  });

  it("approved: allowed until the authorized cutoff, which the player gets as stopsAt; no minutes added", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { askForMoreTime, listTimeRequests, answerTimeRequest } = await import("@/lib/more-time");
    await askForMoreTime(FAM, pid, "bedtime");
    const [req] = await listTimeRequests(FAM);
    expect(await answerTimeRequest(FAM, req.id, "approve", 30)).toBe("done");
    expect(await answerTimeRequest(FAM, req.id, "approve", 60)).toBe("gone"); // a stale second answer changes nothing
    const t = await state(pid);
    expect(t.allowed).toBe(true);
    if (!t.allowed) return;
    expect(Date.parse(t.stopsAt!) - Date.now()).toBeGreaterThan(15 * 60_000);  // ~20 min from now
    expect(Date.parse(t.stopsAt!) - Date.now()).toBeLessThan(21 * 60_000);
    expect(t.extendedUntil).toBe(t.stopsAt);
    const { db } = await import("@/lib/db/resolve");
    expect((await db.getProfile(pid))?.bonusMinutes ?? 0).toBe(0);
  });

  it("declined or fulfilled: no second ask tonight; a parent can still grant directly", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { askForMoreTime, listTimeRequests, answerTimeRequest, grantBedtimeExtension } = await import("@/lib/more-time");
    await askForMoreTime(FAM, pid, "bedtime");
    const [req] = await listTimeRequests(FAM);
    await answerTimeRequest(FAM, req.id, "deny");
    expect(await askForMoreTime(FAM, pid, "bedtime")).toBe("declined");
    await grantBedtimeExtension(FAM, pid, 15);
    expect((await state(pid)).allowed).toBe(true);
  });

  it("the daily limit still applies during an extension, and extra minutes don't lift bedtime", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10, dailyMinutes: 45, watchedSec: 50 * 60 });
    const before = await state(pid);
    expect(before).toMatchObject({ allowed: false, reason: "bedtime", limitReached: true });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    const { grantBonusMinutes } = await import("@/lib/screentime");
    await grantBonusMinutes(pid, 30, TZ);
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "bedtime" }); // minutes alone: still bedtime
    await grantBedtimeExtension(FAM, pid, 30);
    expect((await state(pid)).allowed).toBe(true);                                  // both: watching
  });

  it("an extension alone, with the minutes used up, shows the daily-limit screen", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10, dailyMinutes: 45, watchedSec: 50 * 60 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    await grantBedtimeExtension(FAM, pid, 30);
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "limit" });
  });

  it("changing the recurring bedtime keeps tonight's authorized cutoff; a later bedtime wins", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    const e = await grantBedtimeExtension(FAM, pid, 30);
    const { localStore } = await import("@/lib/db/local");
    const p = (await localStore.getProfile(pid))!;
    await localStore.upsertProfile({ ...p, bedtime: hhmm(Date.now() - 60 * 60_000) }); // an hour earlier
    let t = await state(pid);
    expect(t.allowed && t.stopsAt).toBe(e.cutoffAt);
    await localStore.upsertProfile({ ...p, bedtime: hhmm(Date.now() + 60 * 60_000) }); // an hour later
    t = await state(pid);
    expect(t.allowed && Date.parse(t.stopsAt!)).toBeGreaterThan(Date.parse(e.cutoffAt));
  });

  it("cancelling takes effect at the next server check", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension, cancelBedtimeExtension } = await import("@/lib/more-time");
    await grantBedtimeExtension(FAM, pid, 30);
    expect((await state(pid)).allowed).toBe(true);
    expect(await cancelBedtimeExtension(FAM, pid)).toBe(true);
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "bedtime" });
  });

  it("changing tonight's extension replaces it (never more than 60 past bedtime); passed cutoffs and bad steps are refused", async () => {
    const pid = await setup({ bedtimeOffsetMin: -20 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    await expect(grantBedtimeExtension(FAM, pid, 15)).rejects.toThrow(/already passed/);
    await expect(grantBedtimeExtension(FAM, pid, 90)).rejects.toThrow(/15, 30, 45 or 60/);
    await grantBedtimeExtension(FAM, pid, 30);
    const e = await grantBedtimeExtension(FAM, pid, 60);
    const { listExtensions } = await import("@/lib/bedtime-store");
    const live = (await listExtensions(FAM, "0000-01-01")).filter((x) => !x.cancelledAt);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ extraMinutes: 60, cutoffAt: e.cutoffAt });
  });

  it("before bedtime: allowed, and the player is told when tonight's bedtime stops videos", async () => {
    const pid = await setup({ bedtimeOffsetMin: 20 });
    const t = await state(pid);
    expect(t.allowed && Date.parse(t.stopsAt!) - Date.now()).toBeGreaterThan(18 * 60_000);
    const { askForMoreTime } = await import("@/lib/more-time");
    expect(await askForMoreTime(FAM, pid, "bedtime")).toBe("created"); // allowed before bedtime too; it's for tonight
  });
});
