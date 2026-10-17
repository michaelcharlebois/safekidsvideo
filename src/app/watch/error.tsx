"use client";

import { useEffect, useRef } from "react";
import { logDiag } from "@/lib/tv-diagnostics";

/**
 * A kid page failed to render (a network blip mid-navigation, a script error on an older TV engine). A calm
 * screen with Try again and Home, both reachable with the remote; the details go to the diagnostics (press 0
 * three times on the next screen, or the server log). Gating is unaffected: the next page load is checked
 * on the server as usual.
 */
export default function KidError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const again = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    logDiag("page", `${error.message || "Page error"}${error.digest ? ` (digest ${error.digest})` : ""}`);
    again.current?.focus({ preventScroll: true });
  }, [error]);
  const btn = "rounded-full px-8 py-4 text-2xl font-extrabold outline-none focus:shadow-[0_0_0_5px_var(--kfocus)]";
  return (
    <main className="kid-bf flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center" data-kid-error>
      <h1 className="text-4xl font-extrabold">Oops, that didn&apos;t load</h1>
      <p className="max-w-xl text-xl text-[var(--kmuted)]">Let&apos;s try again. If it keeps happening, ask a grown-up.</p>
      <div className="flex gap-4">
        <button ref={again} type="button" onClick={reset} className={`${btn} bg-[var(--kfocus)] text-[#2a1206]`}>Try again</button>
        {/* A full page load (not client navigation): starts clean after an error. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/watch" className={`${btn} bg-[rgb(255_249_241/0.14)] text-[var(--kink)]`}>Home</a>
      </div>
      {error.digest && <p className="text-sm text-[var(--kmuted)]">Code {error.digest}</p>}
    </main>
  );
}
