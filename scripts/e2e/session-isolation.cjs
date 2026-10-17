/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// Parent / kid-screen session isolation, end to end: the real app in account mode (built against
// fake-supabase.cjs), real browsers, real cookies. Each Playwright context is one browser; pages in a
// context are its tabs and share its cookies. Run via session-isolation.sh.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const BASE = process.env.BASE, FAKE = process.env.FAKE, OUT = process.env.OUT;
const PARENT = "u0000000-0000-4000-8000-000000000001";
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };
const fake = async (path, body) => (await fetch(`${FAKE}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {})).json();
const authCookies = async (ctx) => (await ctx.cookies()).filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name));
const deviceCookie = async (ctx) => (await ctx.cookies()).find((c) => c.name === "skv_device");
const path = (p) => new URL(p.url()).pathname + new URL(p.url()).search;
/** Sign in through the real email-link route (/auth/confirm): the auth server verifies the link. */
async function signIn(page, next = "/parent/devices") {
  const { token_hash } = await fake("/__otp", { user: PARENT });
  await page.goto(`${BASE}/auth/confirm?token_hash=${token_hash}&type=magiclink&next=${encodeURIComponent(next)}`);
  await page.waitForLoadState("networkidle");
}
const sessionsLive = async () => Object.values((await fake("/__state")).sessions).filter((s) => !s.revoked).length;

(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const laptop = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const ph = await phone.newPage();
  const tab1 = await laptop.newPage(), tab2 = await laptop.newPage(); // two tabs in the same browser

  // ---- both browsers signed in as the parent ----
  await signIn(ph);
  await signIn(tab1);
  check("parent signed in on phone and laptop (real session cookies, split into chunks)", (await authCookies(phone)).length >= 2 && (await authCookies(laptop)).length >= 2 && path(tab1).startsWith("/parent/devices"), JSON.stringify((await authCookies(laptop)).map((c) => c.name)));
  check("two live sessions on the auth server", (await sessionsLive()) === 2);
  const oldLaptopSession = await authCookies(laptop);

  // ---- 3. a wrong code: nothing changes ----
  await tab2.goto(`${BASE}/pair`); await tab2.waitForLoadState("networkidle");
  check("/pair explains that connecting signs you out here only", /signs you out\s+here only/i.test(await tab2.innerText("body")) && /phone and other browsers stay signed in/i.test(await tab2.innerText("body")));
  await tab2.fill('input[name="code"]', "99999999"); await tab2.fill('input[name="name"]', "Living room TV");
  await tab2.locator('form button[type="submit"]').click(); await tab2.waitForTimeout(1200);
  check("wrong code: an error, still on /pair", /That code isn't right/.test(await tab2.innerText("body")) && path(tab2).startsWith("/pair"));
  check("…and the parent is still signed in here (session cookies kept, no screen cookie)", (await authCookies(laptop)).length >= 2 && !(await deviceCookie(laptop)));
  await tab1.reload(); await tab1.waitForLoadState("networkidle");
  check("…and parent pages still open in the other tab", path(tab1).startsWith("/parent/devices") && /Connected screens/.test(await tab1.innerText("main")));

  // ---- the phone makes a code; tab 2 of the laptop pairs with it ----
  await ph.goto(`${BASE}/parent/devices`); await ph.locator("button", { hasText: /Make (a|another) code/ }).click(); await ph.waitForTimeout(1200);
  const code = (await ph.locator("li.font-mono").first().innerText()).trim();
  check("phone made a pairing code", /^\d{8}$/.test(code), code);
  await tab2.fill('input[name="code"]', code); await tab2.fill('input[name="name"]', "Living room TV");
  await tab2.locator('form button[type="submit"]').click();
  await tab2.waitForURL((u) => !u.pathname.startsWith("/pair"), { timeout: 15000 }).catch(() => {});
  const st = await fake("/__state");
  check("1. paired: the laptop is now a kid screen (screen cookie set)", !!(await deviceCookie(laptop)) && st.db.devices?.length === 1 && !st.db.devices[0].revoked_at, JSON.stringify(st.db.devices));
  check("…every parent auth cookie is gone from the laptop, chunks included", (await authCookies(laptop)).length === 0, JSON.stringify((await authCookies(laptop)).map((c) => c.name)));
  check("…the auth server was asked for a LOCAL sign-out only", JSON.stringify(st.log.filter((l) => l[0] === "logout")) === JSON.stringify([["logout", "local"]]), JSON.stringify(st.log));
  check("2. the phone is still signed in (one live session left)", (await sessionsLive()) === 1);
  check("…the paired screen's first activity is recorded", !!st.db.devices[0].last_seen_at);

  // ---- 4. the other tab, the old session, parent pages ----
  await tab1.reload(); await tab1.waitForLoadState("networkidle");
  check("4. the parent tab's next request can't open parent pages (sent to sign-in)", path(tab1).startsWith("/login"), path(tab1));
  check("…and sign-in explains this browser is the kid screen and what signing in does", /This browser is the kid screen “Living room TV”/.test(await tab1.innerText("main")) && /disconnects it/.test(await tab1.innerText("main")));
  for (const p of ["/parent", "/parent/settings", "/parent/review", "/parent/account"]) {
    await tab1.goto(`${BASE}${p}`); await tab1.waitForLoadState("networkidle");
    check(`…${p} is not available to the kid screen`, !/Sign out|Connected screens|Make a code/.test(await tab1.innerText("body")) && (path(tab1).startsWith("/login") || !path(tab1).startsWith("/parent")), path(tab1));
  }
  const replay = await b.newContext(); await replay.addCookies(oldLaptopSession);
  const rp = await replay.newPage(); await rp.goto(`${BASE}/parent/devices`); await rp.waitForLoadState("networkidle");
  check("the laptop's old session cookies, replayed in another browser, are refused (revoked on the server)", path(rp).startsWith("/login"), path(rp));
  await ph.goto(`${BASE}/parent/devices`); await ph.waitForLoadState("networkidle");
  const phoneText = await ph.innerText("main");
  check("phone: Screens shows the new screen as active", /Living room TV/.test(phoneText) && /Active in the last 5 minutes/.test(phoneText), phoneText.slice(0, 300));

  // ---- 5. the parent signs in on the paired laptop ----
  const token = (await deviceCookie(laptop)).value;
  await signIn(tab1, "/parent");
  const st2 = await fake("/__state");
  check("5. signing in on the kid screen lands on Screens with an explanation", path(tab1).startsWith("/parent/devices?converted=") && /This browser was the kid screen\s+Living room TV/.test(await tab1.innerText("main")), path(tab1));
  check("…the screen cookie is gone and the screen's record is disconnected (no orphan)", !(await deviceCookie(laptop)) && !!st2.db.devices[0].revoked_at);
  check("…the laptop is a parent browser again; the phone is still signed in", (await authCookies(laptop)).length >= 2 && (await sessionsLive()) === 2);
  await tab2.goto(`${BASE}/watch`); await tab2.waitForLoadState("networkidle");
  check("…the kid tab in the same browser is no longer a kid screen", !(await deviceCookie(laptop)));

  // ---- 6. the old screen token stays invalid ----
  const thief = await b.newContext(); await thief.addCookies([{ name: "skv_device", value: token, url: BASE }]);
  const tp = await thief.newPage(); await tp.goto(`${BASE}/watch`); await tp.waitForLoadState("networkidle");
  check("6. the disconnected screen's token no longer opens the kid screen", path(tp).startsWith("/pair"), path(tp));

  // ---- sign out: this browser only ----
  await tab1.goto(`${BASE}/parent/account`); await tab1.locator("button", { hasText: "Sign out" }).click();
  await tab1.waitForURL((u) => u.pathname === "/", { timeout: 15000 }).catch(() => {});
  check("Sign out on the laptop ends only the laptop's session (local scope)", (await authCookies(laptop)).length === 0 && (await sessionsLive()) === 1 && (await fake("/__state")).log.filter((l) => l[0] === "logout").every((l) => l[1] === "local"));
  await ph.reload(); await ph.waitForLoadState("networkidle");
  check("…the phone is still signed in", path(ph).startsWith("/parent/devices") && /Connected screens/.test(await ph.innerText("main")));

  await tab1.screenshot({ path: `${OUT}/session-laptop-final.png` }).catch(() => {});
  await b.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
