// Saving settings against the real local store: child validation, family-only saves, and section
// isolation (each save writes only its own fields, so concurrent saves of different sections both stick).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { localStore as db, __resetLocalStoreCache } from "@/lib/db/local";
import { DEFAULT_PROFILE } from "@/lib/db/store";
import { profilePatchToColumns } from "@/lib/db/supabase";
import { saveSettingsForm, SettingsError } from "@/lib/settings-save";
import { settingsPatch, sectionsOf } from "@/lib/settings-form";
import { isLocalPath, withParam } from "@/lib/paths";
import { verifyPin } from "@/lib/pin";

const FAM = "fam-1", OTHER = "fam-2";
let dir: string;
const form = (entries: [string, string][]) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const fileState = () => readFileSync(process.env.SIFT_LOCAL_DB!, "utf8");

async function family() {
  const maya = await db.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Maya", 6), id: "", mode: "open", sort: 0, dailyMinutes: 45, blockedTags: ["violence"] });
  const leo = await db.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Leo", 4), id: "", mode: "locked", sort: 1, blockedTags: ["violence", "monsters"] });
  const stranger = await db.upsertProfile({ ...DEFAULT_PROFILE(OTHER, "Stranger", 6), id: "", sort: 0 });
  return { maya, leo, stranger };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sift-settings-"));
  process.env.SIFT_LOCAL_DB = path.join(dir, "db.json");
  writeFileSync(process.env.SIFT_LOCAL_DB, JSON.stringify({ schema: 18 }));
  __resetLocalStoreCache();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.SIFT_LOCAL_DB; __resetLocalStoreCache(); });

