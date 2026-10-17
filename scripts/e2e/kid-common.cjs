/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Shared helpers for the kid-screen e2e scripts (run via kid-screens.sh).
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE, OUT = process.env.OUT, DB = process.env.DB;
const MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
const SAMSUNG = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36";
const results = [];
// The test clock. kid-screens.sh starts the server with BF_FAKE_NOW (local mode only), so the server's "now"
// is that instant plus the time since it booted (BF_FAKE_BOOT, ms). Browsers get the same clock, and the
// fixtures and assertions use it too — results don't depend on the time of day the suite runs.
const FAKE = Date.parse(process.env.BF_FAKE_NOW || ""), BOOT = Number(process.env.BF_FAKE_BOOT || 0);
const testNow = () => (Number.isFinite(FAKE) ? FAKE + (Date.now() - BOOT) : Date.now());
// Pages get the clock only in the time-dependent scenarios (bedtime, time up, daily limit), where the page's
// countdowns must agree with the server; elsewhere Playwright's fake timers would only perturb the scripted
// player's timing.
const TIMED = /^(bedtime|timeup|limit)/.test(process.env.FIXTURE || "");
const withClock = async (ctx) => { if (Number.isFinite(FAKE) && TIMED) await ctx.clock.install({ time: testNow() }); return ctx; };
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };
const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
/** Parent sign-in (local PIN 1234) and a family PIN of 2580 for the kid screens. Returns the parent page. */
async function parent(b) {
  const p = await (await withClock(await b.newContext({ viewport: { width: 1280, height: 900 } }))).newPage();
  await p.goto(`${BASE}/unlock?next=/parent/kids`); await p.fill('input[name="pin"]', "1234"); await p.keyboard.press("Enter");
  await p.waitForURL((u) => u.pathname.startsWith("/parent"));
  await p.goto(`${BASE}/parent/kids`); await p.fill('form:has(input[value="family"]) input[name="pin"]', "2580");
  await p.click('button:has-text("Save family settings")'); await p.waitForURL(/saved=family/);
  return p;
}
const DEVICES = {
  tv: { viewport: { width: 1920, height: 1080 }, userAgent: SAMSUNG },
  tablet: { viewport: { width: 1180, height: 820 }, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
/** A kid screen of the given kind, with Maya picked through the PIN pad. */
async function kid(b, kind, who = MAYA) {
  const ctx = await withClock(await b.newContext(DEVICES[kind]));
  const p = await ctx.newPage();
  await p.goto(`${BASE}/watch/who?pick=${who}${kind === "tv" ? "" : "&ui=" + kind}`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(400);
  for (const d of "2580") await p.keyboard.press(d);
  await p.click("text=OK"); await p.waitForURL((u) => u.pathname === "/watch", { timeout: 15000 });
  await p.mouse.move(5, DEVICES[kind].viewport.height - 5); // pointer parked away from everything
  return p;
}
const go = async (p, path, wait = 600) => { await p.goto(`${BASE}${path}`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(wait); };
const active = (p) => p.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, text: (a?.getAttribute("aria-label") || a?.textContent || "").trim().slice(0, 60), href: a?.getAttribute("href"), result: a?.closest("[data-result]")?.getAttribute("data-result") ?? null, row: [...document.querySelectorAll("[data-nav-row]")].indexOf(a?.closest("[data-nav-row]")) }; });
const press = async (p, key, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(key); await p.waitForTimeout(60); } };
/** The Samsung remote's Return: keyCode 10009 with no key name (older Tizen). */
const samsungReturn = (p) => p.evaluate(() => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true }); Object.defineProperty(e, "keyCode", { get: () => 10009 }); (document.activeElement ?? document.body).dispatchEvent(e); });
/**
 * The fixture database, read straight from disk. The local store saves with fs.writeFile, which empties the
 * file before writing it, so a read that lands mid-save sees "" or half a file. Retry briefly in that case.
 */
