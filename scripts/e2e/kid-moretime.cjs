/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// "Ask a grown-up for more time", stored (fixture limit / limit-decline: Maya has watched 50 of 45 minutes;
// a pending ask from yesterday has expired). Local mode has no push subscriptions at all, so this also shows
// the request reaching the parent without push. Two screens for one child; the parent answers in Review.
const { OUT, MAYA, check, launch, parent, kid, go, active, press, db, done, focusedContrast } = require("./kid-common.cjs");
const FIXTURE = process.env.FIXTURE;
const today = () => new Date(require("./kid-common.cjs").testNow()).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const asks = () => (db().timeRequests ?? []).filter((r) => r.profileId === MAYA);
const todays = () => asks().filter((r) => r.day === today());
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

(async () => {
  const b = await launch();
  const par = await parent(b);
  const tv = await kid(b, "tv");
  const tab = await kid(b, "tablet");
  await go(tv, "/watch", 800); await go(tab, "/watch", 600);
  check("daily limit reached: the time-up screen says so", /That's all for today, Maya!/.test(await tv.innerText(".kid-bf")) && /about 50 minutes/.test(await tv.innerText(".kid-bf")));
  let a = await active(tv);
  check("TV focus starts on Ask a grown-up for more time", /Ask a grown-up for more time/.test(a.text), JSON.stringify(a));
  const c = await focusedContrast(tv);
  check("the focused primary button stays apricot with dark text (legible)", c && c.background === "rgb(255, 159, 110)" && c.ratio >= 4.5, JSON.stringify(c));
  await tv.screenshot({ path: `${OUT}/timeup-limit-tv-focused.png` });
  await tab.screenshot({ path: `${OUT}/timeup-limit-tablet.png` });
  await go(par, "/parent/review", 400);
  check("yesterday's unanswered ask has expired: not in Review", !/asking for more time/.test(await par.innerText("main")));

  // TV asks.
  await press(tv, "Enter"); await tv.waitForTimeout(900);
  a = await active(tv);
  const sentFocusable = await tv.evaluate(() => [...document.querySelectorAll("a, button, [tabindex]")].some((el) => /Waiting for a grown-up/.test(el.textContent || "")));
  check("asking: \"Sent! Waiting for a grown-up\", shown once the request is stored, as a status (nothing pressable)", /Sent! Waiting for a grown-up/.test(await tv.innerText(".kid-bf")) && !sentFocusable && todays().length === 1 && todays()[0].status === "pending", JSON.stringify(a) + JSON.stringify(todays()));
  await tv.screenshot({ path: `${OUT}/timeup-limit-tv-sent.png` });
  // The tablet still shows the old button; pressing it doesn't make a second request.
  await tab.locator('button[type="submit"]', { hasText: "Ask a grown-up for more time" }).click(); await tab.waitForTimeout(900);
  check("a second screen's ask (same child) is the same request: one pending, and it says Waiting", todays().length === 1 && /Waiting for a grown-up/.test(await tab.innerText(".kid-bf")), JSON.stringify(todays()));
  await go(tab, "/watch", 600);
  check("after a reload, every screen shows the stored state (Waiting), with nothing to press", /Waiting for a grown-up/.test(await tab.innerText(".kid-bf")) && (await tab.locator('button[type="submit"]').count()) === 0);
  await tab.screenshot({ path: `${OUT}/timeup-limit-tablet-waiting.png` });

  // The parent sees it without any push subscription.
  await go(par, "/parent/review", 400);
  const rev = await par.innerText("main");
  check("Review shows the ask (no push subscription needed)", /Maya is asking for more time today/.test(rev) && /1 ask for more time/.test(rev), rev.slice(0, 200));
  check("the Review badge counts it", (await par.locator('[aria-label="1 waiting"]').count()) >= 1);
  await par.screenshot({ path: `${OUT}/parent-review-more-time.png`, fullPage: true });
  const reqId = todays()[0].id;

  if (FIXTURE === "limit-decline") {
    await par.locator(`form:has(input[name="requestId"][value="${reqId}"]):has(input[name="decision"][value="deny"]) button`).click();
    await until(() => todays()[0].status === "denied");
    check("parent declines: stored as denied, no minutes", todays()[0].status === "denied" && !todays()[0].grantedMinutes && !(db().profiles.find((p) => p.id === MAYA).bonusMinutes > 0));
    await go(tv, "/watch", 600);
    check("the child sees \"A grown-up said not today\" and can't ask again today", /A grown-up said not today/.test(await tv.innerText(".kid-bf")) && (await tv.locator('button[type="submit"]').count()) === 0);
    await tv.screenshot({ path: `${OUT}/timeup-limit-tv-declined.png` });
    await go(tab, "/watch", 600);
    check("…on every screen", /A grown-up said not today/.test(await tab.innerText(".kid-bf")));
  } else {
    // A second, stale copy of Review is open (another phone): its +30 will be pressed after the first answer.
    const stale = await par.context().newPage(); await stale.goto(par.url()); await stale.waitForLoadState("networkidle");
    await par.locator(`form:has(input[name="requestId"][value="${reqId}"]):has(input[name="minutes"][value="15"]) button`).click();
    await until(() => todays()[0].status === "approved");
    const r = todays()[0], p = db().profiles.find((x) => x.id === MAYA);
    check("parent approves +15: stored as approved with 15 minutes; 15 bonus minutes for today", r.status === "approved" && r.grantedMinutes === 15 && p.bonusMinutes === 15 && p.bonusDay === today(), JSON.stringify([r, p.bonusMinutes, p.bonusDay]));
    await stale.locator(`form:has(input[name="requestId"][value="${reqId}"]):has(input[name="minutes"][value="30"]) button`).click();
    await stale.waitForURL(/error=/, { timeout: 8000 }).catch(() => {});
    check("answering again (a stale page) adds nothing: still 15 minutes, and it says so", db().profiles.find((x) => x.id === MAYA).bonusMinutes === 15 && /already answered/.test(await stale.innerText("main")), (await stale.innerText("main")).slice(0, 160));
    await tv.waitForTimeout(16000); // the waiting screen refreshes itself
    check("the child's screen comes back on its own with the extra time (10 min left)", /10 min left today/.test(await tv.innerText("body")), (await tv.innerText("body")).slice(0, 120));
    await tv.screenshot({ path: `${OUT}/timeup-limit-tv-approved-home.png` });
  }
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
