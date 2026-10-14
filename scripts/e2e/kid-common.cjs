/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Shared helpers for the kid-screen e2e scripts (run via kid-screens.sh).
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE, OUT = process.env.OUT, DB = process.env.DB;
const MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
const SAMSUNG = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36";
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };
const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
/** Parent sign-in (local PIN 1234) and a family PIN of 2580 for the kid screens. Returns the parent page. */
async function parent(b) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
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
  const ctx = await b.newContext(DEVICES[kind]);
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
const db = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const done = () => { console.log(`${results.filter(Boolean).length}/${results.length} checks passed`); process.exit(results.every(Boolean) ? 0 : 1); };
module.exports = { BASE, OUT, MAYA, SAMSUNG, check, launch, parent, kid, go, active, press, samsungReturn, db, done };
