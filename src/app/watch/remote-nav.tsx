"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * TV-remote navigation for kid mode. Arrow keys move focus to the nearest tile or
 * button in that direction (geometric spatial nav), Enter activates, Back goes home.
 * Samsung/LG/Fire TV browsers all send these as ordinary key events.
 */
const SELECTOR = '.tile a, .tile button, .bigbtn, input[name="q"]';
const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack", "Backspace"]);
const BACK_CODES = new Set([10009 /* Samsung Return */, 461 /* LG Back */, 27, 8]);

export function RemoteNav() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT" && !e.key.startsWith("Arrow");
      if (typing) return;

      if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) {
        e.preventDefault();
        if (pathname !== "/watch") {
          router.push("/watch");
        } else {
          // Already home: inside the Samsung TV app, Return leaves the app like any other app.
          const t = (window as Window & { tizen?: { application: { getCurrentApplication(): { exit(): void } } } }).tizen;
          try { t?.application.getCurrentApplication().exit(); } catch { /* not in a Tizen app */ }
        }
        return;
      }

      const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key as string];
      if (!dir) return;
      const items = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const cur = document.activeElement as HTMLElement | null;
      const from = cur && items.includes(cur) ? cur.getBoundingClientRect() : null;
      if (!from) {
        e.preventDefault();
        items[0].focus();
        items[0].scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        return;
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
      if (best) {
        e.preventDefault();
        best.focus({ preventScroll: true });
        best.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  return null;
}
