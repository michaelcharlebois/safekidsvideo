"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The kid-mode header, hidden while a video is playing (the player is full-bleed). */
export function KidHeader({ children, homeHasOwn = false }: { children: ReactNode; homeHasOwn?: boolean }) {
  const pathname = usePathname();
  if (/^\/watch\/[A-Za-z0-9_-]{11}$/.test(pathname)) return null;
  if (homeHasOwn && (pathname === "/watch" || pathname === "/watch/search")) return null; // Home and Search draw their own chrome per device
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 bg-gradient-to-b from-[#0b1020] to-transparent">
      {children}
    </header>
  );
}
