"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * TV-remote navigation for kid mode. Arrow keys move focus to the nearest tile, button
 * or field in that direction (geometric spatial nav), Enter activates, Back goes home.
 * Samsung/LG/Fire TV browsers all send these as ordinary key events.
 *
 * We listen in the capture phase and preventDefault every arrow we understand, so a TV
 * engine's own built-in spatial navigation can't fight ours.
 */
const SELECTOR = '.tile a, .tile button, .bigbtn, input:not([type="hidden"]), button[type="submit"]';
const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack", "Backspace"]);
const BACK_CODES = new Set([10009 /* Samsung Return */, 461 /* LG Back */, 27, 8]);
const DIR_BY_KEY: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Left: "left", Right: "right", Up: "up", Down: "down" };
const DIR_BY_CODE: Record<number, Dir> = { 37: "left", 38: "up", 39: "right", 40: "down" };
type Dir = "left" | "right" | "up" | "down";

export const PLAYER_PATH = /^\/watch\/[A-Za-z0-9_-]{11}$/;

/** Direction for an arrow key event, tolerant of older TV engines that only set keyCode. */
export function arrowDir(e: KeyboardEvent): Dir | undefined {
  return DIR_BY_KEY[e.key] ?? DIR_BY_CODE[e.keyCode];
}
export function isBack(e: KeyboardEvent) {
  return BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode);
}
export function isEnter(e: KeyboardEvent) {
  return e.key === "Enter" || e.keyCode === 13;
}

const visible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
export function navigables(root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter(visible);
}

/**
 * Bring a focused element into view by scrolling its containers directly. TV engines are
 * flaky about scrollIntoView on the document, so: the shelf scrolls horizontally, and the
 * nearest vertical scroller (the kid-mode pane, else the window) centres the element.
 */
export function reveal(el: HTMLElement) {
  const shelf = el.closest<HTMLElement>(".shelf");
  if (shelf) {
    const r = el.getBoundingClientRect(), s = shelf.getBoundingClientRect();
    shelf.scrollLeft += r.left + r.width / 2 - (s.left + s.width / 2);
  }
  const pane = el.closest<HTMLElement>("[data-scroll-pane]");
  const r = el.getBoundingClientRect();
  if (pane) {
    const p = pane.getBoundingClientRect();
    // Header items: go to the very top so the first shelf title is visible too.
    pane.scrollTop = el.closest("header") ? 0 : pane.scrollTop + (r.top + r.height / 2) - (p.top + p.height / 2);
  } else {
    window.scrollTo(0, el.closest("header") ? 0 : window.scrollY + r.top + r.height / 2 - innerHeight / 2);
  }
}

/** Move focus from the active element to the nearest navigable element in `dir`. Returns true if it moved. */
export function moveFocus(dir: Dir, root: ParentNode = document): boolean {
  const items = navigables(root);
  if (!items.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  const from = cur && items.includes(cur) ? cur.getBoundingClientRect() : null;
  if (!from) {
    // Nothing focused yet: start on the first thing that isn't the header, if there is one.
    const first = items.find((el) => !el.closest("header")) ?? items[0];
    first.focus({ preventScroll: true });
    reveal(first);
    return true;
  }
  // Rows: the header is one, each shelf is one. Left/right never leave the row; up/down change rows.
  const rowOf = (el: HTMLElement) => el.closest("header, .shelf, form");
  const curRow = rowOf(cur!);
  const horizontal = dir === "left" || dir === "right";
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const sameRow = rowOf(el) === curRow;
    if (horizontal ? !sameRow : sameRow) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    const forward = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (forward < 8) continue; // must be in that direction
    const sideways = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const offscreen = r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight;
    const score = forward + sideways * 2.5 + (offscreen ? 10000 : 0); // same column first, on-screen first
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  reveal(best);
  return true;
}

export function exitTizenApp() {
  const t = (window as Window & { tizen?: { application: { getCurrentApplication(): { exit(): void } } } }).tizen;
  try { t?.application.getCurrentApplication().exit(); } catch { /* not in a Tizen app */ }
}

const describe = (el: Element | null) =>
  el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""}` : "none";

export function RemoteNav({ home = "/watch" }: { home?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [debug, setDebug] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).has("debug"));
  const [hud, setHud] = useState("");

  useEffect(() => {
    const onPlayer = PLAYER_PATH.test(pathname);
    const zeros: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      // Press 0 three times quickly → toggle the debug HUD; five times → hard reload (TVs make restarting apps a chore).
      if (e.key === "0" || e.keyCode === 48) {
        zeros.push(Date.now());
        while (zeros.length && Date.now() - zeros[0] > 2500) zeros.shift();
        if (zeros.length === 3) setDebug((d) => !d);
        if (zeros.length >= 5) { zeros.length = 0; location.href = location.pathname + "?debug&r=" + Date.now(); }
      }
      const items = navigables();
      const report = (what: string) =>
        setHud(`${what} | key=${e.key} code=${e.keyCode} | focus=${describe(document.activeElement)} | nav=${items.length} tiles=${items.filter((x) => x.closest(".tile")).length}`);

      if (onPlayer) { report("player"); return; } // the player handles its own keys
      const target = e.target as HTMLElement | null;
      const inInput = target?.tagName === "INPUT";
      const dir = arrowDir(e);

      if (isBack(e)) {
        if (inInput && (target as HTMLInputElement).value && e.keyCode === 8) return; // Backspace edits the field
        e.preventDefault();
        if (pathname !== home) router.push(home);
        else exitTizenApp(); // Already home: inside the Samsung TV app, Return leaves the app like any other app.
        return;
      }
      if (!dir) { report("other"); return; }
      // In a text field, left/right move the caret; up/down leave the field.
      if (inInput && (dir === "left" || dir === "right")) return;
      // Always claim arrows so the engine's native spatial nav / scrolling stays out of it.
      e.preventDefault();
      e.stopPropagation();
      const moved = moveFocus(dir);
      report(moved ? `moved ${dir}` : `no target ${dir}`);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router, pathname, home]);

  if (!debug) return null;
  return (
    <pre className="fixed bottom-1 left-1 z-[100] max-w-[95vw] whitespace-pre-wrap rounded bg-black/80 px-2 py-1 text-[12px] leading-tight text-lime-300">
      build {(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)} · {navigator.userAgent.includes("Tizen") ? "tizen" : "web"} · {innerWidth}×{innerHeight}{"\n"}
      {hud || "press a key…"}
    </pre>
  );
}
