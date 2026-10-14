"use client";

import { useEffect } from "react";

/** TV: put remote focus on the first video when Home opens, so OK always does something visible. */
export function FocusFirst() {
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    document.querySelector<HTMLElement>(".kid-bf .tile a")?.focus({ preventScroll: true });
  }, []);
  return null;
}
