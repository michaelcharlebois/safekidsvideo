"use client";

import { useEffect } from "react";

/**
 * TV focus. On open: the first playable video, or — when there's nothing to play — Search (if this child
 * can search) or Home, marked data-tv-start, so the remote's first OK always does something predictable.
 * A pointer (e.g. a motion remote) moves focus instead of drawing a second highlight: there is only ever
 * one focused item on the TV.
 */
export function TvFocus() {
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      const start = document.querySelector<HTMLElement>('.kid-bf.tv .tile a, .kid-bf.tv .tile button:not([aria-disabled="true"])') ?? document.querySelector<HTMLElement>(".kid-bf.tv [data-tv-start]");
      start?.focus({ preventScroll: true });
    }
    const onOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".kid-bf.tv .tile a, .kid-bf.tv .tile button, .kid-bf.tv .bigbtn");
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, []);
  return null;
}
