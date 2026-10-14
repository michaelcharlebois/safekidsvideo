"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROWS = ["abcdefghi", "jklmnopqr", "stuvwxyz'", "1234567890"];

/**
 * A remote-operated keyboard for the TV: arrows move between keys (each row is a nav row for RemoteNav),
 * OK types. No text field, so the TV's own pop-up keyboard never appears. A connected keyboard or the
 * remote's number keys type too. Search goes to /watch/search?q=…
 */
export function TvKeyboard({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const add = (c: string) => setQ((x) => (x.length < 40 ? x + c : x));
  const go = () => { if (!q.trim()) return; (document.activeElement as HTMLElement | null)?.blur(); router.push(`/watch/search?q=${encodeURIComponent(q.trim())}`); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-z0-9']$/i.test(e.key)) { e.preventDefault(); add(e.key.toLowerCase()); }
      else if (e.keyCode >= 48 && e.keyCode <= 57 && e.key.length !== 1) { e.preventDefault(); add(String(e.keyCode - 48)); }
      else if (e.key === "Backspace") { e.preventDefault(); setQ((x) => x.slice(0, -1)); }
      else if (e.key === " " && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); add(" "); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const key = "bigbtn flex h-[4.4vw] min-w-[4.4vw] items-center justify-center rounded-[1vw] bg-[rgb(255_249_241/0.08)] text-[1.8vw] font-extrabold";
  return (
    <div className="space-y-[0.7vw]">
      <div className="flex h-[5vw] items-center rounded-full bg-[rgb(255_249_241/0.08)] px-[2vw] text-[2.2vw] font-bold" aria-live="polite" aria-label="What you typed">
        {q ? <span>{q}<span className="ml-[0.2vw] inline-block h-[2.4vw] w-[0.2vw] animate-pulse bg-[var(--kfocus)] align-middle" aria-hidden /></span> : <span className="text-[var(--kmuted)]">What do you want to watch?</span>}
      </div>
      {ROWS.map((r, i) => (
        <div key={r} data-nav-row className="flex gap-[0.7vw]">
          {r.split("").map((c, j) => <button key={c} type="button" data-tv-start={i === 0 && j === 0 ? "" : undefined} onClick={() => add(c)} className={key} aria-label={c === "'" ? "apostrophe" : c}>{c.toUpperCase()}</button>)}
        </div>
      ))}
      <div data-nav-row className="flex gap-[0.7vw]">
        <button type="button" onClick={() => add(" ")} className={`${key} px-[3vw]`}>Space</button>
        <button type="button" onClick={() => setQ((x) => x.slice(0, -1))} className={`${key} px-[2vw]`} aria-label="Delete a letter">Delete</button>
        <button type="button" onClick={() => setQ("")} className={`${key} px-[2vw]`}>Clear</button>
        <button type="button" onClick={go} disabled={!q.trim()} className={`${key} bg-[var(--kfocus)] px-[3vw] text-[#2a1206] disabled:opacity-50`}>Search</button>
      </div>
    </div>
  );
}
