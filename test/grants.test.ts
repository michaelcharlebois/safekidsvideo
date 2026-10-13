// Grant writes against the real local JSON store in a temp directory: every write names one child,
// checks the child is in the family, and never widens access for anyone else.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { localStore as db, __resetLocalStoreCache, migrateLocalToChildScope } from "@/lib/db/local";
import { addVideoToLibrary, allowForChild, approveRequest, decideForChild, GrantError, FamilyBlockError, NeedsUnreviewedConfirm, recordOpenClearance, removeFamilyBlock, resolveLegacy, splitFamilyBlock, unhideForFamily } from "@/lib/grants";
import { buildLibrary, canPlay } from "@/lib/gate";
import { DEFAULT_PROFILE } from "@/lib/db/store";
import { card, video } from "./fixtures";

const FAM = "fam-1", OTHER = "fam-2";
let dir: string;

async function family() {
  const maya = await db.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Maya", 6), id: "", mode: "open", sort: 0 });
  const leo = await db.upsertProfile({ ...DEFAULT_PROFILE(FAM, "Leo", 4), id: "", mode: "locked", sort: 1 });
  const stranger = await db.upsertProfile({ ...DEFAULT_PROFILE(OTHER, "Stranger", 6), id: "", sort: 0 });
  await db.upsertCard(card(VID2)); // VID2 is reviewed in the store too (VID is not)
  return { maya, leo, stranger };
}
const VID = "vvvvvvvvvv1", VID2 = "vvvvvvvvvv2"; // VID has no review; VID2 has a clean one
const OK = { confirmedUnreviewed: true }; // the parent confirmed the unreviewed disclosure

async function playsFor(profileId: string, cards = [card(VID2)]) {
  const s = await db.getSettings(FAM, profileId);
  const lib = buildLibrary({ videos: [video(VID, "UCx"), video(VID2, "UCx")], channels: [], cards, confirmations: [], whitelist: await db.listWhitelist(FAM), profileId });
  return lib.filter((v) => canPlay(v, s)).map((v) => v.id);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sift-grants-"));
  process.env.SIFT_LOCAL_DB = path.join(dir, "db.json");
  writeFileSync(process.env.SIFT_LOCAL_DB, JSON.stringify({ schema: 18 }));
  __resetLocalStoreCache();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.SIFT_LOCAL_DB; __resetLocalStoreCache(); });

