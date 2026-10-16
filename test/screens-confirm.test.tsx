// The Disconnect confirmation on Screens: in-flow (it can't be clipped by the card's overflow-hidden),
// names the screen, and has explicit Cancel and Disconnect. Part 2 opens it in Chromium with the app's
// built CSS at phone, tablet and desktop widths and checks it's entirely visible (skipped without a build
// or a browser).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ScreenList, type ScreenRow } from "@/app/parent/devices/screen-list";
import { Card, PAGE, SectionHeader } from "@/components/ui";
import { lastActiveLabel } from "@/lib/last-active";

const NOW = Date.parse("2026-10-16T03:00:00Z"); // 8:00 pm, 15 Oct, Los Angeles
const profiles = [{ id: "maya", name: "Maya" }, { id: "leo", name: "Leo" }];
const screens: ScreenRow[] = [
  { id: "tv", name: "Living room TV", last_seen_at: new Date(NOW - 2 * 60_000).toISOString(), assigned_profile_id: null, active_profile_id: "maya" },
  { id: "tab", name: "Maya's tablet with a rather long name", last_seen_at: new Date(NOW - 26 * 3_600_000).toISOString(), assigned_profile_id: "maya", active_profile_id: null },
  { id: "new", name: "Kitchen", last_seen_at: null, assigned_profile_id: null, active_profile_id: null },
];
const render = (confirmId?: string) => renderToStaticMarkup(
  <main className={PAGE}>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card as="section" className="overflow-hidden" >
        <div className="border-b border-sand px-5 py-4"><SectionHeader title="Connected screens" /></div>
        <ScreenList screens={screens} profiles={profiles} confirmId={confirmId} now={NOW} tz="America/Los_Angeles" assignAction="/assign" disconnectAction="/disconnect" />
      </Card>
      <Card as="section" className="p-5"><SectionHeader title="Connect a screen" /></Card>
    </div>
  </main>,
);

describe("Disconnect confirmation (markup)", () => {
  it("closed by default: each screen has a Disconnect link naming it, nothing confirms by itself", () => {
    const html = render();
    expect(html).not.toContain("data-disconnect-confirm");
    expect(html).toContain('href="/parent/devices?confirm=tv#screen-tv"');
    expect(html).toContain('Disconnect<span class="sr-only"> Living room TV</span>');
    expect(html).not.toContain('action="/disconnect"');
  });
  it("open for one screen: names it, says what happens, Cancel and Disconnect, in that screen's row only", () => {
    const html = render("tab");
    expect(html.match(/data-disconnect-confirm/g)).toHaveLength(1);
    const panel = html.slice(html.indexOf("data-disconnect-confirm"));
    expect(panel).toContain("Disconnect &ldquo;Maya&#x27;s tablet with a rather long name&rdquo;?".replace("&ldquo;", "“").replace("&rdquo;", "”"));
    expect(panel).toContain("It&#x27;s Maya&#x27;s own screen.");
    expect(panel).toContain('href="/parent/devices#screen-tab"');
    expect(panel).toMatch(/<form action="\/disconnect"><input type="hidden" name="deviceId" value="tab"\/>/);
    expect(panel).toContain(">Disconnect screen</button>");
    expect(html).toContain('href="/parent/devices?confirm=tv#screen-tv"'); // others still closed
  });
  it("an id that isn't one of this family's screens opens nothing", () => {
    expect(render("someone-elses")).not.toContain("data-disconnect-confirm");
  });
});

describe("last active", () => {
  const tz = "America/Los_Angeles";
  it("reads accurately against the 5-minute recording interval", () => {
    expect(lastActiveLabel(null, NOW, tz)).toBe("Not used yet");
    expect(lastActiveLabel(new Date(NOW - 2 * 60_000).toISOString(), NOW, tz)).toBe("Active in the last 5 minutes");
    expect(lastActiveLabel(new Date(NOW - 20 * 60_000).toISOString(), NOW, tz)).toBe("Active 20 minutes ago");
    expect(lastActiveLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW, tz)).toBe("Last active today at 5:00 PM");
    expect(lastActiveLabel(new Date(NOW - 26 * 3_600_000).toISOString(), NOW, tz)).toBe("Last active yesterday at 6:00 PM");
    expect(lastActiveLabel("2026-10-01T19:00:00Z", NOW, tz)).toBe("Last active Oct 1");
    expect(lastActiveLabel("2025-12-24T19:00:00Z", NOW, tz)).toBe("Last active Dec 24, 2025");
  });
  it("uses the family's time zone for 'today'", () => {
    const t = new Date(NOW - 13 * 3_600_000).toISOString(); // 7:00 am today in Los Angeles; 11:00 pm yesterday in Tokyo
    expect(lastActiveLabel(t, NOW, tz)).toBe("Last active today at 7:00 AM");
    expect(lastActiveLabel(t, NOW, "Asia/Tokyo")).toBe("Last active yesterday at 11:00 PM");
  });
});

// ---- in a real browser ----
const cssDir = path.resolve(".next/static/chunks");
const css = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => readFileSync(path.join(cssDir, f), "utf8")).join("\n") : "";
const req = createRequire(import.meta.url);
let chromium: { launch: (o: object) => Promise<any> } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
try { chromium = req(process.env.PLAYWRIGHT_MODULE || "/opt/npm-tools/node_modules/playwright").chromium; } catch { /* no browser */ }
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

describe.skipIf(!css || !chromium || !existsSync(CHROME))("Disconnect confirmation (Chromium, built CSS)", () => {
  it.each([[360, 740], [768, 1024], [1280, 900]])("fully visible inside the card at %ipx", async (w, h) => {
    const b = await chromium!.launch({ executablePath: CHROME });
    try {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body class="bg-ivory">${render("tab")}</body></html>`);
      const m = await p.evaluate(() => {
        const box = (el: Element | null) => el?.getBoundingClientRect();
        const panel = document.querySelector("[data-disconnect-confirm]")!;
        const card = panel.closest("section")!;
        const [cancel, confirm] = [panel.querySelector("a"), panel.querySelector("button")];
        const inside = (a?: DOMRect, c?: DOMRect) => !!a && !!c && a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.top >= c.top - 0.5 && a.bottom <= c.bottom + 0.5;
        const top = (el: Element | null) => { const r = box(el)!; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && el!.contains(hit); };
        panel.scrollIntoView({ block: "center" });
        return {
          inCard: inside(box(panel), box(card)),
          buttonsInPanel: inside(box(cancel), box(panel)) && inside(box(confirm), box(panel)),
          inViewportX: box(panel)!.left >= 0 && box(panel)!.right <= window.innerWidth,
          noPageScrollX: document.documentElement.scrollWidth <= window.innerWidth,
          cancelOnTop: top(cancel), confirmOnTop: top(confirm),
          tapHeight: Math.min(box(cancel)!.height, box(confirm)!.height),
          text: panel.textContent,
        };
      });
      await p.screenshot({ path: `/tmp/screens-confirm-${w}.png`, fullPage: true }).catch(() => {});
      expect(m, JSON.stringify(m)).toMatchObject({ inCard: true, buttonsInPanel: true, inViewportX: true, noPageScrollX: true, cancelOnTop: true, confirmOnTop: true });
      expect(m.tapHeight).toBeGreaterThanOrEqual(36);
      expect(m.text).toContain("Maya's tablet with a rather long name");
    } finally { await b.close(); }
  }, 60_000);
});
