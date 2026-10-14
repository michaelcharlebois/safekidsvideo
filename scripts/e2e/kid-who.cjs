/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Who's watching and the PIN pad (a shared screen in local mode). TV: tiles with the remote, the PIN by
// arrows + OK and by number keys, a wrong PIN, Back. A child can't switch into another profile without the
// PIN (the server decides). Touch layouts. (The 0019 attempt lockout needs a real device row: Supabase.)
const { OUT, check, launch, parent, kid, go, active, press, done, focusedContrast } = require("./kid-common.cjs");
const LEO_NAME = "Leo";
(async () => {
  const b = await launch();
  await parent(b);
  const tv = await kid(b, "tv"); // Maya (Open)
  await go(tv, "/watch/who", 800);
  let a = await active(tv);
  check("TV Who's watching: focus starts on the first child", /Maya/.test(a.text), JSON.stringify(a));
  await tv.screenshot({ path: `${OUT}/who-tv.png` });
  await press(tv, "ArrowRight"); a = await active(tv);
  check("Right moves to the next child", new RegExp(LEO_NAME).test(a.text), JSON.stringify(a));
  await press(tv, "Enter"); await tv.waitForURL(/pick=/); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(600);
  a = await active(tv);
  check("OK opens the PIN pad with focus on 1", a.text === "1", JSON.stringify(a));
  // Wrong PIN with the remote: 1 1 1 1, then down to OK.
  for (let i = 0; i < 4; i++) await press(tv, "Enter");
  await press(tv, "ArrowDown", 3); await press(tv, "ArrowRight", 2);
  a = await active(tv);
  check("arrows reach OK once four digits are in", a.text === "OK", JSON.stringify(a));
  await press(tv, "Enter"); await tv.waitForTimeout(900);
  check("a wrong PIN is refused, says so, and clears", /isn't right/.test(await tv.innerText("main")) && /0 of 4/.test(await tv.locator('[aria-label$="digits entered"]').getAttribute("aria-label")));
  await tv.screenshot({ path: `${OUT}/who-tv-pin-wrong.png` });
  // Bypass the pad: submit the form straight away with a made-up PIN. The server still says no.
  await tv.evaluate(() => { const f = document.querySelector("form:has(input[name=pin])"); f.querySelector("input[name=pin]").value = "0000"; f.requestSubmit(); });
  await tv.waitForTimeout(900);
  check("submitting around the pad doesn't switch either (the server checks the PIN)", new URL(tv.url()).pathname === "/watch/who" && /isn't right/.test(await tv.innerText("main")));
  await go(tv, "/watch", 600);
  check("…and the screen is still Maya's", /Maya/.test(await tv.innerText("header")));
  // Right PIN with the number keys.
  await go(tv, "/watch/who", 600); await press(tv, "ArrowRight"); await press(tv, "Enter"); await tv.waitForURL(/pick=/); await tv.waitForTimeout(500);
  for (const d of "25809") await tv.keyboard.press(d); // a fifth digit is ignored
  await tv.keyboard.press("Backspace"); await tv.waitForTimeout(150);
  check("a real keyboard's Backspace deletes a PIN digit and stays on the pad", /3 of 4/.test(await tv.locator('[aria-label$="digits entered"]').getAttribute("aria-label")) && /pick=/.test(tv.url()));
  await tv.keyboard.press("0");
  await tv.screenshot({ path: `${OUT}/who-tv-pin.png` });
  await press(tv, "ArrowDown", 3); await press(tv, "ArrowRight", 2);
  const ok = await focusedContrast(tv);
  check("focused OK keeps its apricot fill and dark text", ok && ok.text === "OK" && ok.background === "rgb(255, 159, 110)" && ok.ratio >= 4.5, JSON.stringify(ok));
  await tv.screenshot({ path: `${OUT}/who-tv-pin-ok-focused.png` });
  await press(tv, "Enter");
  await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  await tv.waitForTimeout(600);
  const hdr = await tv.innerText("header");
  check("the right PIN switches to Leo (Locked: no Search)", /Leo/.test(hdr) && (await tv.locator('a[href="/watch/search"]').count()) === 0, hdr);
  await go(tv, "/watch/search", 600);
  check("Leo (Locked) can't open Search by its address either", new URL(tv.url()).pathname === "/watch");
  // Back from the PIN pad.
  await go(tv, "/watch/who?pick=e6148654-0dd2-4da9-ac82-3bb897a87d83", 600);
  await press(tv, "ArrowUp", 5); a = await active(tv);
  check("Up from the PIN pad reaches Back", a.text === "Back", JSON.stringify(a));
  await press(tv, "Enter"); await tv.waitForURL((u) => u.pathname === "/watch/who" && !u.search.includes("pick")).catch(() => {});
  check("Back returns to the list of children", !new URL(tv.url()).search.includes("pick"), tv.url());

  for (const kind of ["tablet", "phone"]) {
    const t = await kid(b, kind);
    await go(t, "/watch/who", 600);
    const tiles = await t.evaluate(() => [...document.querySelectorAll(".kid-bf li.tile")].map((li) => { const r = li.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check(`${kind}: big child tiles`, tiles.length === 2 && tiles.every(([w, h]) => w >= 140 && h >= 140), JSON.stringify(tiles));
    await t.screenshot({ path: `${OUT}/who-${kind}.png` });
    await t.locator("li.tile a").first().tap(); await t.waitForURL(/pick=/); await t.waitForTimeout(500);
    const keys = await t.evaluate(() => [...document.querySelectorAll("form:has(input[name=pin]) button")].map((x) => Math.round(x.getBoundingClientRect().height)));
    check(`${kind}: PIN keys are at least 56 px`, keys.length === 12 && keys.every((h) => h >= 56), JSON.stringify(keys));
    await t.screenshot({ path: `${OUT}/who-${kind}-pin.png` });
  }
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
