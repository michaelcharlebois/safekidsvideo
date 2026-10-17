/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// The kid experience on the Samsung S85D's original web engine (Chromium 108, Tizen 8 user agent), driven with
// puppeteer-core 19 (which speaks Chromium 108's DevTools protocol). Run via tv-engine.sh. Checks for script
// errors, that the app hydrates (remote arrows move focus), the PIN pad, Search, the player (scripted YouTube
// stand-in: real YouTube must be checked on the TV), Time to rest, and that styles resolve (no transparent
// fallbacks where colour-mix() isn't available).
const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core");
const { FAKE_YT, PLAYER_OVERLAP } = require("./kid-common.cjs");
const BASE = process.env.BASE, OUT = process.env.OUT, FIXTURE = process.env.FIXTURE || "main";
const MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
const TIZEN8 = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36";
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME108, headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required", "--window-size=1920,1080"] });
  const version = await b.version();
  check(`engine is Chromium 108 (${version})`, /\/108\./.test(version), version);
  const errors = [];
  const watch = (p, label) => {
    p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  };

  // Parent (desktop) sets the family PIN, as kid-common's parent() does.
  const par = await b.newPage(); watch(par, "parent");
  await par.goto(`${BASE}/unlock?next=/parent/kids`, { waitUntil: "networkidle0" });
  await par.type('input[name="pin"]', "1234"); await Promise.all([par.waitForNavigation({ waitUntil: "networkidle0" }), par.keyboard.press("Enter")]);
  await par.goto(`${BASE}/parent/kids`, { waitUntil: "networkidle0" });
  await par.type('form:has(input[value="family"]) input[name="pin"]', "2580");
  await Promise.all([par.waitForNavigation({ waitUntil: "networkidle0" }), par.evaluate(() => [...document.querySelectorAll("button")].find((x) => /Save family settings/.test(x.textContent)).click())]);
  check("parent pages work on Chromium 108 (sign-in, Kids, save)", /saved=family/.test(par.url()), par.url());

  // The TV.
  const tvCtx = await b.createIncognitoBrowserContext(); // its own cookies: the TV is a different browser from the parent's
  const tv = await tvCtx.newPage(); watch(tv, "tv");
  await tv.setUserAgent(TIZEN8); await tv.setViewport({ width: 1920, height: 1080 });
  await tv.evaluateOnNewDocument(FAKE_YT);
  await tv.setRequestInterception(true);
  tv.on("request", (r) => (/iframe_api|youtube\.com|ytimg\.com/.test(r.url()) ? r.respond({ status: 200, contentType: "text/javascript", body: "" }) : r.continue()));

  if (FIXTURE === "bedtime-final" || FIXTURE === "timeup") {
    await tv.goto(`${BASE}/watch/who?pick=${MAYA}`, { waitUntil: "networkidle0" });
    for (const d of "2580") await tv.keyboard.press(d);
    await Promise.all([tv.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), tv.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "OK").click())]);
    const t = await tv.evaluate(() => document.querySelector(".kid-bf")?.innerText || document.body.innerText);
    check("Time to rest renders on Chromium 108", /Time to rest|done for today/.test(t), t.slice(0, 120));
    await tv.screenshot({ path: `${OUT}/tv108-timeup.png` });
  } else {
    await tv.goto(`${BASE}/watch/who?pick=${MAYA}`, { waitUntil: "networkidle0" });
    await tv.screenshot({ path: `${OUT}/tv108-pin.png` });
    for (const d of "2580") await tv.keyboard.press(d);
    await Promise.all([tv.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), tv.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "OK").click())]);
    check("PIN pad → Maya's Home", new URL(tv.url()).pathname === "/watch", tv.url());
    await wait(600);
    const home = await tv.evaluate(() => ({ tv: !!document.querySelector(".kid-bf.tv"), tiles: document.querySelectorAll("[data-nav-row] a").length, text: document.querySelector(".kid-bf")?.innerText.slice(0, 80) }));
    check("TV interface (not touch) with shelves of tiles", home.tv && home.tiles > 3, JSON.stringify(home));
    const focus = async () => tv.evaluate(() => (document.activeElement?.getAttribute("href") || document.activeElement?.textContent || "").trim().slice(0, 40));
    const f0 = await focus(); await tv.keyboard.press("ArrowRight"); await wait(150); const f1 = await focus(); await tv.keyboard.press("ArrowDown"); await wait(150); const f2 = await focus();
    check("hydrated: remote arrows move focus between tiles", f0 !== f1 && f1 !== f2 && f1 !== "", JSON.stringify([f0, f1, f2]));
    const look = await tv.evaluate(() => {
      // The ring is drawn on the focused tile's wrapper (.tile:focus-within), not the link itself.
      let el = document.activeElement; while (el && getComputedStyle(el).boxShadow === "none") el = el.parentElement;
      const body = getComputedStyle(document.body);
      return { focusShadow: el ? getComputedStyle(el).boxShadow : "none", bodyBg: body.backgroundColor, text: getComputedStyle(document.querySelector(".kid-bf h1, .kid-bf h2") || document.body).color };
    });
    check("styles resolve: focus ring drawn, page background and heading colour set", look.focusShadow !== "none" && !/rgba\(0, 0, 0, 0\)/.test(look.bodyBg) && !/rgba\(0, 0, 0, 0\)/.test(look.text), JSON.stringify(look));
    await tv.screenshot({ path: `${OUT}/tv108-home.png` });

    // Samsung Return (keyCode 10009, no key name) on a sub-page goes back Home.
    await tv.goto(`${BASE}/watch/search`, { waitUntil: "networkidle0" });
    check("Search renders", /Search|Find/.test(await tv.evaluate(() => document.body.innerText)));
    await tv.evaluate(() => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true }); Object.defineProperty(e, "keyCode", { get: () => 10009 }); (document.activeElement || document.body).dispatchEvent(e); });
    await wait(1500);
    check("Samsung Return (10009) leaves Search for Home", new URL(tv.url()).pathname === "/watch", tv.url());

    // Player with the scripted YouTube stand-in.
    await tv.goto(`${BASE}/watch`, { waitUntil: "networkidle0" });
    const vid = await tv.evaluate(() => [...document.querySelectorAll('a[href^="/watch/"]')].map((a) => a.getAttribute("href")).find((h) => /^\/watch\/[\w-]{11}$/.test(h)));
    await tv.evaluate(() => sessionStorage.setItem("fakeDur", "20"));
    await tv.goto(`${BASE}${vid}`, { waitUntil: "networkidle0" }); await wait(1500);
    const st = async () => tv.evaluate(() => ({ player: !!document.querySelector("[data-player]"), state: window.__yt?.player?.state, t: Math.round(window.__yt?.player?.t ?? -1) }));
    const s0 = await st();
    check("player mounts and plays (YouTube API calls work on 108)", s0.player && s0.state === 1, JSON.stringify(s0));
    await tv.keyboard.press("Enter"); await wait(400); const s1 = await st();
    await tv.keyboard.press("Enter"); await wait(400); const s2 = await st();
    check("Enter pauses and resumes", s1.state === 2 && s2.state === 1, JSON.stringify([s1, s2]));
    await tv.screenshot({ path: `${OUT}/tv108-player.png` });
    // YouTube: nothing in front of the player — with the controls up (paused), and while it plays full screen.
    const banded = await tv.evaluate(PLAYER_OVERLAP);
    check("controls up: the video shrinks into the middle band and nothing overlaps it", banded.mode === "banded" && banded.overlaps.length === 0, JSON.stringify(banded));
    await wait(5600); // still playing: the controls hide after 4 s
    const full = await tv.evaluate(PLAYER_OVERLAP);
    check("playing: the video fills the screen and nothing overlaps it", full.mode === "full" && full.overlaps.length === 0 && full.stage[1] - full.stage[0] >= 1070, JSON.stringify(full));
    await tv.screenshot({ path: `${OUT}/tv108-player-playing.png` });
    // The check itself must catch an overlay: plant a label over the video, expect it reported, remove it.
    await tv.evaluate(() => { const d = document.createElement("div"); d.id = "planted"; d.textContent = "Overlay"; d.style.cssText = "position:absolute;left:45%;top:45%;color:white"; document.querySelector("[data-player]").appendChild(d); });
    const planted = await tv.evaluate(PLAYER_OVERLAP);
    await tv.evaluate(() => document.getElementById("planted").remove());
    check("(the overlap check catches a planted overlay)", planted.overlaps.length === 1 && /Overlay/.test(planted.overlaps[0]), JSON.stringify(planted));
  }

  check("no script errors on Chromium 108", errors.length === 0, JSON.stringify(errors.slice(0, 6)));
  await b.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
