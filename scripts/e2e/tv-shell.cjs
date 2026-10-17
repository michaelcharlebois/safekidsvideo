/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// The Samsung TV shell (tizen/app) on Chromium 108, loaded from file:// as the TV loads it from the package.
// Cases: site up (hands over to /watch), down, protected (401), TV clock wrong, not configured. Run via tv-shell.sh.
const puppeteer = require(process.env.PUPPETEER_MODULE || "puppeteer-core");
const fs = require("node:fs"); const path = require("node:path"); const http = require("node:http");
const SITE = process.env.BASE; // the app, local mode
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TIZEN8 = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36";

/** A copy of the shell with its config, as build-and-install.ps1 makes it. */
function shellWith(site, bypass = "") {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bf-shell-"));
  for (const f of ["index.html", "shell.js", "shell.css", "icon.png"]) fs.copyFileSync(path.join("tizen/app", f), path.join(dir, f));
  if (site !== null) fs.writeFileSync(path.join(dir, "shell-config.js"), `window.BF_SHELL = { site: ${JSON.stringify(site)}, bypass: ${JSON.stringify(bypass)}, version: "0.2.0" };`);
  return `file://${dir}/index.html`;
}
/** A stand-in site answering /api/tv/ping with a fixed status and body. */
function stub(status, body) {
  return new Promise((res) => { const s = http.createServer((q, r) => { r.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); r.end(JSON.stringify(body)); }).listen(0, () => res(s)); });
}

(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME108, headless: true, args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"] });
  check(`engine ${await b.version()}`, /\/108\./.test(await b.version()));
  const open = async (url) => { const p = await (await b.createIncognitoBrowserContext()).newPage(); await p.setUserAgent(TIZEN8); await p.setViewport({ width: 1920, height: 1080 }); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); await p.goto(url); return { p, errs }; };
  const text = (p) => p.evaluate(() => document.body.innerText);

  // Site up: the shell checks /api/tv/ping, then opens /watch on the site.
  let { p, errs } = await open(shellWith(SITE));
  await p.waitForFunction((s) => location.href.startsWith(s), { timeout: 15000 }, SITE).catch(() => {});
  check("site up: hands over to the site's kid screen (/watch, then Who's watching / Home)", p.url().startsWith(SITE + "/watch"), p.url());
  check("…with no shell script errors", errs.length === 0, JSON.stringify(errs));

  // Site down.
  ({ p, errs } = await open(shellWith("http://localhost:9")));
  await wait(2500);
  let t = await text(p);
  check("site down: says it can't reach Brightframe, with details and what to do", /Can't reach Brightframe/.test(t) && /couldn't be reached|didn't answer/.test(t) && /Press OK to try again/.test(t) && /Attempts:\s+1/.test(t) && /Engine:\s+Chromium 108\.0\.5359\.1 · Tizen 8\.0/.test(t), t.slice(0, 400));
  await p.keyboard.press("Enter"); await wait(2500);
  check("…OK retries (attempt 2)", /Attempts:\s+2/.test(await text(p)));
  await p.screenshot({ path: `${process.env.OUT}/shell-unreachable.png` });

  // Protected staging without the bypass secret.
  const s401 = await stub(401, { error: "Authentication Required" });
  ({ p } = await open(shellWith(`http://localhost:${s401.address().port}`)));
  await wait(2000); t = await text(p);
  check("protected site: explains the bypass secret is needed", /refused the TV \(HTTP 401\)/.test(t) && /protection-bypass secret/.test(t), t.slice(0, 300));

  // The bypass secret, when given, is sent on the check (and the hand-over).
  let seen = "";
  const sBy = await new Promise((res) => { const s = http.createServer((q, r) => { seen = q.url; r.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); r.end(JSON.stringify({ ok: true, time: new Date().toISOString() })); }).listen(0, () => res(s)); });
  ({ p } = await open(shellWith(`http://localhost:${sBy.address().port}`, "secret0123456789abcdef")));
  await wait(2000);
  check("bypass secret goes on the check and the hand-over URL", /x-vercel-protection-bypass=secret0123456789abcdef/.test(seen) && /x-vercel-set-bypass-cookie=true/.test(p.url() + seen), `${seen} → ${p.url()}`);

  // TV clock 10 minutes fast: a note for a grown-up, then it carries on.
  const sSkew = await stub(200, { ok: true, time: new Date(Date.now() - 10 * 60000).toISOString() });
  ({ p } = await open(shellWith(`http://localhost:${sSkew.address().port}`)));
  await wait(1500); t = await text(p);
  check("TV clock 10 min fast: tells a grown-up, then continues", /clock is about 10 minutes fast/.test(t), t.slice(0, 300));
  await p.screenshot({ path: `${process.env.OUT}/shell-clock.png` });

  // Not configured.
  ({ p } = await open(shellWith(null)));
  await wait(800); t = await text(p);
  check("not configured: says so (no blind navigation)", /isn't set up/.test(t) && /build-and-install\.ps1/.test(t), t.slice(0, 200));

  // A non-Brightframe answer (e.g. a sign-in page with 200).
  const sHtml = await new Promise((res) => { const s = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" }); r.end("<html>Log in to Vercel</html>"); }).listen(0, () => res(s)); });
  ({ p } = await open(shellWith(`http://localhost:${sHtml.address().port}`)));
  await wait(1500);
  check("a sign-in page instead of Brightframe: explained", /didn't answer like Brightframe/.test(await text(p)));

  for (const s of [s401, sBy, sSkew, sHtml]) s.close();
  await b.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
