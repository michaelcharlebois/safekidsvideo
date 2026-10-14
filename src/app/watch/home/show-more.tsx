"use client";

import { Children, useId, useRef, useState, type ReactNode } from "react";

/**
 * A list that shows the first `limit` items and a "Show all N" / "Show less" button for the rest. Nothing is
 * dropped: every item is one tap away, the button says how many there are, and it's a real button with
 * aria-expanded. Expanding moves focus to the first newly shown item; collapsing returns it to the button.
 */
export function ShowMore({ limit, label, className, children }: { limit: number; label: string; className: string; children: ReactNode }) {
  const items = Children.toArray(children);
  const [open, setOpen] = useState(false);
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    requestAnimationFrame(() => {
      if (next) list.current?.children[limit]?.querySelector<HTMLElement>("a,button,[tabindex]")?.focus();
      else button.current?.focus();
    });
  };
  return (
    <>
      <ul id={id} ref={list} className={className} aria-label={label}>{open ? items : items.slice(0, limit)}</ul>
      {items.length > limit && (
        <button ref={button} type="button" aria-expanded={open} aria-controls={id} onClick={toggle}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-[rgb(255_249_241/0.1)] text-base font-extrabold text-[var(--kink)] active:scale-[0.98] sm:w-auto sm:px-8">
          {open ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}
