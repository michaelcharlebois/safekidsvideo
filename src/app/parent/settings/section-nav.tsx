"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The child page's section index. On a phone it's a sticky, horizontally scrolling row: the edge that has
 * more to scroll fades and shows an arrow, and the section you're reading is highlighted and kept in view.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const [current, setCurrent] = useState(sections[0]?.id);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Highlight the section in view.
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setCurrent(top.target.id.replace(/^sec-/, ""));
    }, { rootMargin: "-30% 0px -60% 0px" });
    sections.forEach((s) => { const t = document.getElementById(`sec-${s.id}`); if (t) io.observe(t); });
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); io.disconnect(); };
  }, [sections]);

  useEffect(() => {
    row.current?.querySelector<HTMLElement>(`[data-id="${current}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [current]);

  const nudge = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  return (
    <nav aria-label="Sections" className="sticky top-[57px] z-10 -mx-4 mt-5 bg-ivory/95 py-2 backdrop-blur lg:top-0 lg:mx-0">
      <div className="relative">
        <ul ref={row} className="flex snap-x scroll-px-4 gap-1.5 overflow-x-auto lg:scroll-px-0 whitespace-nowrap px-4 [scrollbar-width:none] lg:px-0 [&::-webkit-scrollbar]:hidden">
          {sections.map((x) => (
            <li key={x.id} className="snap-start">
              <a href={`#${x.id}`} data-id={x.id} aria-current={current === x.id ? "true" : undefined}
                className={`inline-flex h-10 items-center rounded-full border px-4 text-sm font-bold ${current === x.id ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink hover:border-forest/40"}`}>
                {x.label}
              </a>
            </li>
          ))}
        </ul>
        {more.left && (
          <button type="button" onClick={() => nudge(-1)} aria-label="Scroll sections left"
            className="absolute inset-y-0 left-0 flex w-12 items-center justify-start bg-gradient-to-r from-ivory via-ivory/90 to-transparent pl-2 text-xl font-bold text-forest lg:hidden">‹</button>
        )}
        {more.right && (
          <button type="button" onClick={() => nudge(1)} aria-label="Scroll sections right"
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-ivory via-ivory/90 to-transparent pr-2 text-xl font-bold text-forest lg:hidden">›</button>
        )}
      </div>
    </nav>
  );
}
