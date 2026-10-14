"use client";

import { useEffect } from "react";

/**
 * TV focus on Search. On open: the result you last had (coming back from the player), else the first
 * result, else the first key. When a result changes state underneath you (asked → waiting, checked →
 * ready) and focus falls to the page, it goes back to the same result. The remote always has a target.
 */
export function SearchFocus({ q }: { q: string }) {
  useEffect(() => {
    const key = `bf_search_focus:${q}`;
    const store = { get: () => { try { return sessionStorage.getItem(key); } catch { return null; } }, set: (v: string) => { try { sessionStorage.setItem(key, v); } catch { /* private mode */ } } };
    const focusable = (li: Element | null) => li?.querySelector<HTMLElement>("a, button") ?? null;
    const restore = () => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const last = store.get();
      const el = (last ? focusable(document.querySelector(`.kid-bf.tv [data-result="${CSS.escape(last)}"]`)) : null)
        ?? focusable(document.querySelector(".kid-bf.tv [data-result]"))
        ?? document.querySelector<HTMLElement>(".kid-bf.tv [data-tv-start]");
      el?.focus({ preventScroll: true });
    };
    restore();
    const onIn = (e: FocusEvent) => { const id = (e.target as HTMLElement).closest("[data-result]")?.getAttribute("data-result"); if (id) store.set(id); };
    const onOver = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".kid-bf.tv .tile a, .kid-bf.tv .tile button, .kid-bf.tv .bigbtn");
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    };
    const mo = new MutationObserver(() => requestAnimationFrame(restore));
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onIn);
    document.addEventListener("pointerover", onOver);
    return () => { mo.disconnect(); document.removeEventListener("focusin", onIn); document.removeEventListener("pointerover", onOver); };
  }, [q]);
  return null;
}
