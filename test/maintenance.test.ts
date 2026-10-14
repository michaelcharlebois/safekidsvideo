// The rollback pause: with BF_PERMISSION_WRITES_PAUSED=1 permission writes are refused at the app's store,
// requests and asks; reading and viewing still work.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "bf-pause-")); process.env.SIFT_LOCAL_DB = path.join(dir, "db.json"); });
afterAll(() => { delete process.env.BF_PERMISSION_WRITES_PAUSED; rmSync(dir, { recursive: true, force: true }); });

describe("permission writes paused", () => {
  it("whitelist writes, legacy decisions, video requests and more-time asks are refused; reads work", async () => {
    const { db } = await import("@/lib/db/resolve");
    const { createRequest, logWatchStart } = await import("@/lib/activity");
    const { askForMoreTime, grantBedtimeExtension } = await import("@/lib/more-time");
    const { PermissionWritesPaused } = await import("@/lib/maintenance");
    process.env.BF_PERMISSION_WRITES_PAUSED = "1";
    await expect(db.addToWhitelist({ familyId: "f", kind: "block", targetId: "vvvvvvvvvv1", profileId: null })).rejects.toBeInstanceOf(PermissionWritesPaused);
    await expect(db.removeFromWhitelist("f", "block", "vvvvvvvvvv1", null)).rejects.toBeInstanceOf(PermissionWritesPaused);
    await expect(db.resolveLegacyGrant("f", "x", "dismissed")).rejects.toBeInstanceOf(PermissionWritesPaused);
    await expect(createRequest("f", "vvvvvvvvvv1", undefined, "r", "p")).rejects.toBeInstanceOf(PermissionWritesPaused);
    expect(await askForMoreTime("f", "p", "limit")).toBe("unavailable");
    await expect(grantBedtimeExtension("f", "p", 15)).rejects.toBeInstanceOf(PermissionWritesPaused);
    expect(await db.listWhitelist("f")).toEqual([]);                                                       // reading still works
    await expect(logWatchStart("f", "vvvvvvvvvv1", undefined, "p", "11111111-1111-4111-8111-111111111111")).resolves.toBeUndefined(); // viewing still recorded
    delete process.env.BF_PERMISSION_WRITES_PAUSED;
    await expect(db.addToWhitelist({ familyId: "f", kind: "block", targetId: "vvvvvvvvvv1", profileId: null })).resolves.toBeUndefined();
  });
});
