/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Kid player (fixture "player": Maya has 1 skip, a 2 s free peek, a 60 s cooldown). The YouTube IFrame API is
// replaced by a scripted stand-in (same methods and events; video time runs in real time), and every
// viewing record the page sends is captured: server-action calls and the close-time beacon.
// TV: controls appear/hide, OK pauses, ◀ ▶ move, +10 s seeks, Return leaves. Accounting: playback time vs
// playhead position, one start + one end per session, repeat plays, end of video → server-picked next,
// app closure. Restrictions: seeking ahead doesn't dodge a skip; out of skips → "finish this one first";
// a parent's "Never" on the next video takes effect at auto-advance. Touch: big controls.
const { OUT, MAYA, check, launch, parent, kid, go, press, samsungReturn, done, FAKE_YT } = require("./kid-common.cjs");

/** Capture viewing records: server actions (by their arguments) and the beacon. */
function recorder(ctx) {
  const rec = { starts: [], ends: [], nexts: 0, beacons: [] };
  ctx.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (r.url().endsWith("/api/watch/end")) { try { rec.beacons.push(JSON.parse(r.postDataBuffer()?.toString("utf8") || "{}")); } catch { rec.beacons.push({}); } return; }
    if (!r.headers()["next-action"]) return;
    let a; try { a = JSON.parse(r.postData() || "null"); } catch { return; }
    if (!Array.isArray(a)) return;
    if (a.length === 2 && typeof a[1] === "string" && /^[0-9a-f-]{36}$/.test(a[1])) rec.starts.push({ videoId: a[0], sessionId: a[1] });
    else if (a.length >= 4 && ["finished", "skipped", "left"].includes(a[1])) rec.ends.push({ videoId: a[0], outcome: a[1], atSec: a[2], sessionId: a[3], watchedSec: a[4] });
    else if (a.length === 2 && Array.isArray(a[1])) rec.nexts++;
  });
  return rec;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const controlsShown = (p) => p.evaluate(() => document.querySelector("[data-controls]")?.getAttribute("data-controls") === "shown");
const focusLabel = (p) => p.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 40));
const yt = (p) => p.evaluate(() => ({ id: window.__yt.player?.id, state: window.__yt.player?.state, t: window.__yt.player?.t }));

