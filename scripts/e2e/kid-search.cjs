/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Kid Search + requests (Maya in Open, local practice search over the catalogue). TV: the remote keyboard,
// focus on results, asking with the remote, focus kept through the state change, Return. Touch: the
// search field, asking, no duplicates. Parent: approve one request and decline another; the child sees both.
const { OUT, MAYA, check, launch, parent, kid, go, active, press, samsungReturn, db, done } = require("./kid-common.cjs");
const WHEELS = "fxSSS000002", CLEANUP = "fxSSS000004", TWINKLE = "fxSSS000001", POLICE = "fxPNK000002";
const reqs = (videoId) => (db().requests ?? []).filter((r) => r.videoId === videoId);
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

(async () => {
  const b = await launch();
  const par = await parent(b);
  const tv = await kid(b, "tv");

  // ---- TV: open Search with the remote ----
  await go(tv, "/watch");
  await press(tv, "ArrowUp", 3); // header
  let a = await active(tv);
  // Header: Home, Search, …; move to Search and OK.
  while ((await active(tv)).href !== "/watch/search") { await press(tv, "ArrowRight"); if ((await active(tv)).row !== 0) break; }
  await press(tv, "Enter"); await tv.waitForURL((u) => u.pathname === "/watch/search"); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(600);
  a = await active(tv);
  check("TV Search opens with focus on the keyboard's first key", a.tag === "BUTTON" && a.text === "a", JSON.stringify(a));
  check("TV Search has no text field (so the TV's own pop-up keyboard never appears)", (await tv.locator(".kid-bf.tv input").count()) === 0);
  await tv.screenshot({ path: `${OUT}/search-tv-keyboard.png` });

  // Type "duck" with the remote: d (row 1, col 4), u (row 3, col 3), c (row 1, col 3), k (row 2, col 2).
  await press(tv, "ArrowRight", 3); await press(tv, "Enter");                          // d
  await press(tv, "ArrowDown", 2); await press(tv, "ArrowLeft", 1); await press(tv, "Enter"); // u
  await press(tv, "ArrowUp", 2); await press(tv, "Enter");                             // c
  await press(tv, "ArrowDown", 1); await press(tv, "ArrowLeft", 1); await press(tv, "Enter"); // k
  const typed = await tv.locator('[aria-label="What you typed"]').innerText();
  check("arrows + OK type on the remote keyboard", typed.trim() === "duck", JSON.stringify(typed));
  await tv.screenshot({ path: `${OUT}/search-tv-typing.png` });
  // Down to the action row, then right to Search.
  await press(tv, "ArrowDown", 3); for (let i = 0; i < 4 && (await active(tv)).text !== "Search"; i++) await press(tv, "ArrowRight");
  check("Down reaches the Search key", (await active(tv)).text === "Search", JSON.stringify(await active(tv)));
  await press(tv, "Enter"); await tv.waitForURL(/q=duck/); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(800);
  a = await active(tv);
  check("after searching, focus moves to the first result", !!a.result, JSON.stringify(a));
  check("a Ready result is a link to the player", /^\/watch\/[\w-]{11}\?from=search$/.test(a.href || ""), JSON.stringify(a));

  // Physical keyboard letters also type (a connected keyboard, or a remote with letter keys).
  await go(tv, "/watch/search");
  await tv.keyboard.type("song"); await tv.waitForTimeout(200);
  check("a real keyboard types into the TV search too", (await tv.locator('[aria-label="What you typed"]').innerText()).trim() === "song");
  await tv.keyboard.press("Backspace"); await tv.waitForTimeout(200);
  check("a real keyboard's Backspace deletes a letter (it doesn't leave Search)", (await tv.locator('[aria-label="What you typed"]').innerText()).trim() === "son" && new URL(tv.url()).pathname === "/watch/search");

  // ---- TV: results for "song" ----
  await go(tv, "/watch/search?q=song", 900);
  await tv.screenshot({ path: `${OUT}/search-tv-results.png` });
  const states = await tv.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-result]")].map((li) => [li.getAttribute("data-result"), { link: !!li.querySelector("a"), button: li.querySelector("button")?.textContent?.trim() ?? null, text: li.textContent }])));
  check("Ready results link to the player", states[TWINKLE]?.link === true);
  check("a result that doesn't fit the settings offers Ask a grown-up, not Play", states[WHEELS] && !states[WHEELS].link && /Ask a grown-up/.test(states[WHEELS].button || "") && /doesn't fit your settings/.test(states[WHEELS].text), JSON.stringify(states[WHEELS]));
  check("a result the review isn't sure about needs a grown-up", states[CLEANUP] && !states[CLEANUP].link && /isn't sure/.test(states[CLEANUP].text), JSON.stringify(states[CLEANUP]));
  check("a video a grown-up blocked: no link and no ask", states[POLICE] && !states[POLICE].link && /Not this one/.test(states[POLICE].text) && !/Ask/.test(states[POLICE].button || ""), JSON.stringify(states[POLICE]));
  const before = await active(tv);
  check("focus starts on the first result", before.result === TWINKLE, JSON.stringify(before));
  await press(tv, "ArrowRight"); a = await active(tv);
  check("Right moves to the next result (its Ask button)", a.result === WHEELS && /Ask a grown-up/.test(a.text), JSON.stringify(a));
  await tv.screenshot({ path: `${OUT}/search-tv-ask-focused.png` });
  await press(tv, "Enter"); await tv.waitForTimeout(700);
  a = await active(tv);
  check("OK on Ask: the child sees \"Sent to a grown-up!\" and focus stays on that result", a.result === WHEELS && /Sent to a grown-up/.test(a.text), JSON.stringify(a));
  await tv.screenshot({ path: `${OUT}/search-tv-sent.png` });
  check("one request, for Maya only", reqs(WHEELS).length === 1 && reqs(WHEELS)[0].profileId === MAYA && reqs(WHEELS)[0].status === "pending", JSON.stringify(reqs(WHEELS)));
  await tv.waitForTimeout(5800); // the confirmation stays up a few seconds, then settles
  a = await active(tv);
  const wheelsNow = await tv.locator(`[data-result="${WHEELS}"]`).innerText();
  check("after the refresh the card says Waiting for a grown-up, focus is still on it", a.result === WHEELS && /Waiting for a grown-up/.test(wheelsNow), JSON.stringify(a) + wheelsNow);
  check("a waiting result has no link and nothing to press (it can't be mistaken for playable or asked twice)", (await tv.locator(`[data-result="${WHEELS}"] a`).count()) === 0 && (await tv.locator(`[data-result="${WHEELS}"] button[type="submit"]`).count()) === 0 && !/Ask|Ready/.test(await tv.locator(`[data-result="${WHEELS}"]`).innerText()));
  await press(tv, "Enter"); await tv.waitForTimeout(500);
  check("OK on a waiting result does nothing", new URL(tv.url()).pathname === "/watch/search" && reqs(WHEELS).length === 1);
  await tv.screenshot({ path: `${OUT}/search-tv-waiting.png` });
  await press(tv, "ArrowUp"); a = await active(tv);
  check("Up from the results reaches the header", a.row === 0, JSON.stringify(a));
  await press(tv, "ArrowDown", 2); a = await active(tv);
  check("Down from the results reaches the keyboard", a.tag === "BUTTON" && a.text.length === 1, JSON.stringify(a));

  // OK on a Ready result opens the player; coming back puts focus where it was.
  await go(tv, "/watch/search?q=song", 900);
  await press(tv, "ArrowRight", 2); a = await active(tv);
  const chosen = a.result;
  await press(tv, "Enter"); await tv.waitForURL((u) => /^\/watch\/[\w-]{11}$/.test(u.pathname), { timeout: 10000 }).catch(() => {});
  check("OK on a Ready result opens the player", /^\/watch\/[\w-]{11}$/.test(new URL(tv.url()).pathname), tv.url());
  await tv.goBack(); await tv.waitForLoadState("networkidle"); await tv.waitForTimeout(900);
  a = await active(tv);
  check("back on Search, focus returns to the video you picked", a.result === chosen, JSON.stringify(a) + " wanted " + chosen);
  await samsungReturn(tv); await tv.waitForURL((u) => u.pathname === "/watch", { timeout: 10000 }).catch(() => {});
  check("Samsung Return on Search goes Home", new URL(tv.url()).pathname === "/watch", tv.url());
  await tv.waitForTimeout(600);
  check("Home shows the request as waiting, with a count", /Waiting for a grown-up \(1\)/.test(await tv.innerText(".kid-bf")));

  // ---- Tablet + phone: the touch search field ----
  const tab = await kid(b, "tablet");
  await go(tab, "/watch/search");
  const input = tab.locator('.kid-bf input[type="search"]');
  check("tablet Search uses a normal search field (the device keyboard), with the Search key", (await input.count()) === 1 && (await input.getAttribute("enterkeyhint")) === "search");
  await tab.screenshot({ path: `${OUT}/search-tablet-empty.png` });
  await input.fill("song"); await input.press("Enter"); await tab.waitForURL(/q=song/); await tab.waitForLoadState("networkidle"); await tab.waitForTimeout(600);
  check("tablet: the same request shows as waiting on another screen (no second ask)", /Waiting for a grown-up/.test(await tab.locator(`[data-result="${WHEELS}"]`).innerText()) && (await tab.locator(`[data-result="${WHEELS}"] button[type="submit"]`).count()) === 0);
  await tab.locator(`[data-result="${CLEANUP}"] button[type="submit"]`).click(); await tab.waitForTimeout(700);
  check("tablet: Ask confirms on the card", /Sent to a grown-up/.test(await tab.locator(`[data-result="${CLEANUP}"]`).innerText()));
  await tab.screenshot({ path: `${OUT}/search-tablet-results.png` });

  const ph = await kid(b, "phone");
  await go(ph, "/watch/search?q=song", 900);
  await ph.screenshot({ path: `${OUT}/search-phone-results.png` });
  const shown = await ph.locator("[data-result]").count();
  check("phone: results show a count and Show all (nothing silently dropped)", /\(7\)/.test(await ph.innerText("h2")) && shown === 6 && (await ph.locator('button:has-text("Show all 7")').count()) === 1, String(shown));
  await ph.locator('button:has-text("Show all 7")').click(); await ph.waitForTimeout(300);
  check("phone: Show all reveals every result", (await ph.locator("[data-result]").count()) === 7);
  await ph.screenshot({ path: `${OUT}/search-phone-all.png`, fullPage: true });
  await go(ph, "/watch/search");
  await ph.screenshot({ path: `${OUT}/search-phone-empty.png` });

  // ---- Parent answers: approve Wheels, decline Clean Up ----
  await go(par, "/parent/review");
  await par.locator(`form:has(input[value="${reqs(WHEELS)[0].id}"]) button:has-text("Allow")`).first().click(); await until(() => reqs(WHEELS)[0].status !== "pending");
  const ck = reqs(CLEANUP)[0];
  await go(par, "/parent/review");
  await par.locator(`form:has(input[value="${ck.id}"]) button[value="deny"]`).first().click(); await until(() => reqs(CLEANUP)[0].status !== "pending");
  check("parent's answers are recorded", reqs(WHEELS)[0].status === "approved" && reqs(CLEANUP)[0].status === "denied", JSON.stringify([reqs(WHEELS), reqs(CLEANUP)]));

  await go(tv, "/watch", 900);
  const home = await tv.innerText(".kid-bf");
  check("approved: Home shows it under \"A grown-up said yes!\"", /A grown-up said yes!/.test(home) && (await tv.locator(`section[aria-label="A grown-up said yes!"] a[href="/watch/${WHEELS}"]`).count()) === 1);
  check("Home no longer lists anything as waiting", !/Waiting for a grown-up/.test(home));
  await tv.screenshot({ path: `${OUT}/home-tv-approved.png` });
  await go(tv, "/watch/search?q=song", 900);
  const w2 = await tv.locator(`[data-result="${WHEELS}"]`), c2 = await tv.locator(`[data-result="${CLEANUP}"]`);
  check("approved: the search result is now Ready and links to the player", (await w2.locator("a").count()) === 1 && /Ready/.test(await w2.innerText()));
  check("declined: the result says Not this time, with no link and no Ask", /Not this time/.test(await c2.innerText()) && (await c2.locator("a").count()) === 0 && !/Ask/.test(await c2.innerText()));
  await tv.screenshot({ path: `${OUT}/search-tv-answered.png` });

  // ---- Locked: no search for Leo ----
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
