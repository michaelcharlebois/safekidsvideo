// The rollback pause (BF_PERMISSION_WRITES_PAUSED=1): every write that could change what a child may watch is
// refused, and the child's EFFECTIVE permissions — what plays, the time state, the settings the gate reads —
// are identical before and after every attempt. Viewing records and reading still work.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { card, video } from "./fixtures";

const FAM = "00000000-0000-0000-0000-000000000001";
let dir: string;
let pid = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "bf-pause-"));
  process.env.SIFT_LOCAL_DB = path.join(dir, "db.json");
  writeFileSync(process.env.SIFT_LOCAL_DB, JSON.stringify({ channels: [], videos: [], cards: [], confirmations: [], whitelist: [], settings: [], schema: 18 }));
  const { localStore, __resetLocalStoreCache } = await import("@/lib/db/local");
  __resetLocalStoreCache();
  const { DEFAULT_PROFILE } = await import("@/lib/db/store");
  pid = (await localStore.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Maya", 6), id: "", mode: "open", sort: 0, dailyMinutes: 45, bedtime: "19:30" })).id;
  await localStore.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Leo", 4), id: "", mode: "locked", sort: 1 });
  for (const v of ["vvvvvvvvvv1", "vvvvvvvvvv2", "vvvvvvvvvv3"]) { await localStore.upsertVideo(video(v, "UCsongs")); await localStore.upsertCard(card(v)); }
  await localStore.addToWhitelist({ familyId: FAM, kind: "channel", targetId: "UCsongs", profileId: null });
  await localStore.addToWhitelist({ familyId: FAM, kind: "block", targetId: "vvvvvvvvvv3", profileId: null });
});
afterAll(() => { delete process.env.BF_PERMISSION_WRITES_PAUSED; rmSync(dir, { recursive: true, force: true }); });

/** Everything the gate and the time limits read for Maya, as one comparable value. */
async function effective() {
  const { getLibrary, childSettings, playableFor } = await import("@/lib/queries");
  const { timeState } = await import("@/lib/screentime");
  const { db } = await import("@/lib/db/resolve");
  const s = (await childSettings(FAM, pid))!;
  const t = await timeState(FAM, s, undefined, new Date("2026-10-13T20:00:00Z")); // 13:00 in Los Angeles
  return JSON.stringify({
    plays: playableFor(await getLibrary(FAM, pid), s).map((v) => v.id),
    mode: s.mode, tags: s.blockedTags, formats: s.blockedFormats, minutes: s.dailyMinutes, bedtime: s.bedtime, bonus: s.bonusMinutes ?? 0,
    pin: (await db.getSettings(FAM, pid)).pinHash, profiles: (await db.listProfiles(FAM)).map((p) => p.id), time: t.allowed,
  });
}

describe("permission writes paused", () => {
  it("every authorization-affecting write is refused, and Maya's effective permissions don't change", async () => {
    const { db } = await import("@/lib/db/resolve");
    const { PermissionWritesPaused } = await import("@/lib/maintenance");
    const { saveSettingsForm } = await import("@/lib/settings-save");
    const { allowForChild, decideForChild } = await import("@/lib/grants");
    const { grantBonusMinutes } = await import("@/lib/screentime");
    const { createRequest } = await import("@/lib/activity");
    const { askForMoreTime, grantBedtimeExtension, cancelBedtimeExtension } = await import("@/lib/more-time");
    const { saveTimezone } = await import("@/lib/checkin");
    const before = await effective();
    process.env.BF_PERMISSION_WRITES_PAUSED = "1";
    const form = (o: Record<string, string>) => { const f = new Map(Object.entries(o)); return { get: (k: string) => f.get(k) ?? null, getAll: (k: string) => (f.has(k) ? [f.get(k)!] : []) }; };
    const refused: [string, () => Promise<unknown>][] = [
      ["viewing mode", () => saveSettingsForm(db, FAM, form({ section: "mode", profileId: pid, mode: "open" }) as never)],
      ["content filters", () => db.updateProfileSettings(FAM, pid, { blockedTags: [] } as never)],
      ["screen time", () => saveSettingsForm(db, FAM, form({ section: "time", profileId: pid, dailyMinutes: "600", bedtime: "" }) as never)],
      ["PIN", () => db.updateFamilySettings(FAM, { pinHash: "0000" } as never)],
      ["profile edit", () => db.getProfile(pid).then((p) => db.upsertProfile({ ...p!, mode: "open", blockedTags: [] }))],
      ["profile create", () => db.upsertProfile({ familyId: FAM, id: "", name: "New" } as never)],
      ["profile delete", () => db.deleteProfile(pid)],
      ["family record (time zone, plan)", () => db.updateFamily(FAM, { timezone: "Pacific/Kiritimati" })],
      ["direct extra minutes", () => grantBonusMinutes(pid, 60)],
      ["allow a video", () => allowForChild(db, FAM, pid, "vvvvvvvvvv2", { confirmedUnreviewed: true })],
      ["a per-child decision", () => decideForChild(db, FAM, pid, "vvvvvvvvvv1", "never")],
      ["family source", () => db.addToWhitelist({ familyId: FAM, kind: "channel", targetId: "UCother", profileId: null })],
      ["remove a restriction", () => db.removeFromWhitelist(FAM, "block", "vvvvvvvvvv3", null)],
      ["old-record decision", () => db.resolveLegacyGrant(FAM, "x", "dismissed")],
      ["a review", () => db.upsertCard({ ...card("vvvvvvvvvv3"), confidence: 0.99 })],
      ["a parent flag", () => db.upsertConfirmation({ videoId: "vvvvvvvvvv1", familyId: FAM, verdict: "agree" } as never)],
      ["video request", () => createRequest(FAM, "vvvvvvvvvv3", undefined, "r", pid)],
      ["bedtime extension", () => grantBedtimeExtension(FAM, pid, 30)],
      ["cancel extension", () => cancelBedtimeExtension(FAM, pid)],
    ];
    const { assignDevice, setDeviceActiveProfile, createPairingCode, redeemPairingCode } = await import("@/lib/family");
    refused.push(
      ["device assignment (personal/shared)", () => assignDevice(FAM, "dev", pid)],
      ["switching a shared screen to another child", () => setDeviceActiveProfile(FAM, "dev", pid)],
      ["pairing a new screen", () => createPairingCode(FAM)],
    );
    for (const [what, run] of refused) await expect(run(), what).rejects.toBeInstanceOf(PermissionWritesPaused);
    expect(await redeemPairingCode("ABC123", "TV")).toEqual({ error: new PermissionWritesPaused().message });
    expect(await askForMoreTime(FAM, pid, "limit")).toBe("unavailable");
    await saveTimezone(FAM, "Pacific/Kiritimati"); // silently skipped while paused
    expect(await effective()).toBe(before);
    delete process.env.BF_PERMISSION_WRITES_PAUSED;
  });

  it("reading and viewing records still work while paused; writes resume after", async () => {
    const { db } = await import("@/lib/db/resolve");
    const { logWatchStart } = await import("@/lib/activity");
    process.env.BF_PERMISSION_WRITES_PAUSED = "1";
    expect((await db.listWhitelist(FAM)).length).toBe(2);
    await expect(logWatchStart(FAM, "vvvvvvvvvv1", undefined, pid, "11111111-1111-4111-8111-111111111111")).resolves.toBeUndefined();
    delete process.env.BF_PERMISSION_WRITES_PAUSED;
    await expect(db.addToWhitelist({ familyId: FAM, kind: "block", targetId: "vvvvvvvvvv2", profileId: null })).resolves.toBeUndefined();
  });
});
