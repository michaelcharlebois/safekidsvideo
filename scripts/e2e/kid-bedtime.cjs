/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// One-night bedtime extension (fixtures in kid-fixtures.cjs; family time zone America/Los_Angeles):
//   bedtime-ask     — Maya's bedtime passed 10 min ago. She asks on the TV (a phone is open too); the parent
//                     approves "until …" in Review; both screens come back with "Staying up until …"; the
//                     parent changes the recurring bedtime (the authorized cutoff stays); the parent cancels
//                     mid-video and the player stops on the next server check (as after waking).
//   bedtime-decline — declined: "A grown-up said not tonight", no second ask; a parent can still grant directly.
//   bedtime-limit   — bedtime passed AND the daily minutes are used up: the parent is told an extension alone
//                     won't restore playback; extension only → the daily-limit screen; + minutes → watching.
//   bedtime-soon    — bedtime in 3 min: the player's five-minute warning; it stops at the boundary after a
//                     simulated sleep/wake; and the server refuses playback once bedtime has passed.
const { OUT, MAYA, check, launch, parent, kid, go, active, press, db, done, focusedContrast, FAKE_YT } = require("./kid-common.cjs");
const FIXTURE = process.env.FIXTURE;
const TZ = "America/Los_Angeles";
const nightNow = () => { const t = Date.now(); const h = Number(new Date(t).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" })); return new Date(h < 4 ? t - 86400000 : t).toLocaleDateString("en-CA", { timeZone: TZ }); };
const asks = () => (db().timeRequests ?? []).filter((r) => r.profileId === MAYA && r.kind === "bedtime");
const exts = () => (db().bedtimeExtensions ?? []).filter((e) => e.profileId === MAYA);
const live = () => exts().find((e) => !e.cancelledAt);
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const focusableWith = (p, text) => p.evaluate((t) => [...document.querySelectorAll("a, button, [tabindex]")].some((el) => (el.textContent || "").includes(t)), text);
const recorder = (ctx) => { const ends = []; ctx.on("request", (r) => { if (r.method() !== "POST" || !r.headers()["next-action"]) return; try { const a = JSON.parse(r.postData() || "null"); if (Array.isArray(a) && ["finished", "skipped", "left"].includes(a[1])) ends.push({ videoId: a[0], outcome: a[1] }); } catch { /* */ } }); return ends; };

(async () => {
  const b = await launch();
  const par = await parent(b);

  if (FIXTURE === "bedtime-soon") {
    const tv = await kid(b, "tv");
    await tv.clock.install(); // the page's clock: lets the test simulate the TV sleeping past bedtime
    await tv.context().addInitScript(FAKE_YT);
    await tv.context().route("**/iframe_api", (r) => r.fulfill({ body: "" }));
    const ends = recorder(tv.context());
    await go(tv, "/watch", 300);
    await tv.evaluate(() => sessionStorage.setItem("fakeDur", "1800")); // a long video: it mustn't end on its own
    await go(tv, "/watch/fxSSS000001", 1500);
    const warn = await tv.locator("[data-time-warning]").innerText().catch(() => "");
    check("player: a calm heads-up in the last five minutes (\"N minutes until bedtime\")", /[1-3] minutes? until bedtime/.test(warn), warn);
    await tv.screenshot({ path: `${OUT}/bedtime-player-tv-warning.png` });
    await tv.clock.fastForward("04:00"); // the TV slept past bedtime and woke
    await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
    check("after the device wakes past bedtime, the player stops at once and leaves", new URL(tv.url()).pathname === "/watch", tv.url());
    check("…and the viewing session is ended (left)", ends.some((e) => e.videoId === "fxSSS000001" && e.outcome === "left"), JSON.stringify(ends));
    // Real time catches up: the server refuses playback after bedtime, whatever the client does.
    const fresh = await kid(b, "phone");
    await new Promise((r) => setTimeout(r, Math.max(0, 3.2 * 60000 - 20000)));
    await until(async () => { await go(fresh, "/watch/fxSSS000001", 300); return /Time to rest/.test(await fresh.innerText("body")); }, 60000);
    check("server: once bedtime has passed, the player page shows Time to rest (no player)", /Time to rest/.test(await fresh.innerText("body")) && (await fresh.locator("[data-player]").count()) === 0);
    await b.close();
    return done();
  }

  const tv = await kid(b, "tv");
  const ph = await kid(b, "phone");
  await go(tv, "/watch", 800); await go(ph, "/watch", 600);
  const t0 = await tv.innerText(".kid-bf");
  check("bedtime: the calm Time to rest screen", /Time to rest, Maya/.test(t0) && /done for today/.test(t0));
  let a = await active(tv);
  check("TV focus starts on \"Ask to stay up a little longer\", legible when focused", /Ask to stay up a little longer/.test(a.text) && (await focusedContrast(tv)).ratio >= 4.5, JSON.stringify(a));
  await tv.screenshot({ path: `${OUT}/bedtime-tv-ask.png` });
  await ph.screenshot({ path: `${OUT}/bedtime-phone-ask.png` });

  // Ask on the TV.
  await press(tv, "Enter"); await tv.waitForTimeout(900);
  check("asking: one stored bedtime ask for tonight", asks().length === 1 && asks()[0].status === "pending" && asks()[0].day === nightNow(), JSON.stringify(asks()));
  check("the TV shows \"Sent! Waiting for a grown-up\" as a status, not a button", /Sent! Waiting for a grown-up/.test(await tv.innerText(".kid-bf")) && !(await focusableWith(tv, "Waiting for a grown-up")));
  await tv.screenshot({ path: `${OUT}/bedtime-tv-waiting.png` });
  // The phone still shows the old button: pressing it doesn't make a second ask.
  await ph.locator("button", { hasText: "Ask to stay up a little longer" }).tap(); await ph.waitForTimeout(900);
  check("a second screen's ask is the same one (still one ask; phone says Waiting)", asks().length === 1 && /Waiting for a grown-up/.test(await ph.innerText(".kid-bf")), JSON.stringify(asks()));

  // Parent: Review shows the ask with each choice's actual cutoff.
  await go(par, "/parent/review", 500);
  const rev = await par.innerText("main");
  check("Review: the ask, tonight's bedtime, and choices that show the actual cutoff", /Maya is asking to stay up a little later tonight/.test(rev) && /Bedtime is \d+:\d\d [AP]M/.test(rev) && (await par.locator('button[aria-label^="Let Maya watch until"]').count()) >= 3, rev.slice(0, 300));

  if (FIXTURE === "bedtime-limit") {
    check("…and it says the daily minutes are used up too, offering minutes separately", /also used all 45 minutes/.test(rev) && (await par.locator("button", { hasText: "Add 15 min today" }).count()) >= 1);
    await par.screenshot({ path: `${OUT}/bedtime-parent-review-limit.png`, fullPage: true });
    await par.locator('button[aria-label^="Let Maya watch until"]').nth(1).click();
    await until(() => !!live());
    await go(tv, "/watch", 600);
    const t = await tv.innerText(".kid-bf");
    check("extension only: still no videos — the daily-limit screen, with its own ask", /That's all for today, Maya!/.test(t) && /Ask a grown-up for more time/.test(t), t.slice(0, 160));
    await tv.screenshot({ path: `${OUT}/bedtime-tv-extended-but-limit.png` });
    // The child asks for minutes too (a separate, explicit ask); the parent adds 15.
    await go(tv, "/watch", 600); await press(tv, "Enter"); await tv.waitForTimeout(900);
    const minutesAsk = (db().timeRequests ?? []).find((r) => r.profileId === MAYA && r.kind === "limit" && r.status === "pending");
    check("the daily-minutes ask is separate from the bedtime ask", !!minutesAsk && asks().length === 1);
    await go(par, "/parent/review", 400);
    await par.locator(`form:has(input[name="requestId"][value="${minutesAsk.id}"]):has(input[name="minutes"][value="15"]) button`).click();
    await until(() => (db().profiles.find((p) => p.id === MAYA).bonusMinutes ?? 0) >= 15);
    await go(tv, "/watch", 800);
    const t2 = await tv.innerText(".kid-bf");
    check("with minutes added as well, Maya can watch (chip: the later bedtime, and minutes left)", /Staying up until/.test(t2) && /min left today/.test(t2), t2.slice(0, 160));
    await b.close();
    return done();
  }

  if (FIXTURE === "bedtime-decline") {
    await par.locator("button", { hasText: "Not tonight" }).click();
    await until(() => asks()[0].status === "denied");
    await go(tv, "/watch", 600);
    check("declined: \"A grown-up said not tonight\" as a status, with no ask button", /A grown-up said not tonight/.test(await tv.innerText(".kid-bf")) && (await tv.locator("button", { hasText: /stay up/ }).count()) === 0 && !(await focusableWith(tv, "not tonight")));
    await tv.screenshot({ path: `${OUT}/bedtime-tv-declined.png` });
    await go(par, `/parent?kid=${MAYA}`, 500);
    await par.locator("summary", { hasText: "Let Maya stay up later tonight" }).click();
    await par.locator("button", { hasText: /^Let Maya watch until/ }).nth(1).click();
    await until(() => !!live());
    await go(tv, "/watch", 800);
    check("a parent can still grant directly after declining: Maya is watching again", /Staying up until/.test(await tv.innerText(".kid-bf")));
    check("…and the child still can't ask again tonight (one ask per night)", asks().length === 1);
    await b.close();
    return done();
  }

  // bedtime-ask: approve "until …" (the second choice: +30).
  const choice = await par.locator('button[aria-label^="Let Maya watch until"]').nth(1).getAttribute("aria-label");
  await par.screenshot({ path: `${OUT}/bedtime-parent-review.png`, fullPage: true });
  await par.locator('button[aria-label^="Let Maya watch until"]').nth(1).click();
  await until(() => !!live() && asks()[0].status === "approved");
  const e = live();
  check("approved: tonight's extension stores the cutoff the parent saw", e && e.extraMinutes === 30 && choice.includes(clock(e.cutoffAt)) && e.night === nightNow() && asks()[0].grantedMinutes === 30, JSON.stringify([choice, e]));
  check("…and no viewing minutes were added", !(db().profiles.find((p) => p.id === MAYA).bonusMinutes > 0));
  await tv.waitForTimeout(16000); // the waiting screen refreshes itself
  const home = await tv.innerText(".kid-bf");
  check("the TV comes back by itself, showing \"Staying up until …\"", new RegExp(`Staying up until ${clock(e.cutoffAt)}`).test(home), home.slice(0, 160));
  await tv.screenshot({ path: `${OUT}/bedtime-tv-extended-home.png` });
  await go(ph, "/watch", 600);
  check("the phone too", /Staying up until/.test(await ph.innerText(".kid-bf")));
  await ph.screenshot({ path: `${OUT}/bedtime-phone-extended-home.png` });
  await go(par, `/parent?kid=${MAYA}`, 500);
  check("parent Home: \"Maya can watch until … tonight\" with Cancel", new RegExp(`Maya can watch until ${clock(e.cutoffAt)} tonight`).test(await par.innerText("main")));
  await par.screenshot({ path: `${OUT}/bedtime-parent-home-extended.png` });

  // The recurring bedtime changes (an hour earlier): tonight's authorized cutoff stays as it was.
  await go(par, `/parent/settings?kid=${MAYA}`, 400);
  const bt = await par.locator('input[name="bedtime"]').inputValue();
  const [h, m] = bt.split(":").map(Number);
  await par.locator('input[name="bedtime"]').fill(`${String((h + 23) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  await par.locator("button", { hasText: "Save screen time" }).click(); await par.waitForURL(/saved=time/);
  await go(tv, "/watch", 600);
  check("after the recurring bedtime moves earlier, Maya still watches until the cutoff the parent authorized", new RegExp(`Staying up until ${clock(e.cutoffAt)}`).test(await tv.innerText(".kid-bf")) && live().cutoffAt === e.cutoffAt);

  // Cancel mid-video: the player stops at its next server check (here, the screen waking).
  await tv.context().addInitScript(FAKE_YT);
  await tv.context().route("**/iframe_api", (r) => r.fulfill({ body: "" }));
  await go(tv, "/watch/fxSSS000001", 1500);
  check("(playing)", (await tv.locator("[data-player]").count()) === 1);
  await go(par, `/parent?kid=${MAYA}`, 400);
  await par.locator("button", { hasText: "Cancel tonight's extension" }).click();
  await until(() => !live());
  await tv.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  await tv.waitForTimeout(800);
  const after = await tv.innerText("body");
  check("cancelled: the player stops on its next server check and Time to rest returns", /Time to rest/.test(after), after.slice(0, 160));
  check("…without a second ask (one per night, already fulfilled)", (await tv.locator("button", { hasText: /stay up/ }).count()) === 0);
  await tv.screenshot({ path: `${OUT}/bedtime-tv-after-cancel.png` });
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
