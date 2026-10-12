"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * TV-remote navigation for kid mode. Arrow keys move focus to the nearest tile, button
 * or field in that direction (geometric spatial nav), Enter activates, Back goes home.
 * Samsung/LG/Fire TV browsers all send these as ordinary key events.
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

/** Move focus from `cur` to the nearest navigable element in `dir`. Returns true if it moved. */
export function moveFocus(dir: Dir, root: ParentNode = document): boolean {
  const items = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => el.offsetParent !== null);
  if (!items.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  const from = cur && items.includes(cur) ? cur.getBoundingClientRect() : null;
  if (!from) {
    // Nothing focused yet: start on the first thing that isn't the header, if there is one.
    const first = items.find((el) => !el.closest("header")) ?? items[0];
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    return true;
  }
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    const forward = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (forward < 8) continue; // must be in that direction
    const sideways = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = forward + sideways * 2.5; // prefer staying in the same row/column
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  return true;
}

export function exitTizenApp() {
  const t = (window as Window & { tizen?: { application: { getCurrentApplication(): { exit(): void } } } }).tizen;
  try { t?.application.getCurrentApplication().exit(); } catch { /* not in a Tizen app */ }
}

export function RemoteNav({ home = "/watch" }: { home?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (PLAYER_PATH.test(pathname)) return; // the player handles its own keys
    const onKey = (e: KeyboardEvent) => {
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
      if (!dir) return;
      // In a text field, left/right move the caret; up/down leave the field.
      if (inInput && (dir === "left" || dir === "right")) return;
      if (moveFocus(dir)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname, home]);

  return null;
}