(async () => {
  const b = await launch();
  const par = await parent(b);
  const tv = await kid(b, "tv");
  await tv.context().addInitScript(FAKE_YT);
  await tv.context().route("**/iframe_api", (r) => r.fulfill({ body: "" }));
  const rec = recorder(tv.context());

  // ---- open a video from Home with the remote ----
  await go(tv, "/watch", 800);
  const first = await tv.evaluate(() => document.activeElement?.getAttribute("href"));
  await press(tv, "Enter"); await tv.waitForURL((u) => /^\/watch\/[\w-]{11}$/.test(u.pathname)); await tv.waitForTimeout(900);
  const vid = new URL(tv.url()).pathname.slice(7);
  check("OK on a Home video opens the player for it", first === `/watch/${vid}`, first);
  check("TV player: controls show on open, focus on Pause (it's playing)", (await controlsShown(tv)) === true && (await focusLabel(tv)) === "Pause");
  await tv.screenshot({ path: `${OUT}/player-tv-controls.png` });
  check("one viewing session started (one start record with a session id)", rec.starts.length === 1 && rec.starts[0].videoId === vid, JSON.stringify(rec.starts));
  await wait(4600);
  check("controls hide while playing", (await controlsShown(tv)) === false);
  await tv.screenshot({ path: `${OUT}/player-tv-playing.png` });
  let before = (await yt(tv)).t;
  await press(tv, "ArrowRight"); await tv.waitForTimeout(250);
  let after = (await yt(tv)).t;
  check("while hidden, an arrow only brings the controls back (no seek), on Play/Pause", (await controlsShown(tv)) === true && after - before < 2 && (await focusLabel(tv)) === "Pause", `${before}→${after}`);
  await press(tv, "Enter"); await tv.waitForTimeout(300);
  check("OK on Pause pauses", (await yt(tv)).state === 2 && (await focusLabel(tv)) === "Play");
  await wait(5000);
  check("paused: the controls stay up", (await controlsShown(tv)) === true);
  await tv.screenshot({ path: `${OUT}/player-tv-paused.png` });
  await press(tv, "Enter"); await tv.waitForTimeout(300);
  check("OK again plays", (await yt(tv)).state === 1);
  await press(tv, "ArrowRight"); await tv.waitForTimeout(150);
  check("Right moves to +10 s", (await focusLabel(tv)) === "Forward 10 seconds", await focusLabel(tv));
  await tv.screenshot({ path: `${OUT}/player-tv-focus-fwd.png` });
  before = (await yt(tv)).t;
  await press(tv, "Enter"); await press(tv, "Enter"); await press(tv, "Enter"); await tv.waitForTimeout(500);
  after = (await yt(tv)).t;
  check("OK on +10 s three times jumps ~30 s", after - before >= 28 && after - before < 33, `${before}→${after}`);
  await press(tv, "ArrowLeft", 3); await tv.waitForTimeout(100);
  check("Left ×3 reaches Home (the first control) and stops there", (await focusLabel(tv)) === "Home");
  await press(tv, "ArrowLeft"); check("…Left at the first control stays put", (await focusLabel(tv)) === "Home");
  // Hide the controls, then Return: leaves the player even when they're hidden.
  await wait(4600);
  const atLeave = (await yt(tv)).t;
  await samsungReturn(tv); await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 8000 }).catch(() => {});
  check("Samsung Return leaves the player to Home (it came from Home)", new URL(tv.url()).pathname === "/watch", tv.url());
  await tv.waitForTimeout(500);
  const e1 = rec.ends.find((e) => e.sessionId === rec.starts[0].sessionId);
  check("one end record for that session, outcome left", rec.ends.filter((e) => e.sessionId === rec.starts[0].sessionId).length === 1 && e1?.outcome === "left", JSON.stringify(rec.ends));
  check("position and playback time are separate: playhead ~40 s in, but only ~15 s actually played (pause and seeks not counted)",
    e1 && Math.abs(e1.atSec - atLeave) < 2 && e1.atSec >= 35 && e1.watchedSec >= 10 && e1.watchedSec <= 20, JSON.stringify(e1));

  // ---- repeated playback of the same video: a second, separate session ----
  await go(tv, `/watch/${vid}`, 1200);
  await samsungReturn(tv); await tv.waitForURL((u) => u.pathname === "/watch").catch(() => {}); await tv.waitForTimeout(400);
  const mine = rec.starts.filter((s) => s.videoId === vid);
  check("playing the same video again is a new session (new id), and it ends once", mine.length === 2 && mine[0].sessionId !== mine[1].sessionId && rec.ends.filter((e) => e.sessionId === mine[1].sessionId).length === 1);

  // ---- end of video → the server picks the next one (and a parent's change applies) ----
  await tv.evaluate(() => sessionStorage.setItem("fakeDur", "4"));
  await go(tv, `/watch/${vid}`, 800);
  // Which video is next in order, by title, and its id on Home.
  await press(tv, "ArrowDown"); await tv.waitForTimeout(150);
  const nextTitle = await tv.evaluate(() => [...document.querySelectorAll("[data-player-btn]")].pop()?.querySelector("span span")?.textContent?.trim());
  await samsungReturn(tv); await tv.waitForURL((u) => u.pathname === "/watch").catch(() => {}); await tv.waitForTimeout(500);
  const nextId = await tv.evaluate((t) => [...document.querySelectorAll(".kid-bf a[href^='/watch/']")].find((a) => a.textContent.includes(t))?.getAttribute("href")?.slice(7, 18), nextTitle);
  check("the player shows which video is next", !!nextTitle && !!nextId, `${nextTitle} ${nextId}`);
  // Parent: Never for Maya on that next video.
  await go(par, `/parent/library?kid=${MAYA}`);
  await par.locator(`form:has(input[name="videoId"][value="${nextId}"]):has(button[value="never"])`).first().evaluate((f) => f.requestSubmit(f.querySelector('button[value="never"]')));
  await par.waitForURL(/decided=never/, { timeout: 10000 }).catch(() => {});
  check("parent chose Never for Maya on the next video", /decided=never/.test(par.url()), par.url());
  const startsBefore = rec.starts.length, endsBefore = rec.ends.length;
  await go(tv, `/watch/${vid}`, 200);
  await wait(6500); // 4 s video, then the server's pick starts
  const finished = rec.ends.slice(endsBefore).find((e) => e.videoId === vid);
  check("at the end: one 'finished' record whose playback time is the ~4 s actually played", finished?.outcome === "finished" && finished.watchedSec >= 3 && finished.watchedSec <= 6, JSON.stringify(rec.ends.slice(endsBefore)));
  const auto = rec.starts.slice(startsBefore).filter((s) => s.videoId !== vid);
  check("auto-advance asked the server and started the next video", rec.nexts >= 1 && auto.length === 1, JSON.stringify(rec.starts.slice(startsBefore)));
  check("the video the parent just blocked was skipped by the server (stale list or not)", auto[0] && auto[0].videoId !== nextId, `${auto[0]?.videoId} vs blocked ${nextId}`);
  await go(tv, `/watch/${nextId}`, 600);
  check("opening the blocked video directly shows no player", (await tv.locator("[data-player]").count()) === 0);
  await tv.evaluate(() => sessionStorage.setItem("fakeDur", "60"));

  // ---- app closure: the end goes out as a beacon ----
  await go(tv, `/watch/${vid}`, 3000);
  await tv.goto("about:blank"); await wait(800); // the page goes away (as when the TV app quits): pagehide
  await go(tv, "/watch", 300);
  const sent = await tv.evaluate(() => JSON.parse(localStorage.getItem("beacons") || "[]"));
  const beacon = sent.length ? JSON.parse(sent[sent.length - 1].body || "{}") : null;
  check("closing the app sends the session's end as a beacon (outcome left, with playback time)", beacon && rec.beacons.length > 0 && beacon.outcome === "left" && beacon.videoId === vid && beacon.watchedSec >= 1 && beacon.watchedSec <= 5, JSON.stringify(sent) + " delivered: " + rec.beacons.length);

  // ---- skips: seeking ahead doesn't make a skip free; out of skips → finish this one first ----
  await go(tv, `/watch/${vid}`, 3500);           // ~3 s of playing: past the 2 s free peek
  await press(tv, "ArrowRight"); await press(tv, "ArrowRight"); // show controls, move to +10
  for (let i = 0; i < 5; i++) await press(tv, "Enter");         // playhead ~53 s of 60 (88%)
  await press(tv, "ArrowRight", 3); await tv.waitForTimeout(200); // Next
  const skipsBefore = await tv.evaluate(() => document.querySelector("[aria-label$='skips left']")?.getAttribute("aria-label"));
  await press(tv, "Enter"); await tv.waitForTimeout(1500);
  const moved = new URL(tv.url()).pathname !== `/watch/${vid}`;
  const skipsAfter = await tv.evaluate(() => document.querySelector("[aria-label$='skips left']")?.getAttribute("aria-label"));
  check("Next after jumping to 88% still counts as a skip (judged on the ~3 s played, not the playhead)", moved && skipsBefore === "1 skips left" && skipsAfter === "0 skips left", `${skipsBefore} → ${skipsAfter}, moved=${moved}`);
  const second = new URL(tv.url()).pathname;
  await wait(3000);
  await press(tv, "ArrowRight"); await press(tv, "ArrowRight", 3); await press(tv, "Enter"); await tv.waitForTimeout(700);
  check("out of skips: Next says to finish this one first and stays on the video", new URL(tv.url()).pathname === second && /finish this one first/.test(await tv.innerText("[data-player]")), tv.url());
  await tv.screenshot({ path: `${OUT}/player-tv-skip-locked.png` });

  // ---- touch: big controls, tap shows/hides ----
  for (const kind of ["tablet", "phone"]) {
    const t = await kid(b, kind);
    await t.context().addInitScript(FAKE_YT);
    await t.context().route("**/iframe_api", (r) => r.fulfill({ body: "" }));
    await go(t, `/watch/${vid}`, 1000);
    const sizes = await t.evaluate(() => [...document.querySelectorAll("[data-player-btn]")].map((x) => { const r = x.getBoundingClientRect(); return [x.getAttribute("aria-label") || x.textContent.trim(), Math.round(r.width), Math.round(r.height)]; }));
    check(`${kind}: every control is at least 56 px tall, Play/Pause at least 88 px`, sizes.every(([, , h]) => h >= 56) && sizes.some(([l, w]) => /Play|Pause/.test(l) && w >= 88), JSON.stringify(sizes));
    await t.screenshot({ path: `${OUT}/player-${kind}-controls.png` });
    await t.locator('[data-player-btn][aria-label="Pause"]').tap(); await t.waitForTimeout(300);
    check(`${kind}: tapping Pause pauses; controls stay`, (await yt(t)).state === 2 && (await controlsShown(t)) === true);
    await t.screenshot({ path: `${OUT}/player-${kind}-paused.png` });
    await t.locator('[data-player-btn][aria-label="Play"]').tap(); await wait(4700);
    check(`${kind}: playing, the controls hide on their own`, (await controlsShown(t)) === false);
    await t.mouse.click(10, 300); await t.waitForTimeout(300);
    check(`${kind}: a tap on the video brings them back`, (await controlsShown(t)) === true);
    await t.locator("[data-player-btn]", { hasText: "Home" }).tap(); await t.waitForURL((u) => u.pathname === "/watch").catch(() => {});
    check(`${kind}: Home leaves the player`, new URL(t.url()).pathname === "/watch");
  }

  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