const db = () => {
  for (let i = 0; ; i++) {
    const text = fs.readFileSync(DB, "utf8");
    try { return JSON.parse(text); } catch (e) {
      if (i >= 50) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); // 20 ms, synchronously (callers aren't async)
    }
  }
};
/** The focused element's text and background colours and their WCAG contrast ratio. */
const focusedContrast = (p) => p.evaluate(() => {
  const el = document.activeElement; if (!el) return null;
  const cs = getComputedStyle(el);
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
  return { text: (el.textContent || "").trim().slice(0, 40), color: cs.color, background: cs.backgroundColor, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10 };
});
const done = () => { console.log(`${results.filter(Boolean).length}/${results.length} checks passed`); process.exit(results.every(Boolean) ? 0 : 1); };
/** A scripted stand-in for the YouTube IFrame API (same methods and events; video time runs in real time). */
const FAKE_YT = () => {
  // Record each beacon's body synchronously (a page that's going away can't be inspected afterwards).
  const B = window.Blob;
  window.Blob = function (parts, opts) { const b = new B(parts, opts); b.__text = (parts || []).join(""); return b; };
  window.Blob.prototype = B.prototype;
  const send = navigator.sendBeacon?.bind(navigator);
  if (send) navigator.sendBeacon = (url, data) => { try { const l = JSON.parse(localStorage.getItem("beacons") || "[]"); l.push({ url: String(url), body: data?.__text ?? null }); localStorage.setItem("beacons", JSON.stringify(l)); } catch { /* */ } return send(url, data); };
  const dur = () => Number(sessionStorage.getItem("fakeDur") || 60);
  window.__yt = { log: [] };
  window.YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: class {
      constructor(el, opts) {
        this.opts = opts; this.id = opts.videoId; this.t = 0; this.state = -1; this.dur = dur(); this.last = performance.now();
        window.__yt.player = this;
        setTimeout(() => { opts.events.onReady?.({ target: this }); this.playVideo(); }, 80);
        this.timer = setInterval(() => this._tick(), 100);
      }
      _tick() { const n = performance.now(); if (this.state === 1) { this.t += (n - this.last) / 1000; if (this.t >= this.dur) { this.t = this.dur; this._set(0); } } this.last = n; }
      _set(s) { this.state = s; window.__yt.log.push([this.id, s, Math.round(this.t)]); this.opts.events.onStateChange?.({ data: s, target: this }); }
      getVideoData() { return { video_id: this.id }; }
      getPlayerState() { return this.state; }
      getCurrentTime() { this._tick(); return this.t; }
      getDuration() { return this.dur; }
      playVideo() { this._tick(); this._set(1); }
      pauseVideo() { this._tick(); this._set(2); }
      seekTo(s) { this._tick(); const was = this.state; this.t = Math.max(0, Math.min(this.dur, s)); if (was === 1) { this._set(3); setTimeout(() => this._set(1), 150); } }
      loadVideoById(id) { this._tick(); this.id = id; this.t = 0; this.dur = dur(); this._set(-1); setTimeout(() => this._set(1), 120); }
      destroy() { clearInterval(this.timer); }
    },
  };
};

/**
 * YouTube's rule: nothing drawn in front of any part of the embedded player. Lists every element that paints
 * something (background, border, shadow, its own text, an icon or image), is visible, and overlaps the video
 * stage ([data-stage]) while not being part of it. Runs in the page; works with Playwright and Puppeteer.
 */
const PLAYER_OVERLAP = () => {
  const stage = document.querySelector("[data-stage]");
  if (!stage) return { stage: null, overlaps: [] };
  const s = stage.getBoundingClientRect();
  const visible = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return false; } return true; };
  const paints = (el, c) => (c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent") || c.backgroundImage !== "none"
    || c.boxShadow !== "none" || (parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== "none") || ["SVG", "IMG", "svg", "img"].includes(el.tagName)
    || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const overlaps = [];
  for (const el of document.querySelectorAll("[data-player] *")) {
    if (stage.contains(el) || el.contains(stage)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ix <= 0.5 || iy <= 0.5) continue;
    const c = getComputedStyle(el);
    if (!paints(el, c) || !visible(el)) continue;
    overlaps.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-band") ? `[band=${el.getAttribute("data-band")}]` : ""} "${(el.textContent || "").trim().slice(0, 24)}"`);
  }
  return { stage: [Math.round(s.top), Math.round(s.bottom), Math.round(s.left), Math.round(s.right)], mode: stage.getAttribute("data-stage"), overlaps };
};

module.exports = { PLAYER_OVERLAP, testNow, withClock, FAKE_YT, BASE, OUT, MAYA, SAMSUNG, check, launch, parent, kid, go, active, press, samsungReturn, db, done, focusedContrast };
