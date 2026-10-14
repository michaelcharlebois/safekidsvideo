"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A horizontally scrolling row of pills for narrow screens. The edge with more to scroll fades and shows an
 * arrow button; the item marked `data-active` is kept in view. From `lg` up (or when it all fits) it's a
 * plain row. `className` styles the <ul>; children are <li>s.
 */
export function ScrollRow({ children, label, className = "", activeKey }: { children: ReactNode; label: string; className?: string; activeKey?: string }) {
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    row.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeKey]);

  const nudge = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  return (
    <div className="relative">
      <ul ref={row} aria-label={label} className={`flex snap-x scroll-px-4 gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
        {children}
      </ul>
      {more.left && (
        <button type="button" onClick={() => nudge(-1)} aria-label="Scroll left"
          className="absolute inset-y-0 left-0 flex w-12 items-center justify-start bg-gradient-to-r from-ivory via-ivory/90 to-transparent pl-2 text-xl font-bold text-forest">‹</button>
      )}
      {more.right && (
        <button type="button" onClick={() => nudge(1)} aria-label="Scroll right"
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-ivory via-ivory/90 to-transparent pr-2 text-xl font-bold text-forest">›</button>
      )}
    </div>
  );
}
