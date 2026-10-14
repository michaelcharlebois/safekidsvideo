import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/logo";
import { IconHand, IconHome, IconSearch } from "@/components/icons";
import { ExitButton } from "./exit-button";
import { FullscreenButton } from "./fullscreen-button";

/*
 * Kid-screen chrome shared by Home, Search and Who's watching, one per interface. Presentation only.
 * TV: one focus row (data-nav-row) of .bigbtn pills. Tablet: a top bar. Phone: a compact bar + bottom tabs.
 */
export type KidChild = { name: string; avatar: string };
export type Tab = "home" | "search" | "ask" | null;

export function TvTopBar({ child, canSearch, canSwitch, active, minutesLeft, exitTarget, startOn }: {
  child?: KidChild; canSearch: boolean; canSwitch: boolean; active: Tab; minutesLeft?: number; exitTarget: string; startOn?: "home" | "search";
}) {
  const pill = (on: boolean) => `bigbtn flex items-center gap-[0.6vw] rounded-full px-[1.6vw] py-[0.8vw] text-[1.5vw] font-extrabold ${on ? "bg-[rgb(255_249_241/0.1)]" : "text-[var(--kmuted)]"}`;
  return (
    <header data-nav-row className="flex items-center gap-[1.2vw]">
      <BrandMark tone="dark" size={0} className="h-[3.2vw] w-auto" />
      <Link href="/watch" aria-current={active === "home" ? "page" : undefined} data-tv-start={startOn === "home" ? "" : undefined} className={`${pill(active === "home")} ml-[1vw]`}>Home</Link>
      {canSearch && <Link href="/watch/search" aria-current={active === "search" ? "page" : undefined} data-tv-start={startOn === "search" ? "" : undefined} className={pill(active === "search")}><IconSearch size={0} className="h-[1.5vw] w-[1.5vw]" />Search</Link>}
      <div className="ml-auto flex items-center gap-[1.2vw]">
        {minutesLeft != null && <span className="text-[1.2vw] font-bold text-[var(--kmuted)]">{minutesLeft} min left today</span>}
        {child && (canSwitch
          ? <Link href="/watch/who" className="bigbtn flex items-center gap-[0.6vw] rounded-full bg-[rgb(255_249_241/0.1)] py-[0.5vw] pl-[0.5vw] pr-[1.4vw] text-[1.4vw] font-extrabold"><span className="text-[2vw] leading-none" aria-hidden>{child.avatar}</span>{child.name}</Link>
          : <span className="flex items-center gap-[0.6vw] text-[1.4vw] font-extrabold"><span className="text-[2vw] leading-none" aria-hidden>{child.avatar}</span>{child.name}</span>)}
        <ExitButton target={exitTarget} />
      </div>
    </header>
  );
}

export function ChildChip({ child, canSwitch, compact = false }: { child: KidChild; canSwitch: boolean; compact?: boolean }) {
  const inner = <><span className={compact ? "text-2xl leading-none" : "text-3xl leading-none"} aria-hidden>{child.avatar}</span><span className={compact ? "sr-only" : ""}>{child.name}</span></>;
  return canSwitch
    ? <Link href="/watch/who" aria-label={`Switch from ${child.name}`} className="flex h-12 items-center gap-2 rounded-full bg-[rgb(255_249_241/0.1)] px-3 text-lg font-extrabold">{inner}</Link>
    : <span className="flex h-12 items-center gap-2 px-1 text-lg font-extrabold">{inner}</span>;
}

export function TabletTopBar({ child, canSearch, canSwitch, active, exitTarget, title }: {
  child: KidChild; canSearch: boolean; canSwitch: boolean; active: Tab; exitTarget: string; title: ReactNode;
}) {
  const pill = (on: boolean) => `flex h-12 items-center gap-2 rounded-full px-5 text-lg font-extrabold ${on ? "bg-[rgb(255_249_241/0.14)]" : "text-[var(--kmuted)]"}`;
  return (
    <header className="flex items-center gap-3">
      <BrandMark tone="dark" size={40} />
      <h1 className="ml-1 text-2xl font-extrabold">{title}</h1>
      <nav aria-label="Kid" className="ml-auto flex items-center gap-2">
        <Link href="/watch" aria-current={active === "home" ? "page" : undefined} className={pill(active === "home")}><IconHome size={22} />Home</Link>
        {canSearch && <Link href="/watch/search" aria-current={active === "search" ? "page" : undefined} className={pill(active === "search")}><IconSearch size={22} />Search</Link>}
        <ChildChip child={child} canSwitch={canSwitch} />
        <FullscreenButton />
        <ExitButton target={exitTarget} />
      </nav>
    </header>
  );
}

export function PhoneTopBar({ child, canSwitch, exitTarget, title, sub }: { child: KidChild; canSwitch: boolean; exitTarget: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 pb-2 pt-3">
      <BrandMark tone="dark" size={32} />
      <div className="min-w-0 flex-1 pl-1">
        <h1 className="truncate text-xl font-extrabold">{title}</h1>
        {sub && <p className="text-sm font-semibold text-[var(--kmuted)]">{sub}</p>}
      </div>
      <ChildChip child={child} canSwitch={canSwitch} compact />
      <ExitButton target={exitTarget} />
    </header>
  );
}

export function PhoneTabs({ canSearch, active }: { canSearch: boolean; active: Tab }) {
  const tab = (on: boolean) => `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-extrabold ${on ? "text-[var(--kink)]" : "text-[var(--kmuted)]"}`;
  return (
    <nav aria-label="Kid" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[rgb(255_249_241/0.1)] bg-[#082219]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <Link href="/watch" aria-current={active === "home" ? "page" : undefined} className={tab(active === "home")}><IconHome size={24} />Home</Link>
      {canSearch && <Link href="/watch/search" aria-current={active === "search" ? "page" : undefined} className={tab(active === "search")}><IconSearch size={24} />Search</Link>}
      <Link href="/watch?ask=1" aria-current={active === "ask" ? "page" : undefined} className={tab(active === "ask")}><IconHand size={24} />Ask</Link>
    </nav>
  );
}
