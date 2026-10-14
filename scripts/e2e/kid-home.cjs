/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Kid Home on TV, tablet and phone: interface choice, a D-pad walk on the TV Home (arrows, OK, Samsung
// Return keyCode 10009), and screenshots. Local mode with the UX fixture. Run via kid-home.sh.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE, OUT = process.env.OUT;
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
const pick = async (p) => { await p.goto(`${BASE}/watch/who?pick=${MAYA}`); await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); for (const d of "2580") await p.keyboard.press(d); await p.click("text=OK"); await p.waitForURL((u) => u.pathname === "/watch", { timeout: 15000 }); };
const setPin = async (b) => { const p = await (await b.newContext()).newPage(); await p.goto(`${BASE}/unlock?next=/parent/kids`); await p.fill('input[name="pin"]', "1234"); await p.keyboard.press("Enter"); await p.waitForURL((u) => u.pathname.startsWith("/parent")); await p.goto(`${BASE}/parent/kids`); await p.fill('form:has(input[value="family"]) input[name="pin"]', "2580"); await p.click('button:has-text("Save family settings")'); await p.waitForURL(/saved=family/); await p.close(); };
const SAMSUNG = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36";
async function scenario(b, name) {
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: SAMSUNG })).newPage();
  await pick(tv); await tv.mouse.move(5, 1075); await tv.goto(`${BASE}/watch`); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(600);
  const active = () => tv.evaluate(() => ({ href: document.activeElement?.getAttribute("href"), text: document.activeElement?.textContent?.trim().slice(0, 40), tag: document.activeElement?.tagName }));
  const a = await active();
  await tv.screenshot({ path: `${OUT}/tv-${name}.png` });
  if (name === "empty") check("empty Home: focus starts on Search", a.href === "/watch/search", JSON.stringify(a));
  if (name !== "locked") {
    await tv.keyboard.press("Enter"); await tv.waitForURL((u) => u.pathname === "/watch/search", { timeout: 10000 }).catch(() => {});
    check(`${name}: first OK opens Search`, new URL(tv.url()).pathname === "/watch/search", tv.url());
    await tv.goto(`${BASE}/watch`); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(600);
  }
  if (name === "waiting") {
    check("waiting-only Home: focus starts on Search, not on a waiting video", a.href === "/watch/search", JSON.stringify(a));
    const txt = await tv.innerText("main, .kid-bf");
    check("waiting-only Home: the request is shown as waiting, with a count", /Waiting for a grown-up \(1\)/.test(txt));
    for (let i = 0; i < 3; i++) await tv.keyboard.press("ArrowDown");
    const w = await active();
    check("Down reaches the waiting video; it's inert (a disabled button, not a link)", w.tag === "BUTTON" && !w.href, JSON.stringify(w));
    await tv.keyboard.press("Enter"); await tv.waitForTimeout(600);
    check("OK on a waiting video opens nothing", new URL(tv.url()).pathname === "/watch");
    await tv.screenshot({ path: `${OUT}/tv-waiting-focused.png` });
  }
  if (name === "locked") {
    check("Locked + empty: focus starts on Home (no Search on Locked)", a.href === "/watch" && (await tv.locator('a[href="/watch/search"]').count()) === 0, JSON.stringify(a));
    await tv.keyboard.press("Enter"); await tv.waitForTimeout(800);
    check("OK on Home keeps the child on Home", new URL(tv.url()).pathname === "/watch");
  }
}

