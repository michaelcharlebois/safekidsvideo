/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Builds kid-screen scenario databases from the UX fixture (local mode). Usage: node kid-fixtures.cjs <scenario> <out.json>
//   empty   — nothing playable for anyone (no family sources, no exceptions); Maya can search (Open)
//   waiting — as empty, plus a pending request from Maya
//   locked  — as empty, and Maya is Locked (no search)
//   main    — the UX fixture as is
//   timeup  — Maya is past her "done for the day" time
//   askfirst — the UX fixture with Maya in Ask first
// Every scenario clears bedtimes first, so results don't depend on the clock (except timeup, which sets one).
const fs = require("node:fs");
const [, , scenario, out] = process.argv;
const d = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "ux-fixture-db.json"), "utf8"));
const F = "00000000-0000-0000-0000-000000000001", MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
d.profiles = d.profiles.map((p) => ({ ...p, bedtime: undefined }));
if (scenario === "timeup") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, bedtime: "00:00" } : p));
if (["empty", "waiting", "locked"].includes(scenario)) d.whitelist = d.whitelist.filter((w) => !["channel", "video", "override", "auto"].includes(w.kind));
if (scenario === "waiting") d.requests = [{ id: "11111111-aaaa-4aaa-8aaa-000000000001", familyId: F, profileId: MAYA, videoId: "fxSSS000002", status: "pending", createdAt: "2026-10-13T15:00:00Z" }];
if (scenario === "askfirst") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, mode: "open_ask" } : p));
if (scenario === "locked") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, mode: "locked" } : p));
fs.writeFileSync(out, JSON.stringify(d));
