/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Time up (fixture "timeup": Maya is past her done-for-the-day time). Every kid page shows the calm
// time-up screen; the player won't start; "Ask a grown-up for more time" sends once and then says so.
const { OUT, check, launch, parent, kid, go, active, press, done } = require("./kid-common.cjs");
(async () => {
  const b = await launch();
  await parent(b);
  const tv = await kid(b, "tv");
  await go(tv, "/watch", 800);
  const txt = await tv.innerText(".kid-bf");
  check("TV: the time-up screen, in plain words", /Time to rest, Maya/.test(txt) && /back tomorrow/.test(txt));
  let a = await active(tv);
  check("focus starts on Ask a grown-up for more time", /Ask a grown-up for more time/.test(a.text), JSON.stringify(a));
  check("no videos, Search or switching on the time-up screen", (await tv.locator('.kid-bf a[href^="/watch"]').count()) === 0);
  await tv.screenshot({ path: `${OUT}/timeup-tv.png` });
  await press(tv, "Enter"); await tv.waitForTimeout(900);
  a = await active(tv);
  check("OK sends it: \"Sent! A grown-up will decide.\" (focus stays)", /Sent! A grown-up will decide/.test(a.text), JSON.stringify(a));
  await tv.screenshot({ path: `${OUT}/timeup-tv-sent.png` });
  await go(tv, "/watch", 800); await press(tv, "Enter"); await tv.waitForTimeout(900);
  check("asking again the same day doesn't send again: \"Already asked\"", /Already asked/.test((await active(tv)).text));
  for (const path of ["/watch/search", "/watch/fxSSS000001"]) {
    await go(tv, path, 600);
    check(`${path} shows time-up too (no search, no player)`, /Time to rest/.test(await tv.innerText("body")) && (await tv.locator("[data-player]").count()) === 0, tv.url());
  }
  for (const kind of ["tablet", "phone"]) {
    const t = await kid(b, kind);
    await go(t, "/watch", 600);
    const btn = t.locator("button", { hasText: "Ask a grown-up for more time" });
    check(`${kind}: time-up with a large Ask button`, (await btn.count()) === 1 && (await btn.boundingBox()).height >= 56);
    await t.screenshot({ path: `${OUT}/timeup-${kind}.png` });
  }
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
