/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Kid Search in Ask first (Maya in open_ask): nothing new plays without a grown-up. Ready results are only
// what already plays for her on Home; everything else is "Ask a grown-up", and asking makes one request
// right away (no automatic check can make it play).
const { OUT, MAYA, check, launch, parent, kid, go, active, press, db, done } = require("./kid-common.cjs");
(async () => {
  const b = await launch();
  await parent(b);
  const tv = await kid(b, "tv");
  await go(tv, "/watch", 800);
  const homeIds = new Set(await tv.evaluate(() => [...document.querySelectorAll('.kid-bf a[href^="/watch/"]')].map((a) => a.getAttribute("href").slice(7, 18))));
  await go(tv, "/watch/search?q=song", 900);
  const r = await tv.evaluate(() => [...document.querySelectorAll("[data-result]")].map((li) => ({ id: li.getAttribute("data-result"), link: !!li.querySelector("a"), text: li.textContent })));
  check("Ask first: the mode line says new videos need a grown-up", /after a grown-up says yes/.test(await tv.innerText(".kid-bf")));
  check("Ask first: every Ready result is something that already plays on Home", r.filter((x) => x.link).every((x) => homeIds.has(x.id)), JSON.stringify(r.filter((x) => x.link).map((x) => x.id)));
  const ask = r.filter((x) => !x.link && /Ask a grown-up/.test(x.text));
  check("Ask first: the others say Ask a grown-up (none say Check it)", ask.length > 0 && !r.some((x) => /Check it/.test(x.text)), JSON.stringify(r.map((x) => x.text.slice(0, 50))));
  await tv.screenshot({ path: `${OUT}/search-tv-askfirst.png` });
  // Ask for the first one with the remote.
  const target = ask[0].id;
  for (let i = 0; i < 12 && (await active(tv)).result !== target; i++) await press(tv, "ArrowRight");
  await press(tv, "Enter"); await tv.waitForTimeout(900);
  const a = await active(tv);
  check("Ask first: OK on Ask confirms right away", a.result === target && /Sent to a grown-up/.test(a.text), JSON.stringify(a));
  const reqs = (db().requests ?? []).filter((x) => x.videoId === target);
  check("Ask first: exactly one pending request, for Maya", reqs.length === 1 && reqs[0].profileId === MAYA && reqs[0].status === "pending", JSON.stringify(reqs));
  await go(tv, `/watch/${target}`, 900);
  check("Ask first: the asked-for video still doesn't play (the player refuses it)", (await tv.locator("main.fixed button[aria-label='Pause'], main.fixed button[aria-label='Play']").count()) === 0, tv.url());
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
