// Browser walkthrough of the gating changes in local mode (headless Chromium via Playwright).
/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE_URL || "http://localhost:3311";
const MAYA = "e6148654-0dd2-4da9-ac82-3bb897a87d83";
const LEO = "11111111-2222-4333-8444-555555555555";
const OUT = process.env.OUT_DIR || require("node:os").tmpdir();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const ids = async (page) => page.$$eval('a[href^="/watch/"]', (as) => [...new Set(as.map((a) => a.getAttribute("href").split("/")[2]).filter((x) => /^[\w-]{11}$/.test(x)))]);

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const tv = await browser.newContext({ viewport: { width: 1280, height: 720 } }); // the shared TV
  const parentCtx = await browser.newContext({ viewport: { width: 420, height: 900 } }); // the parent's phone
  const kid = await tv.newPage();
  const parent = await parentCtx.newPage();

  // 1. Two kids, nobody picked: the TV fails closed to "Who's watching?"
  await kid.goto(`${BASE}/watch`);
  check("no child picked → /watch redirects to Who's watching", kid.url().includes("/watch/who"), kid.url());
  check("Who's watching says a grown-up enters the PIN", (await kid.innerText("body")).includes("A grown-up enters the PIN"));
  await kid.goto(`${BASE}/watch/yCjJyiqpAuU`);
  check("no child picked → a video URL redirects to Who's watching", kid.url().includes("/watch/who"));
  await kid.screenshot({ path: `${OUT}/01-who.png` });

  // 2. No PIN set yet (old default 1234 doesn't count) → shared screen can't pick
  await kid.goto(`${BASE}/watch/who?pick=${MAYA}`); await kid.waitForLoadState("networkidle"); await kid.waitForTimeout(500);
  for (const d of "1234") await kid.keyboard.press(d);
  await kid.click("text=OK");
  await kid.waitForSelector("text=set a PIN first", { timeout: 5000 }).catch(() => {});
  check("old default PIN 1234 is refused on the shared screen (no PIN set)", (await kid.innerText("body")).includes("set a PIN first"));

  // 3. Parent unlocks (local dev unlock), tries 1234 as the new PIN, then sets 2580
  await parent.goto(`${BASE}/unlock?next=/parent/settings`);
  await parent.fill('input[name="pin"]', "1234");
  await parent.keyboard.press("Enter");
  await parent.waitForURL((u) => u.pathname.startsWith("/parent"));
  await parent.goto(`${BASE}/parent/settings?kid=${MAYA}`);
  await parent.fill('input[name="pin"]', "1234");
  await parent.click('button:has-text("Save")');
  await parent.waitForLoadState("networkidle");
  check("parent can't choose 1234 as the new PIN", (await parent.innerText("body")).includes("other than 1234"));
  await parent.screenshot({ path: `${OUT}/02-pin-1234-refused.png`, fullPage: false });
  await parent.goto(`${BASE}/parent/settings?kid=${MAYA}`);
  await parent.fill('input[name="pin"]', "2580");
  await parent.click('button:has-text("Save")');
  await parent.waitForURL(/saved=1/);
  check("parent sets PIN 2580", parent.url().includes("saved=1"));

  // 4. TV: pick Maya with the remote only (arrows + OK, number keys), wrong PIN first
  await kid.goto(`${BASE}/watch/who`); await kid.waitForLoadState("networkidle"); await kid.waitForTimeout(500);
  await kid.keyboard.press("ArrowRight"); // first press focuses the first tile
  const focused1 = await kid.evaluate(() => document.activeElement?.textContent?.trim());
  check("remote: arrow focuses a child tile on Who's watching", /Maya|Leo/.test(focused1 || ""), focused1);
  if (!/Maya/.test(focused1)) await kid.keyboard.press("ArrowLeft");
  await kid.keyboard.press("Enter");
  await kid.waitForURL(/pick=/); await kid.waitForLoadState("networkidle"); await kid.waitForTimeout(500);
  check("OK on Maya opens the PIN pad", kid.url().includes(`pick=${MAYA}`));
  for (const d of "1111") await kid.keyboard.press(d);
  // move to OK with arrows: down ×3 lands on the bottom row; right ×2 → OK
  await kid.keyboard.press("ArrowDown");
  for (let i = 0; i < 3; i++) await kid.keyboard.press("ArrowDown");
  for (let i = 0; i < 2; i++) await kid.keyboard.press("ArrowRight");
  const onOk = await kid.evaluate(() => document.activeElement?.textContent?.trim());
  check("remote: arrows reach the PIN pad's OK", onOk === "OK", onOk);
  await kid.keyboard.press("Enter");
  await kid.waitForSelector("text=isn't right", { timeout: 5000 }).catch(() => {});
  check("wrong PIN refused", (await kid.innerText("body")).includes("isn't right"));
  await kid.screenshot({ path: `${OUT}/03-pinpad-wrong.png` });
  for (const d of "2580") await kid.keyboard.press(d);
  await kid.click("text=OK");
  await kid.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  check("right PIN → Maya's home", new URL(kid.url()).pathname === "/watch", kid.url());
  let home = await ids(kid);
  check("Maya's home: reviewed + passing channel video plays", home.includes("yCjJyiqpAuU"), home.join(","));
  check("Maya's home: filtered video (violence) hidden", !home.includes("e_04ZrNroTo"));
  check("Maya's home: unreviewed (sample) added video hidden", !home.includes("XqZsoesa55w"));
  await kid.screenshot({ path: `${OUT}/04-maya-home.png` });

  // 5. TV navigation on the home screen still works
  await kid.keyboard.press("ArrowDown");
  const f1 = await kid.evaluate(() => document.activeElement?.closest(".tile") ? "tile" : document.activeElement?.tagName);
  await kid.keyboard.press("ArrowUp");
  const f2 = await kid.evaluate(() => document.activeElement?.closest("header") ? "header" : document.activeElement?.tagName);
  check("remote: down reaches a video tile, up returns to the top menu", f1 === "tile" && f2 === "header", `${f1} / ${f2}`);

  // 6. Review queue: "Keep hidden" for Maya is a standing decision
  await parent.goto(`${BASE}/parent/review?kid=${MAYA}`);
  check("review queue shows the filtered video for Maya", (await parent.innerText("body")).includes("Wheels on the Bus"));
  await parent.screenshot({ path: `${OUT}/05-queue.png`, fullPage: true });
  await parent.click('button:has-text("Keep hidden for Maya")');
  await parent.waitForLoadState("networkidle");
  // relax Maya's filters: unblock violence
  await parent.goto(`${BASE}/parent/settings?kid=${MAYA}`);
  const box = parent.locator('input[name="block:violence"]');
  if (await box.isChecked()) await box.uncheck();
  await parent.click('button:has-text("Save")');
  await parent.waitForURL(/saved=1/);
  await kid.goto(`${BASE}/watch`); await kid.waitForLoadState("networkidle");
  home = await ids(kid);
  check("Keep hidden holds after Maya's filters are relaxed", !home.includes("e_04ZrNroTo"), home.join(","));
  await parent.goto(`${BASE}/parent/video/e_04ZrNroTo`);
  const vtext = await parent.innerText("body");
  check("video page explains it's kept hidden for Maya, with a way to undo", vtext.includes("keep it hidden") && vtext.includes("Stop keeping hidden"));
  await parent.screenshot({ path: `${OUT}/06-kept-hidden.png`, fullPage: true });
  await parent.click('button:has-text("Stop keeping hidden")');
  await parent.waitForLoadState("networkidle");
  await kid.goto(`${BASE}/watch`); await kid.waitForLoadState("networkidle");
  home = await ids(kid);
  check("after Stop keeping hidden (filters relaxed) it plays for Maya", home.includes("e_04ZrNroTo"));

  // 7. Allow an unreviewed video for Maya from the video page: disclosure first
  await parent.goto(`${BASE}/parent/video/XqZsoesa55w`);
  await parent.click('form:has(input[name="profileId"][value="' + MAYA + '"]) button:has-text("Allow for Maya")');
  await parent.waitForURL(/confirm=/);
  check("video page: unreviewed allow asks for confirmation", (await parent.innerText("body")).includes("hasn't been reviewed yet"));
  await parent.screenshot({ path: `${OUT}/07-confirm-video-page.png` });
  await kid.goto(`${BASE}/watch`);
  check("…and nothing is granted before confirming", !(await ids(kid)).includes("XqZsoesa55w"));
  await parent.click('button:has-text("Allow anyway for Maya")');
  await parent.waitForURL(/allowed=/);
  await kid.goto(`${BASE}/watch`);
  check("after confirming, it plays for Maya", (await ids(kid)).includes("XqZsoesa55w"));

  // 8. Old open-mode clearance → "Allow for Leo" goes through the same disclosure, then is an explicit approval
  await parent.goto(`${BASE}/parent/review?kid=${LEO}`);
  const rtext = await parent.innerText("body");
  check("review page lists the old record and says it was an automatic clearance", rtext.includes("Old approvals to review") && rtext.includes("automatic Open-mode"));
  await parent.screenshot({ path: `${OUT}/08-legacy.png`, fullPage: true });
  await parent.click('li:has-text("automatic") button:has-text("Allow for Leo")');
  await parent.waitForURL(/confirm=WRVsOCh907o/);
  check("review page: unreviewed legacy allow asks for confirmation", (await parent.innerText("body")).includes("hasn't been reviewed yet"));
  await parent.screenshot({ path: `${OUT}/09-confirm-review-page.png` });
  await parent.click('button:has-text("Allow anyway for Leo")');
  await parent.waitForURL((u) => !u.searchParams.has("confirm"));
  await parent.waitForLoadState("networkidle");
  await parent.screenshot({ path: `${OUT}/09b-after-legacy.png`, fullPage: true });
  const after = await parent.innerText("body");
  check("legacy record resolved", !after.includes("Old approvals to review"), parent.url() + " :: " + after.slice(after.indexOf("Old approvals") - 20, after.indexOf("Old approvals") + 200));

  // 9. Switch the TV to Leo (needs the PIN again); Leo is Locked
  await kid.goto(`${BASE}/watch/who?pick=${LEO}`); await kid.waitForLoadState("networkidle"); await kid.waitForTimeout(500);
  for (const d of "2580") await kid.keyboard.press(d);
  await kid.click("text=OK");
  await kid.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  home = await ids(kid);
  check("Leo (Locked): the re-assigned old clearance plays (explicit approval)", home.includes("WRVsOCh907o"), home.join(","));
  check("Leo: Maya's approval of the unreviewed video does NOT carry over", !home.includes("XqZsoesa55w"));
  check("Leo: still filtered (violence still blocked for Leo)", !home.includes("e_04ZrNroTo"));
  await kid.goto(`${BASE}/watch/XqZsoesa55w`);
  check("Leo: opening Maya's approved video by URL → not found", (await kid.innerText("body")).match(/404|not found|could not be found/i) != null);
  await kid.screenshot({ path: `${OUT}/10-leo-home.png` });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
