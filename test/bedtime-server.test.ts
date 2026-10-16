// Server-side bedtime and extensions against the real local store: timeState (what every kid page, the
// player and nextVideo enforce), asks and answers, duplicates, the daily-limit interaction, a changed
// recurring bedtime, cancellation, and the 60-minute cap. Deterministic: every call gets the same injected
// clock (8:00 PM in Los Angeles on Oct 13 2026), never the real time.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TZ = "America/Los_Angeles";
const FAM = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-14T03:00:00Z"); // 20:00 PDT, night of 2026-10-13
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
let dir: string;

async function setup(o: { bedtimeOffsetMin: number; dailyMinutes?: number; watchedSec?: number }) {
  const { __resetLocalStoreCache, localStore } = await import("@/lib/db/local");
  const file = path.join(dir, `db-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ channels: [], videos: [], cards: [], confirmations: [], whitelist: [], settings: [], schema: 18 }));
  process.env.SIFT_LOCAL_DB = file;
  __resetLocalStoreCache();
  const now = NOW.getTime();
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
  return timeState(FAM, await db.getSettings(FAM, pid), TZ, NOW);
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
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, NOW)).toBe("created");
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, NOW)).toBe("pending"); // a second screen: same ask
  });

  it("approved: allowed until the authorized cutoff, which the player gets as stopsAt; no minutes added", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { askForMoreTime, listTimeRequests, answerTimeRequest } = await import("@/lib/more-time");
    await askForMoreTime(FAM, pid, "bedtime", undefined, NOW);
    const [req] = await listTimeRequests(FAM, undefined, NOW);
    expect(await answerTimeRequest(FAM, req.id, "approve", 30, NOW)).toBe("done");
    expect(await answerTimeRequest(FAM, req.id, "approve", 60, NOW)).toBe("gone"); // a stale second answer changes nothing
    const t = await state(pid);
    expect(t.allowed).toBe(true);
    if (!t.allowed) return;
    expect(Date.parse(t.stopsAt!) - NOW.getTime()).toBeGreaterThan(15 * 60_000);  // ~20 min from now
    expect(Date.parse(t.stopsAt!) - NOW.getTime()).toBeLessThan(21 * 60_000);
    expect(t.extendedUntil).toBe(t.stopsAt);
    const { db } = await import("@/lib/db/resolve");
    expect((await db.getProfile(pid))?.bonusMinutes ?? 0).toBe(0);
  });

  it("declined or fulfilled: no second ask tonight; a parent can still grant directly", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { askForMoreTime, listTimeRequests, answerTimeRequest, grantBedtimeExtension } = await import("@/lib/more-time");
    await askForMoreTime(FAM, pid, "bedtime", undefined, NOW);
    const [req] = await listTimeRequests(FAM, undefined, NOW);
    await answerTimeRequest(FAM, req.id, "deny", undefined, NOW);
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, NOW)).toBe("declined");
    await grantBedtimeExtension(FAM, pid, 15, { now: NOW });
    expect((await state(pid)).allowed).toBe(true);
  });

  it("the daily limit still applies during an extension, and extra minutes don't lift bedtime", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10, dailyMinutes: 45, watchedSec: 50 * 60 });
    const before = await state(pid);
    expect(before).toMatchObject({ allowed: false, reason: "bedtime", limitReached: true });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    const { grantBonusMinutes } = await import("@/lib/screentime");
    await grantBonusMinutes(pid, 30, TZ, NOW);
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "bedtime" }); // minutes alone: still bedtime
    await grantBedtimeExtension(FAM, pid, 30, { now: NOW });
    expect((await state(pid)).allowed).toBe(true);                                  // both: watching
  });

  it("an extension alone, with the minutes used up, shows the daily-limit screen", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10, dailyMinutes: 45, watchedSec: 50 * 60 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    await grantBedtimeExtension(FAM, pid, 30, { now: NOW });
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "limit" });
  });

  it("changing the recurring bedtime keeps tonight's authorized cutoff; a later bedtime wins", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    const e = await grantBedtimeExtension(FAM, pid, 30, { now: NOW });
    const { localStore } = await import("@/lib/db/local");
    const p = (await localStore.getProfile(pid))!;
    await localStore.upsertProfile({ ...p, bedtime: hhmm(NOW.getTime() - 60 * 60_000) }); // an hour earlier
    let t = await state(pid);
    expect(t.allowed && t.stopsAt).toBe(e.cutoffAt);
    await localStore.upsertProfile({ ...p, bedtime: hhmm(NOW.getTime() + 60 * 60_000) }); // an hour later
    t = await state(pid);
    expect(t.allowed && Date.parse(t.stopsAt!)).toBeGreaterThan(Date.parse(e.cutoffAt));
  });

  it("cancelling takes effect at the next server check", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension, cancelBedtimeExtension } = await import("@/lib/more-time");
    await grantBedtimeExtension(FAM, pid, 30, { now: NOW });
    expect((await state(pid)).allowed).toBe(true);
    expect(await cancelBedtimeExtension(FAM, pid, NOW)).toBe(true);
    expect(await state(pid)).toMatchObject({ allowed: false, reason: "bedtime" });
  });

  it("changing tonight's extension replaces it (never more than 60 past bedtime); passed cutoffs and bad steps are refused", async () => {
    const pid = await setup({ bedtimeOffsetMin: -20 });
    const { grantBedtimeExtension } = await import("@/lib/more-time");
    await expect(grantBedtimeExtension(FAM, pid, 15, { now: NOW })).rejects.toThrow(/already passed/);
    await expect(grantBedtimeExtension(FAM, pid, 90, { now: NOW })).rejects.toThrow(/15, 30, 45 or 60/);
    await grantBedtimeExtension(FAM, pid, 30, { now: NOW });
    const e = await grantBedtimeExtension(FAM, pid, 60, { now: NOW });
    const { listExtensions } = await import("@/lib/bedtime-store");
    const live = (await listExtensions(FAM, "0000-01-01")).filter((x) => !x.cancelledAt);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ extraMinutes: 60, cutoffAt: e.cutoffAt });
  });

  it("before bedtime: allowed, and the player is told when tonight's bedtime stops videos", async () => {
    const pid = await setup({ bedtimeOffsetMin: 20 });
    const t = await state(pid);
    expect(t.allowed && Date.parse(t.stopsAt!) - NOW.getTime()).toBeGreaterThan(18 * 60_000);
    const { askForMoreTime } = await import("@/lib/more-time");
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, NOW)).toBe("created"); // allowed before bedtime too; it's for tonight
  });
});

describe("answering and granting are atomic (local store)", () => {
  const extsFor = async (pid: string) => (await (await import("@/lib/bedtime-store")).listExtensions(FAM, "0000-01-01")).filter((e) => e.profileId === pid && !e.cancelledAt);
  const ask = async (pid: string, kind: "limit" | "bedtime") => {
    const m = await import("@/lib/more-time");
    await m.askForMoreTime(FAM, pid, kind, undefined, NOW);
    return (await m.listTimeRequests(FAM, undefined, NOW)).find((r) => r.profileId === pid && r.kind === kind)!;
  };

  it("a retried approval doesn't grant twice or report a second success", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { answerTimeRequest } = await import("@/lib/more-time");
    const req = await ask(pid, "bedtime");
    expect(await answerTimeRequest(FAM, req.id, "approve", 30, NOW)).toBe("done");
    expect(await answerTimeRequest(FAM, req.id, "approve", 30, NOW)).toBe("gone");
    expect(await extsFor(pid)).toHaveLength(1);
  });

  it("two parents approving at once: exactly one wins, and the ask records the extension that exists", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { answerTimeRequest, listTimeRequests } = await import("@/lib/more-time");
    const req = await ask(pid, "bedtime");
    const out = await Promise.all([answerTimeRequest(FAM, req.id, "approve", 30, NOW), answerTimeRequest(FAM, req.id, "approve", 60, NOW)]);
    expect(out.filter((x) => x === "done")).toHaveLength(1);
    const [e] = await extsFor(pid);
    const answered = (await listTimeRequests(FAM, "0000-01-01", NOW)).find((r) => r.id === req.id)!;
    expect(answered.status).toBe("approved");
    expect(answered.grantedMinutes).toBe(e.extraMinutes);
    expect(e.requestId).toBe(req.id);
  });

  it("a direct grant answers tonight's pending ask in the same write (no second ask possible)", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension, listTimeRequests, askForMoreTime } = await import("@/lib/more-time");
    const req = await ask(pid, "bedtime");
    await grantBedtimeExtension(FAM, pid, 45, { now: NOW });
    const r = (await listTimeRequests(FAM, "0000-01-01", NOW)).find((x) => x.id === req.id)!;
    expect(r).toMatchObject({ status: "approved", grantedMinutes: 45 });
    expect(await extsFor(pid)).toHaveLength(1);
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, NOW)).toBe("fulfilled");
  });

  it("a direct grant racing an approval: still one live extension, and the ask is approved", async () => {
    const pid = await setup({ bedtimeOffsetMin: -10 });
    const { grantBedtimeExtension, answerTimeRequest, listTimeRequests } = await import("@/lib/more-time");
    const req = await ask(pid, "bedtime");
    await Promise.all([grantBedtimeExtension(FAM, pid, 15, { now: NOW }), answerTimeRequest(FAM, req.id, "approve", 60, NOW)]);
    expect(await extsFor(pid)).toHaveLength(1);
    expect((await listTimeRequests(FAM, "0000-01-01", NOW)).find((x) => x.id === req.id)!.status).toBe("approved");
  });

  it("minutes: one approval adds them once; racing approvals add them once; a direct grant answers the ask", async () => {
    const pid = await setup({ bedtimeOffsetMin: 120, dailyMinutes: 45, watchedSec: 50 * 60 });
    const m = await import("@/lib/more-time");
    const { localStore } = await import("@/lib/db/local");
    let req = await ask(pid, "limit");
    const out = await Promise.all([m.answerTimeRequest(FAM, req.id, "approve", 15, NOW), m.answerTimeRequest(FAM, req.id, "approve", 30, NOW)]);
    expect(out.filter((x) => x === "done")).toHaveLength(1);
    const bonus = (await localStore.getProfile(pid))!.bonusMinutes;
    expect([15, 30]).toContain(bonus);
    expect(await m.answerTimeRequest(FAM, req.id, "approve", 15, NOW)).toBe("gone");
    expect((await localStore.getProfile(pid))!.bonusMinutes).toBe(bonus);
    // Used up again → a new ask, answered by a direct grant from Settings.
    const used = await setup({ bedtimeOffsetMin: 120, dailyMinutes: 45, watchedSec: 50 * 60 });
    req = await ask(used, "limit");
    await m.grantMinutes(FAM, used, 30, NOW);
    expect((await m.listTimeRequests(FAM, "0000-01-01", NOW)).find((x) => x.id === req.id)).toMatchObject({ status: "approved", grantedMinutes: 30 });
    expect((await state(used)).allowed).toBe(true);
  });
});

describe("asking near the final available cutoff (+60 past bedtime)", () => {
  // Bedtime 7:01 pm → the latest cutoff is 8:01 pm; NOW is 8:00 pm. The kid screen (watch/layout) offers an
  // ask only while some cutoff is still ahead, and the server applies the same rule when an ask arrives.
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  const offered = async (pid: string, when: Date) => {
    const { extensionChoices } = await import("@/lib/bedtime");
    const { db } = await import("@/lib/db/resolve");
    return extensionChoices(when, (await db.getSettings(FAM, pid)).bedtime, TZ).some((c) => !c.passed);
  };

  it("one second before the final cutoff: offered on screen, and the ask is accepted", async () => {
    const pid = await setup({ bedtimeOffsetMin: -59 });
    const { askForMoreTime, listTimeRequests } = await import("@/lib/more-time");
    expect(await offered(pid, at(59_000))).toBe(true);
    expect(await askForMoreTime(FAM, pid, "bedtime", undefined, at(59_000))).toBe("created");
    expect((await listTimeRequests(FAM, undefined, at(59_000))).filter((r) => r.kind === "bedtime")).toHaveLength(1);
  });

  it("at the final cutoff and after: not offered, and the server refuses (nothing stored)", async () => {
    const { askForMoreTime, listTimeRequests } = await import("@/lib/more-time");
    for (const ms of [60_000, 61_000, 30 * 60_000]) {
      const pid = await setup({ bedtimeOffsetMin: -59 });
      expect(await offered(pid, at(ms)), `+${ms} ms`).toBe(false);
      expect(await askForMoreTime(FAM, pid, "bedtime", undefined, at(ms)), `+${ms} ms`).toBe("not-offered");
      expect(await listTimeRequests(FAM, undefined, at(ms))).toEqual([]);
    }
  });

  it("the walkthrough fixtures sit where they should: 7:50 pm bedtime can ask at 8:00; 6:59 pm can't", async () => {
    const { askForMoreTime } = await import("@/lib/more-time");
    const ten = await setup({ bedtimeOffsetMin: -10 });       // bedtime-ask / -decline / -limit
    expect(await offered(ten, NOW)).toBe(true);
    expect(await askForMoreTime(FAM, ten, "bedtime", undefined, NOW)).toBe("created");
    const late = await setup({ bedtimeOffsetMin: -61 });      // bedtime-final
    expect(await offered(late, NOW)).toBe(false);
    expect(await askForMoreTime(FAM, late, "bedtime", undefined, NOW)).toBe("not-offered");
  });
});