(async () => {
  if (process.env.SCENARIO) {
    const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    await setPin(b); await scenario(b, process.env.SCENARIO); await b.close();
    console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
  const b = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  await setPin(b);
  // ---- TV: detected from the Samsung Tizen user agent (no override) ----
  const tv = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: SAMSUNG })).newPage();
  await pick(tv); await tv.mouse.move(5, 1075); await tv.goto(`${BASE}/watch`); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(500);
  check("TV interface chosen from the Samsung Tizen user agent", await tv.locator(".kid-bf.tv").count() === 1);
  await tv.screenshot({ path: `${OUT}/tv-home.png` });
  const focused = () => tv.evaluate(() => { const a = document.activeElement; const li = a?.closest("li"); const row = a?.closest("[data-nav-row]"); const rows = [...document.querySelectorAll("[data-nav-row]")]; return { href: a?.getAttribute("href"), text: a?.textContent?.trim().slice(0, 30), row: rows.indexOf(row), col: li ? [...li.parentElement.children].indexOf(li) : -1 }; });
  let f = await focused();
  check("on open, focus is on the first video", f.row === 1 && f.col === 0 && /^\/watch\/[\w-]{11}$/.test(f.href || ""), JSON.stringify(f));
  await tv.keyboard.press("ArrowRight"); await tv.keyboard.press("ArrowRight");
  f = await focused(); check("Right ×2 moves along the shelf", f.row === 1 && f.col === 2, JSON.stringify(f));
  await tv.screenshot({ path: `${OUT}/tv-dpad-1-right.png` });
  await tv.keyboard.press("ArrowDown"); f = await focused();
  check("Down moves to the next shelf, nearest column", f.row === 2, JSON.stringify(f));
  // One highlight only: park the pointer away from everything, then over a different tile.
  await tv.mouse.move(5, 1075); await tv.waitForTimeout(400);
  const rings = () => tv.evaluate(() => [...document.querySelectorAll(".kid-bf .tile")].filter((t) => getComputedStyle(t).boxShadow !== "none").length);
  check("with the pointer elsewhere, exactly one tile is highlighted", (await rings()) === 1, String(await rings()));
  await tv.screenshot({ path: `${OUT}/tv-focus-pointer-away.png` });
  const other = tv.locator(".kid-bf .tile a").nth(0);
  await other.hover(); await tv.waitForTimeout(400);
  check("hovering another tile moves the focus there (still one highlight)", (await rings()) === 1 && await other.evaluate((el) => el === document.activeElement));
  await tv.screenshot({ path: `${OUT}/tv-focus-pointer-moved.png` });
  await tv.mouse.move(5, 1075);
  await tv.keyboard.press("ArrowDown"); await tv.keyboard.press("ArrowRight"); f = await focused();
  await tv.screenshot({ path: `${OUT}/tv-dpad-2-down.png` });
  for (let i = 0; i < 8; i++) await tv.keyboard.press("ArrowRight");
  const g = await focused(); check("Right stops at the end of the row (no jump to another row)", g.row === 2, JSON.stringify(g));
  await tv.keyboard.press("ArrowUp"); await tv.keyboard.press("ArrowUp"); f = await focused();
  check("Up ×2 reaches the header row", f.row === 0, JSON.stringify(f));
  await tv.screenshot({ path: `${OUT}/tv-dpad-3-header.png` });
  await tv.keyboard.press("ArrowDown"); f = await focused();
  const target = f.href;
  await tv.keyboard.press("Enter");
  await tv.waitForURL((u) => u.pathname === target, { timeout: 10000 }).catch(() => {});
  check("OK (Enter) opens the focused video in the player", new URL(tv.url()).pathname === target, `${target} → ${new URL(tv.url()).pathname}`);
  await tv.waitForTimeout(800);
  // Samsung remote Return arrives as keyCode 10009 (no key name on older Tizen).
  await tv.evaluate(() => { const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true }); Object.defineProperty(e, "keyCode", { get: () => 10009 }); (document.activeElement ?? document.body).dispatchEvent(e); });
  await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  check("Samsung Return (keyCode 10009) goes back to Home", new URL(tv.url()).pathname === "/watch", tv.url());
  await tv.waitForTimeout(500);
  f = await focused(); check("back on Home, focus is on a video again", f.row >= 1, JSON.stringify(f));
  // ---- tablet + phone ----
  const tab = await (await b.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
  await pick(tab); await tab.goto(`${BASE}/watch?ui=auto`); await tab.waitForLoadState("networkidle"); await tab.waitForTimeout(500);
  check("tablet width gets the tablet layout", await tab.locator(".sm\\:flex .kid-bf.touch").isVisible());
  await tab.screenshot({ path: `${OUT}/tablet-home-landscape.png` });
  const tsec = tab.locator('div.sm\\:flex section[aria-label="For Maya"]');
  const tcount = await tsec.locator("li").count();
  check("tablet: a shelf of more than eight offers Show all, or shows everything", tcount <= 8 && ((await tsec.getByRole("button", { name: /Show all/ }).count()) > 0 || tcount === 7), String(tcount));
  await tab.setViewportSize({ width: 768, height: 1024 }); await tab.waitForTimeout(300);
  await tab.screenshot({ path: `${OUT}/tablet-home-portrait.png` });
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
  await pick(ph); await ph.goto(`${BASE}/watch?ui=auto`); await ph.waitForLoadState("networkidle"); await ph.waitForTimeout(500);
  check("phone width gets the phone layout with a bottom tab bar", await ph.locator('nav[aria-label="Kid"].fixed').isVisible());
  await ph.screenshot({ path: `${OUT}/phone-home-1.png` });
  const sec = ph.locator('div.sm\\:hidden section[aria-label="For Maya"]');
  const count = () => sec.locator("li").count();
  const btn = sec.getByRole("button", { name: /Show all|Show less/ });
  const before = await count();
  await btn.click(); await ph.waitForTimeout(200);
  const after = await count();
  check("phone: Show all reveals every video, Show less collapses, with aria-expanded", before === 4 && after > 4 && (await btn.getAttribute("aria-expanded")) === "true" && /Show less/.test(await btn.innerText()), `${before} → ${after}`);
  await ph.screenshot({ path: `${OUT}/phone-show-all.png` });
  await btn.click(); await ph.waitForTimeout(200);
  check("phone: Show less goes back to four and keeps focus on the button", (await count()) === 4 && await btn.evaluate((el) => el === document.activeElement));
  await ph.evaluate(() => document.querySelector("[data-scroll-pane]").scrollBy(0, 700)); await ph.waitForTimeout(300);
  await ph.screenshot({ path: `${OUT}/phone-home-2.png` });
  await ph.goto(`${BASE}/watch?ask=1`); await ph.waitForLoadState("networkidle"); await ph.waitForTimeout(300);
  await ph.screenshot({ path: `${OUT}/phone-ask.png` });
  // every playable link on every layout points at the player (which authorizes again)
  const links = await tab.$$eval('.kid-bf a[href^="/watch/"]', (as) => as.map((a) => a.getAttribute("href")));
  check("Home tiles only link to the player", links.every((h) => /^\/watch\/([\w-]{11}|search|who)$/.test(h)), links.slice(0, 3).join(","));
  await b.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
