/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Time up (fixture "timeup": Maya is past her done-for-the-day time). Every kid page shows the calm
// time-up screen; the player won't start; bedtime doesn't offer extra minutes (kid-moretime.cjs covers the
// daily-limit ask).
const { OUT, check, launch, parent, kid, go, done } = require("./kid-common.cjs");
(async () => {
  const b = await launch();
  await parent(b);
  const tv = await kid(b, "tv");
  await go(tv, "/watch", 800);
  const txt = await tv.innerText(".kid-bf");
  check("TV: the time-up screen, in plain words", /Time to rest, Maya/.test(txt) && /back tomorrow/.test(txt));
  check("bedtime offers no extra minutes (they wouldn't lift it): no Ask button", (await tv.locator("button", { hasText: /more time/i }).count()) === 0);
  check("no videos, Search or switching on the time-up screen", (await tv.locator('.kid-bf a[href^="/watch"]').count()) === 0);
  await tv.screenshot({ path: `${OUT}/timeup-tv.png` });
  for (const path of ["/watch/search", "/watch/fxSSS000001"]) {
    await go(tv, path, 600);
    check(`${path} shows time-up too (no search, no player)`, /Time to rest/.test(await tv.innerText("body")) && (await tv.locator("[data-player]").count()) === 0, tv.url());
  }
  for (const kind of ["tablet", "phone"]) {
    const t = await kid(b, kind);
    await go(t, "/watch", 600);
    check(`${kind}: bedtime screen, calm and clear, no Ask button`, /Time to rest/.test(await t.innerText(".kid-bf")) && (await t.locator("button", { hasText: /more time/i }).count()) === 0);
    await t.screenshot({ path: `${OUT}/timeup-${kind}.png` });
  }
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
