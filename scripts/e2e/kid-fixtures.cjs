/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Builds kid-screen scenario databases from the UX fixture (local mode). Usage: node kid-fixtures.cjs <scenario> <out.json>
//   empty   — nothing playable for anyone (no family sources, no exceptions); Maya can search (Open)
//   waiting — as empty, plus a pending request from Maya
//   locked  — as empty, and Maya is Locked (no search)
//   main    — the UX fixture as is
//   timeup  — Maya is past her "done for the day" time (10 minutes ago, family time zone)
//   askfirst — the UX fixture with Maya in Ask first
//   limit / limit-decline — Maya has watched 50 of her 45 minutes today (local viewing records), and has a
//             pending more-time ask left over from yesterday (expired)
//   bedtime-ask / bedtime-decline — Maya's bedtime was 10 minutes ago (no daily limit)
//   bedtime-limit — as bedtime-ask, and Maya has also used all 45 of her minutes today
//   bedtime-soon  — Maya's bedtime is in 3 minutes
//   player  — the UX fixture with a tight skip budget for Maya (1 skip, 2 s free peek, 60 s cooldown)
// Every scenario clears bedtimes first, so results don't depend on the clock (except timeup, which sets one).
const fs = require("node:fs");
const [, , scenario, out] = process.argv;
const d = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "ux-fixture-db.json"), "utf8"));
const F = "00000000-0000-0000-0000-000000000001", MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
d.profiles = d.profiles.map((p) => ({ ...p, bedtime: undefined }));
if (["empty", "waiting", "locked"].includes(scenario)) d.whitelist = d.whitelist.filter((w) => !["channel", "video", "override", "auto"].includes(w.kind));
if (scenario === "waiting") d.requests = [{ id: "11111111-aaaa-4aaa-8aaa-000000000001", familyId: F, profileId: MAYA, videoId: "fxSSS000002", status: "pending", createdAt: "2026-10-13T15:00:00Z" }];
if (scenario === "limit" || scenario === "limit-decline") {
  const now = Date.now();
  d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, dailyMinutes: 45, bonusMinutes: undefined, bonusDay: undefined } : p));
  const sid = "22222222-bbbb-4bbb-8bbb-000000000001";
  d.watchEvents = [
    { familyId: F, videoId: "fxSSS000001", profileId: MAYA, startedAt: new Date(now - 120000).toISOString(), completed: false, sessionId: sid },
    { familyId: F, videoId: "fxSSS000001", profileId: MAYA, startedAt: new Date(now - 60000).toISOString(), completed: true, outcome: "finished", endedAtSec: 180, watchedSec: 3000, sessionId: sid },
  ];
  d.timeRequests = [{ id: "33333333-cccc-4ccc-8ccc-000000000001", familyId: F, profileId: MAYA, kind: "limit", day: new Date(now - 86400000).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }), status: "pending", createdAt: new Date(now - 86400000).toISOString() }];
}
const laClock = (ms) => new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
if (scenario.startsWith("bedtime") || scenario === "timeup") {
  const now = Date.now();
  const bedtime = laClock(scenario === "bedtime-soon" ? now + 3 * 60000 : now - 10 * 60000);
  d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, bedtime, dailyMinutes: scenario === "bedtime-limit" ? 45 : undefined, bonusMinutes: undefined, bonusDay: undefined } : p));
  if (scenario === "bedtime-limit") {
    const sid = "22222222-bbbb-4bbb-8bbb-000000000002";
    d.watchEvents = [
      { familyId: F, videoId: "fxSSS000001", profileId: MAYA, startedAt: new Date(now - 120000).toISOString(), completed: false, sessionId: sid },
      { familyId: F, videoId: "fxSSS000001", profileId: MAYA, startedAt: new Date(now - 60000).toISOString(), completed: true, outcome: "finished", endedAtSec: 180, watchedSec: 3000, sessionId: sid },
    ];
  }
}
if (scenario === "player") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, skipLimit: 1, skipRegen: 1, skipCooldownSec: 60, freePeekSec: 2 } : p));
if (scenario === "askfirst") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, mode: "open_ask" } : p));
if (scenario === "locked") d.profiles = d.profiles.map((p) => (p.id === MAYA ? { ...p, mode: "locked" } : p));
fs.writeFileSync(out, JSON.stringify(d));
