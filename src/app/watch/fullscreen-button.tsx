"use client";

import { useEffect, useState } from "react";

/**
 * Ask the browser for real full screen (hides its address bar and tabs). Needs a user
 * gesture, so it's a button. iPhone Safari doesn't support it; the button hides there.
 */
export function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    // Pointless inside a TV app or an installed PWA — those are already full screen.
    const tvApp = /Tizen|SMART-TV|Web0S|AFT/i.test(navigator.userAgent) || matchMedia("(display-mode: standalone)").matches;
    const ok = !tvApp && !!(d.requestFullscreen || d.webkitRequestFullscreen);
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    Promise.resolve().then(() => { setSupported(ok); sync(); });
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (!supported) return null;
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
        await (d.requestFullscreen ? d.requestFullscreen({ navigationUI: "hide" }) : d.webkitRequestFullscreen?.());
      }
    } catch { /* some TVs refuse; nothing to do */ }
  };
  return (
    <button onClick={toggle} className="bigbtn rounded-full bg-white/10 px-4 py-2 text-xl font-extrabold active:scale-95" aria-label={on ? "Exit full screen" : "Full screen"}>
      {on ? "🡼" : "⛶"}<span className="hidden sm:inline ml-2 text-base">{on ? "Exit" : "Full screen"}</span>
    </button>
  );
}