describe("grant writes are child-scoped", () => {
  it("Allow for Maya writes one override for Maya and nothing for Leo", async () => {
    const { maya, leo } = await family();
    await allowForChild(db, FAM, maya.id, VID, OK);
    const wl = await db.listWhitelist(FAM);
    expect(wl.map((w) => [w.kind, w.targetId, w.profileId])).toEqual([["override", VID, maya.id]]);
    expect(await playsFor(maya.id)).toContain(VID); // even though unreviewed
    expect(await playsFor(leo.id)).not.toContain(VID);
  });

  it("approving a request allows it for the child who asked", async () => {
    const { maya, leo } = await family();
    const pid = await approveRequest(db, FAM, { videoId: VID, profileId: leo.id }, null, OK);
    expect(pid).toBe(leo.id);
    expect(await playsFor(leo.id)).toContain(VID);
    expect(await playsFor(maya.id)).not.toContain(VID);
  });

  it("a request that never recorded a child needs the parent to choose — never everyone", async () => {
    await family();
    await expect(approveRequest(db, FAM, { videoId: VID, profileId: null })).rejects.toBeInstanceOf(GrantError);
    expect(await db.listWhitelist(FAM)).toEqual([]);
  });

  it("refuses a child from another family", async () => {
    const { stranger } = await family();
    await expect(allowForChild(db, FAM, stranger.id, VID, OK)).rejects.toThrow(/isn't in this family/);
    await expect(db.addToWhitelist({ familyId: FAM, profileId: stranger.id, kind: "block", targetId: VID })).rejects.toThrow();
  });

  it("review-queue decisions replace that child's earlier decision only", async () => {
    const { maya, leo } = await family();
    await decideForChild(db, FAM, maya.id, VID2, "never");
    await decideForChild(db, FAM, leo.id, VID2, "hide");
    await decideForChild(db, FAM, maya.id, VID2, "allow");
    const wl = (await db.listWhitelist(FAM)).map((w) => `${w.kind}:${w.profileId === maya.id ? "maya" : "leo"}`).sort();
    expect(wl).toEqual(["dismissed:leo", "override:maya"]);
  });

  it("an open-mode clearance is recorded for the checking child only", async () => {
    const { maya, leo } = await family();
    await recordOpenClearance(db, FAM, maya.id, VID2);
    const wl = await db.listWhitelist(FAM);
    expect(wl).toHaveLength(1);
    expect(wl[0]).toMatchObject({ kind: "auto", profileId: maya.id });
    expect(await playsFor(leo.id)).toEqual([]); // Leo is Locked and VID2 isn't in the library
  });

  it("Add & review is a family source, not permission: unreviewed stays off for everyone", async () => {
    const { maya, leo } = await family();
    await addVideoToLibrary(db, FAM, VID);
    await addVideoToLibrary(db, FAM, VID); // idempotent
    expect((await db.listWhitelist(FAM)).filter((w) => w.kind === "video")).toHaveLength(1);
    expect(await playsFor(maya.id)).not.toContain(VID); // unreviewed
    expect(await playsFor(leo.id)).not.toContain(VID);
    await addVideoToLibrary(db, FAM, VID2);
    expect(await playsFor(leo.id)).toEqual([VID2]); // reviewed + passes → plays, via library
  });

  it("family-wide and child rows dedupe independently; removal removes exactly one scope", async () => {
    const { maya } = await family();
    await db.addToWhitelist({ familyId: FAM, kind: "block", targetId: VID, profileId: null });
    await db.addToWhitelist({ familyId: FAM, kind: "block", targetId: VID, profileId: null });
    await db.addToWhitelist({ familyId: FAM, kind: "block", targetId: VID, profileId: maya.id });
    await db.addToWhitelist({ familyId: FAM, kind: "block", targetId: VID, profileId: maya.id });
    expect(await db.listWhitelist(FAM)).toHaveLength(2);
    await db.removeFromWhitelist(FAM, "block", VID, maya.id);
    expect((await db.listWhitelist(FAM)).map((w) => w.profileId ?? null)).toEqual([null]);
  });

  it("override/auto can't be written without a child", async () => {
    await family();
    await expect(db.addToWhitelist({ familyId: FAM, kind: "override", targetId: VID })).rejects.toThrow(/needs a child/);
  });

  it("deleting a child removes their grants", async () => {
    const { maya, leo } = await family();
    await allowForChild(db, FAM, maya.id, VID, OK);
    await allowForChild(db, FAM, leo.id, VID, OK);
    await db.deleteProfile(maya.id);
    expect((await db.listWhitelist(FAM)).map((w) => w.profileId)).toEqual([leo.id]);
  });
});

describe("allowing an unreviewed video needs the parent's explicit confirmation — on every path", () => {
  // Each path, unconfirmed: refused with NeedsUnreviewedConfirm and NOTHING written.
  const paths: [string, (pid: string) => Promise<unknown>][] = [
    ["video page: Allow for", (pid) => allowForChild(db, FAM, pid, VID)],
    ["review queue: Allow", (pid) => decideForChild(db, FAM, pid, VID, "allow")],
    ["request approval", (pid) => approveRequest(db, FAM, { videoId: VID, profileId: pid })],
  ];
  for (const [name, run] of paths) {
    it(`${name}: refused without confirmation, writes nothing`, async () => {
      const { maya } = await family();
      const err = await run(maya.id).catch((e) => e);
      expect(err).toBeInstanceOf(NeedsUnreviewedConfirm);
      expect(err).toMatchObject({ videoId: VID, profileId: maya.id });
      expect(await db.listWhitelist(FAM)).toEqual([]);
      expect(await playsFor(maya.id)).not.toContain(VID);
    });
  }
  it("old-approval re-assignment: refused without confirmation, record stays open", async () => {
    const { maya } = await family();
    await seedLegacy([{ id: "lg1", kind: "override", targetId: VID, candidateProfileIds: [maya.id] }]);
    await expect(resolveLegacy(db, FAM, "lg1", { allowFor: maya.id })).rejects.toBeInstanceOf(NeedsUnreviewedConfirm);
    expect(await db.listLegacyGrants(FAM)).toHaveLength(1);
    expect(await db.listWhitelist(FAM)).toEqual([]);
  });
  it("low-confidence and malformed reviews count as unreviewed here too", async () => {
    const { maya } = await family();
    await db.upsertCard(card(VID, { confidence: 0.4 }));
    await expect(allowForChild(db, FAM, maya.id, VID)).rejects.toBeInstanceOf(NeedsUnreviewedConfirm);
    await db.upsertCard({ ...card(VID), confidence: Number.NaN });
    await expect(allowForChild(db, FAM, maya.id, VID)).rejects.toBeInstanceOf(NeedsUnreviewedConfirm);
  });
  it("a properly reviewed video needs no extra confirmation (the review was the check)", async () => {
    const { maya } = await family();
    await db.upsertCard(card(VID2, { tags: { violence: 3 } })); // reviewed, but Maya's filters hide it
    await decideForChild(db, FAM, maya.id, VID2, "allow");
    expect(await playsFor(maya.id, [card(VID2, { tags: { violence: 3 } })])).toContain(VID2);
  });
});

async function seedLegacy(rows: { id: string; kind: "override" | "auto"; targetId: string; candidateProfileIds: string[] }[]) {
  const raw = JSON.parse(readFileSync(process.env.SIFT_LOCAL_DB!, "utf8"));
  raw.legacyGrants = rows.map((r) => ({ ...r, familyId: FAM, createdAt: "" }));
  writeFileSync(process.env.SIFT_LOCAL_DB!, JSON.stringify(raw));
  __resetLocalStoreCache();
}

describe("old (pre-0018) records", () => {
  it("Allow for <child> on an old OPEN-MODE clearance creates an explicit approval that works in every mode", async () => {
    const { leo } = await family(); // Leo is Locked: an "auto" clearance would be inert for him
    await seedLegacy([{ id: "lg-auto", kind: "auto", targetId: VID2, candidateProfileIds: [leo.id] }]);
    expect(await playsFor(leo.id)).not.toContain(VID2);
    await resolveLegacy(db, FAM, "lg-auto", { allowFor: leo.id });
    const wl = await db.listWhitelist(FAM);
    expect(wl.map((w) => [w.kind, w.targetId, w.profileId])).toEqual([["override", VID2, leo.id]]);
    expect(wl.some((w) => w.kind === "auto")).toBe(false);
    expect(await playsFor(leo.id)).toContain(VID2);
    for (const mode of ["locked", "open_ask", "open"] as const) {
      await db.upsertProfile({ ...(await db.getProfile(leo.id))!, mode });
      expect(await playsFor(leo.id)).toContain(VID2);
    }
  });
  it("Don't allow keeps the record as history and grants nothing", async () => {
    const { maya } = await family();
    await seedLegacy([{ id: "lg-auto", kind: "auto", targetId: VID2, candidateProfileIds: [maya.id] }]);
    await resolveLegacy(db, FAM, "lg-auto", "dismiss");
    expect(await db.listLegacyGrants(FAM)).toEqual([]);
    expect(await db.listWhitelist(FAM)).toEqual([]);
    await expect(resolveLegacy(db, FAM, "lg-auto", { allowFor: maya.id })).rejects.toThrow(/Already handled/);
  });
});

describe('"Keep hidden" through the store', () => {
  it("stays hidden after a better review and relaxed filters; Allow or undo lifts it", async () => {
    const { maya } = await family();
    await addVideoToLibrary(db, FAM, VID2);
    const flagged = [card(VID2, { tags: { violence: 3 } })];
    expect(await playsFor(maya.id, flagged)).not.toContain(VID2);
    await decideForChild(db, FAM, maya.id, VID2, "hide");
    expect(await playsFor(maya.id)).not.toContain(VID2); // re-reviewed clean
    const s = await db.getSettings(FAM, maya.id);
    await db.saveSettings({ ...s, blockedTags: [] }); // filters relaxed
    expect(await playsFor(maya.id, flagged)).not.toContain(VID2);
    await decideForChild(db, FAM, maya.id, VID2, "undo");
    expect(await playsFor(maya.id)).toContain(VID2);
    await decideForChild(db, FAM, maya.id, VID2, "hide");
    await decideForChild(db, FAM, maya.id, VID2, "allow"); // Allow replaces Keep hidden
    expect((await db.listWhitelist(FAM)).filter((w) => w.profileId).map((w) => w.kind)).toEqual(["override"]);
  });
  it("a family-wide (old) Keep hidden can be lifted for everyone without touching children's own decisions", async () => {
    const { maya, leo } = await family();
    await addVideoToLibrary(db, FAM, VID2);
    await db.addToWhitelist({ familyId: FAM, kind: "dismissed", targetId: VID2, profileId: null });
    await decideForChild(db, FAM, leo.id, VID2, "hide");
    expect(await playsFor(maya.id)).not.toContain(VID2);
    await unhideForFamily(db, FAM, VID2);
    expect(await playsFor(maya.id)).toContain(VID2);
    expect(await playsFor(leo.id)).not.toContain(VID2);
  });
});

describe("family-wide (pre-0018) blocks", () => {
  async function familyBlocked() {
    const kids = await family();
    await addVideoToLibrary(db, FAM, VID2);
    await db.addToWhitelist({ familyId: FAM, kind: "block", targetId: VID2, profileId: null });
    return kids;
  }
  it("Allow for one child is refused (not silently ineffective) and writes nothing", async () => {
    const { maya } = await familyBlocked();
    for (const run of [
      () => allowForChild(db, FAM, maya.id, VID2, OK),
      () => decideForChild(db, FAM, maya.id, VID2, "allow"),
      () => approveRequest(db, FAM, { videoId: VID2, profileId: maya.id }, null, OK),
    ]) await expect(run()).rejects.toBeInstanceOf(FamilyBlockError);
    expect((await db.listWhitelist(FAM)).filter((w) => w.kind === "override")).toEqual([]);
    expect(await playsFor(maya.id)).not.toContain(VID2);
  });
  it("split: blocked for every current child, never a gap, then one child can be allowed alone", async () => {
    const { maya, leo } = await familyBlocked();
    await splitFamilyBlock(db, FAM, VID2);
    const blocks = (await db.listWhitelist(FAM)).filter((w) => w.kind === "block").map((w) => w.profileId).sort();
    expect(blocks).toEqual([maya.id, leo.id].sort());
    expect(await playsFor(maya.id)).not.toContain(VID2);
    expect(await playsFor(leo.id)).not.toContain(VID2);
    await allowForChild(db, FAM, maya.id, VID2);
    expect(await playsFor(maya.id)).toContain(VID2);
    expect(await playsFor(leo.id)).not.toContain(VID2); // Leo's restriction untouched
  });
  it("remove: lifts only the family-wide block; a child's own Never stays", async () => {
    const { maya, leo } = await familyBlocked();
    await decideForChild(db, FAM, leo.id, VID2, "never");
    await removeFamilyBlock(db, FAM, VID2);
    expect(await playsFor(maya.id)).toContain(VID2);
    expect(await playsFor(leo.id)).not.toContain(VID2);
  });
  it("split refuses when there's no family-wide block", async () => {
    await family();
    await expect(splitFamilyBlock(db, FAM, VID2)).rejects.toThrow(/isn't blocked/);
  });
});

describe("local-store migration (twin of 0018)", () => {
  it("attributes in one-child families, holds ambiguous ones, keeps blocks, and can be undone", () => {
    const now = "2026-10-01T00:00:00Z";
    const base = {
      channels: [], videos: [], cards: [], confirmations: [], settings: [{ familyId: FAM, kidAge: 7 }],
      profiles: [
        { ...DEFAULT_PROFILE(FAM, "Maya", 6), id: "m", sort: 0, createdAt: now },
        { ...DEFAULT_PROFILE(FAM, "Leo", undefined), id: "l", sort: 1, createdAt: now },
        { ...DEFAULT_PROFILE(OTHER, "Solo", 5), id: "s", sort: 0, createdAt: now },
      ],
      whitelist: [
        { familyId: FAM, kind: "channel", targetId: "UCx", createdAt: now },
        { familyId: FAM, kind: "override", targetId: VID, createdAt: now },
        { familyId: FAM, kind: "block", targetId: VID2, createdAt: now },
        { familyId: OTHER, kind: "auto", targetId: VID, createdAt: now },
      ],
    };
    const d = JSON.parse(JSON.stringify(base));
    expect(migrateLocalToChildScope(d)).toBe(true);
    expect(d.whitelist.map((w: { kind: string; profileId?: string | null }) => `${w.kind}:${w.profileId ?? "all"}`)).toEqual(["channel:all", "block:all", "auto:s"]);
    expect(d.legacyGrants).toHaveLength(1);
    expect(d.legacyGrants[0]).toMatchObject({ kind: "override", targetId: VID, candidateProfileIds: ["m", "l"] });
    expect(d.profiles.find((p: { id: string }) => p.id === "l").age).toBe(7);
    expect(d.whitelistPre0018).toEqual(base.whitelist); // reversible
    expect(migrateLocalToChildScope(d)).toBe(false); // runs once
  });

  it("a held legacy approval grants nothing until a parent assigns it", async () => {
    const { maya, leo } = await family();
    // Put a held approval straight into the file the store reads, as the migration would have.
    const raw = JSON.parse(readFileSync(process.env.SIFT_LOCAL_DB!, "utf8"));
    raw.legacyGrants = [{ id: "lg1", familyId: FAM, kind: "override", targetId: VID, createdAt: "", candidateProfileIds: [maya.id, leo.id] }];
    writeFileSync(process.env.SIFT_LOCAL_DB!, JSON.stringify(raw));
    __resetLocalStoreCache();
    expect(await playsFor(maya.id)).not.toContain(VID);
    expect(await db.listLegacyGrants(FAM)).toHaveLength(1);
    await resolveLegacy(db, FAM, "lg1", { allowFor: maya.id }, OK);
    expect(await db.listLegacyGrants(FAM)).toHaveLength(0);
    expect(await playsFor(maya.id)).toContain(VID);
    expect(await playsFor(leo.id)).not.toContain(VID);
  });
});