describe("child validation", () => {
  it("a stale (deleted) child id is refused and nothing is written — not even to the first child", async () => {
    const { maya, leo } = await family();
    await db.deleteProfile(leo.id);
    const before = fileState();
    await expect(saveSettingsForm(db, FAM, form([["profileId", leo.id], ["section", "time"], ["dailyMinutes", "5"]]))).rejects.toBeInstanceOf(SettingsError);
    expect(fileState()).toBe(before);
    expect((await db.getProfile(maya.id))!.dailyMinutes).toBe(45);
  });

  it("a missing child id is refused for a child section", async () => {
    const { maya } = await family();
    await expect(saveSettingsForm(db, FAM, form([["section", "access"], ["mode", "locked"]]))).rejects.toThrow(/which child/);
    expect((await db.getProfile(maya.id))!.mode).toBe("open");
  });

  it("another family's child is refused", async () => {
    const { stranger } = await family();
    await expect(saveSettingsForm(db, FAM, form([["profileId", stranger.id], ["section", "access"], ["mode", "open"]]))).rejects.toThrow(/isn't in this family/);
    expect((await db.getProfile(stranger.id))!.mode).toBe("locked");
  });

  it("a garbage id is refused", async () => {
    await family();
    await expect(saveSettingsForm(db, FAM, form([["profileId", "not-a-child"], ["section", "content"]]))).rejects.toBeInstanceOf(SettingsError);
  });

  it("the store itself refuses a profile from another family (defence in depth)", async () => {
    const { stranger } = await family();
    await expect(db.updateProfileSettings(FAM, stranger.id, { mode: "open" })).rejects.toThrow();
  });
});

describe("family-only saves", () => {
  it("change only the family's PIN and report threshold, never a child — even if child fields are smuggled in", async () => {
    const { maya, leo } = await family();
    const profilesBefore = JSON.stringify(JSON.parse(fileState()).profiles);
    await saveSettingsForm(db, FAM, form([["section", "family"], ["pin", "2580"], ["flagThreshold", "5"], ["profileId", maya.id], ["mode", "locked"], ["dailyMinutes", "1"]]));
    expect(JSON.stringify(JSON.parse(fileState()).profiles)).toBe(profilesBefore);
    const s = await db.getSettings(FAM, leo.id);
    expect(s.flagThreshold).toBe(5);
    expect(verifyPin("2580", s.pinHash)).toBe(true);
  });

  it("a family save with no child at all works", async () => {
    await family();
    await saveSettingsForm(db, FAM, form([["section", "family"], ["flagThreshold", "7"]]));
    expect((await db.getSettings(FAM)).flagThreshold).toBe(7);
  });

  it("1234 is refused as a PIN", async () => {
    await family();
    await expect(saveSettingsForm(db, FAM, form([["section", "family"], ["pin", "1234"]]))).rejects.toThrow(/1234/);
  });
});

describe("section isolation", () => {
  it("only the section's own fields are in the write", async () => {
    const { maya } = await family();
    const cur = await db.getSettings(FAM, maya.id);
    const f = form([["section", "time"], ["dailyMinutes", "60"], ["mode", "locked"], ["block:monsters", "on"]]);
    expect(settingsPatch(cur, f, sectionsOf(f))).toEqual({ child: { dailyMinutes: 60, bedtime: undefined }, family: {} });
  });

  it("simultaneous saves of different sections, from the same stale page, both stick", async () => {
    const { maya } = await family();
    await Promise.all([
      saveSettingsForm(db, FAM, form([["profileId", maya.id], ["section", "time"], ["dailyMinutes", "30"], ["bedtime", "19:00"]])),
      saveSettingsForm(db, FAM, form([["profileId", maya.id], ["section", "content"], ["block:scary_imagery", "on"]])),
      saveSettingsForm(db, FAM, form([["profileId", maya.id], ["section", "access"], ["mode", "open_ask"], ["dailyCheckLimit", "9"]])),
    ]);
    __resetLocalStoreCache(); // read back from disk
    const p = (await db.getProfile(maya.id))!;
    expect(p).toMatchObject({ dailyMinutes: 30, bedtime: "19:00", blockedTags: ["scary_imagery"], mode: "open_ask", dailyCheckLimit: 9 });
  });

  it("a write applied after a stale read can't undo another section's change", async () => {
    const { maya } = await family();
    const stale = await db.getSettings(FAM, maya.id); // page loaded
    await saveSettingsForm(db, FAM, form([["profileId", maya.id], ["section", "content"], ["block:monsters", "on"]])); // another tab
    const f = form([["section", "time"], ["dailyMinutes", "20"]]);
    await db.updateProfileSettings(FAM, maya.id, settingsPatch(stale, f, sectionsOf(f)).child); // first tab, built from the stale read
    expect((await db.getProfile(maya.id))!).toMatchObject({ blockedTags: ["monsters"], dailyMinutes: 20 });
  });

  it("other children are never touched", async () => {
    const { maya, leo } = await family();
    const leoBefore = JSON.stringify(await db.getProfile(leo.id));
    await saveSettingsForm(db, FAM, form([["profileId", maya.id], ["section", "content"]]));
    expect(JSON.stringify(await db.getProfile(leo.id))).toBe(leoBefore);
  });
});

describe("Supabase column mapping", () => {
  it("writes only the patch's columns; clearing a nullable field writes null", () => {
    expect(profilePatchToColumns({ dailyMinutes: undefined, bedtime: "19:00" })).toEqual({ daily_minutes: null, bedtime: "19:00" });
    expect(profilePatchToColumns({ mode: "open", kidsOnlySearch: false, dailyCheckLimit: 9 })).toEqual({ mode: "open", kids_only_search: false, daily_check_limit: 9 });
    expect(profilePatchToColumns({})).toEqual({});
  });
});

describe("return paths", () => {
  it("only same-site paths, and params go before the #section", () => {
    expect(isLocalPath("/parent/settings?kid=a#screens")).toBe(true);
    expect(isLocalPath("//evil.example")).toBe(false);
    expect(isLocalPath("https://evil.example")).toBe(false);
    expect(isLocalPath("/\\evil")).toBe(false);
    expect(withParam("/parent/settings?kid=a#screens", "saved", "screens")).toBe("/parent/settings?kid=a&saved=screens#screens");
    expect(withParam("/parent/devices", "saved", "screens")).toBe("/parent/devices?saved=screens");
    expect(withParam("/x?saved=time", "saved", "content")).toBe("/x?saved=content");
  });
});
