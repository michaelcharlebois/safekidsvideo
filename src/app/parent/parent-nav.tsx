"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Logo } from "@/components/logo";
import { IconAccount, IconActivity, IconHome, IconKids, IconLibrary, IconPlus, IconReview, IconTv, IconUser } from "@/components/icons";

type Tab = { href: string; label: string; Icon: ComponentType<{ size?: number }>; match: (p: string) => boolean; perChild: boolean };
/** The five destinations. Video and channel pages belong to Library. */
export const TABS: Tab[] = [
  { href: "/parent", label: "Home", Icon: IconHome, perChild: true, match: (p) => p === "/parent" },
  { href: "/parent/review", label: "Review", Icon: IconReview, perChild: false, match: (p) => p === "/parent/review" || p.startsWith("/parent/review/") },
  { href: "/parent/library", label: "Library", Icon: IconLibrary, perChild: true, match: (p) => p.startsWith("/parent/library") || p.startsWith("/parent/video") || p.startsWith("/parent/channel") },
  { href: "/parent/activity", label: "Activity", Icon: IconActivity, perChild: true, match: (p) => ["/parent/activity", "/parent/stats", "/parent/insights", "/parent/checkin"].some((x) => p.startsWith(x)) },
  { href: "/parent/kids", label: "Kids", Icon: IconKids, perChild: false, match: (p) => p.startsWith("/parent/kids") || p.startsWith("/parent/settings") },
];
const isAccount = (p: string) => ["/parent/account", "/parent/devices", "/parent/billing", "/parent/reviewer"].some((x) => p.startsWith(x));

/** Pages that are "about one child" (take ?kid=); switching child keeps you on them. Elsewhere it goes Home. */
const PER_CHILD = ["/parent", "/parent/library", "/parent/activity", "/parent/review", "/parent/settings", "/parent/stats", "/parent/insights", "/parent/checkin"];
/** One-off notes from an earlier action; dropped when switching child so they don't describe the wrong child. */
const TRANSIENT = ["kid", "decided", "video", "error", "saved", "failed", "confirm", "for", "via", "ref", "why", "batch", "pack", "n", "screen", "more"];

export type NavKid = { id: string; name: string; avatar: string; pending: number };

/**
 * The parent shell's navigation, one component, three layouts:
 *  - ≥1024px: a left sidebar (logo, the five destinations, children, then kid screen and Account at the foot)
 *  - 768–1023px: a top bar with the five destinations inline and an Account menu
 *  - <768px: a compact top bar (kid screen, Account menu) + a five-tab bottom bar
 * Home, Library and Activity carry the selected child (?kid=); Review shows every child unless filtered.
 * `badge` = requests and old records waiting in Review. Nothing here is decorative.
 */
export function ParentNav({ badge = 0, kids, defaultKidId }: { badge?: number; kids: NavKid[]; defaultKidId?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const activeKid = (sp.get("kid") && kids.some((k) => k.id === sp.get("kid")) ? sp.get("kid") : null) ?? (pathname === "/parent/review" ? null : defaultKidId ?? kids[0]?.id);
  // Switching child keeps you on the same page with the same view (filters, tab, search), minus old notes.
  const kidHref = (id: string) => {
    if (!PER_CHILD.includes(pathname)) return `/parent?kid=${id}`;
    const q = new URLSearchParams(sp.toString());
    for (const k of TRANSIENT) q.delete(k);
    q.set("kid", id);
    return `${pathname}?${q}`;
  };
  const tabHref = (t: Tab) => (activeKid && t.perChild ? `${t.href}?kid=${activeKid}` : t.href);
  const Badge = ({ n, className = "" }: { n: number; className?: string }) =>
    n > 0 ? <span className={`min-w-5 rounded-full bg-apricot px-1.5 text-center text-[11px] font-extrabold leading-5 text-forest ${className}`} aria-label={`${n} waiting`}>{n}</span> : null;

  return (
    <>
      {/* ---- sidebar (desktop) ---- */}
      <div className="hidden w-64 shrink-0 border-r border-sand lg:block">
      <aside className="sticky top-0 flex h-dvh flex-col px-4 py-6">
        <Link href="/parent" className="mb-8 inline-flex rounded-md px-2" aria-label="Brightframe home"><Logo height={30} /></Link>
        <nav aria-label="Main" className="space-y-1">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link key={t.href} href={tabHref(t)} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.95rem] font-semibold ${active ? "bg-sage-soft text-forest" : "text-ink hover:bg-sand-soft"}`}>
                <t.Icon size={20} />
                <span className="flex-1">{t.label}</span>
                {t.label === "Review" && <Badge n={badge} />}
              </Link>
            );
          })}
        </nav>

        {kids.length > 0 && (
          <div className="mt-8 border-t border-sand pt-5">
            <p className="px-3 pb-2 text-sm font-semibold text-muted">Children</p>
            <ul className="space-y-1">
              {kids.map((k) => (
                <li key={k.id}>
                  <Link href={kidHref(k.id)} aria-current={k.id === activeKid ? "true" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 font-semibold ${k.id === activeKid ? "bg-sage-soft text-forest" : "text-ink hover:bg-sand-soft"}`}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-xl ring-1 ring-sand" aria-hidden>{k.avatar}</span>
                    <span className="flex-1 truncate">{k.name}</span>
                    <Badge n={k.pending} />
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/parent/kids#add" className="flex items-center gap-3 rounded-xl px-3 py-2 font-semibold text-muted hover:bg-sand-soft hover:text-forest">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-sand"><IconPlus size={16} /></span>
                  Add a child
                </Link>
              </li>
            </ul>
          </div>
        )}

        <div className="mt-auto space-y-1 border-t border-sand pt-4">
          <Link href="/watch" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-forest hover:bg-sand-soft">
            <IconTv size={20} /> Open the kid screen
          </Link>
          <Link href="/parent/account" aria-current={isAccount(pathname) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isAccount(pathname) ? "bg-sage-soft text-forest" : "text-ink hover:bg-sand-soft"}`}>
            <IconAccount size={20} /> Account
          </Link>
        </div>
      </aside>
      </div>

      {/* ---- top bar (phone + tablet) ---- */}
      <header className="sticky top-0 z-30 border-b border-sand/70 bg-ivory/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/parent" className="inline-flex shrink-0 rounded-md" aria-label="Brightframe home"><Logo height={26} /></Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
            {TABS.map((t) => {
              const active = t.match(pathname);
              return (
                <Link key={t.href} href={tabHref(t)} aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold ${active ? "bg-forest text-ivory" : "text-muted hover:text-forest"}`}>
                  {t.label}{t.label === "Review" && <Badge n={badge} />}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <Link href="/watch" aria-label="Open the kid screen" className="inline-flex h-11 items-center gap-1.5 rounded-full px-2.5 text-sm font-bold text-forest hover:bg-sand-soft">
              <IconTv size={20} /><span className="hidden sm:inline md:hidden">Kid screen</span>
            </Link>
            <AccountMenu active={isAccount(pathname)} />
          </div>
        </div>
      </header>

      {/* ---- bottom tabs (phone) ---- */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-sand bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link key={t.href} href={tabHref(t)} aria-current={active ? "page" : undefined}
              className={`relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[11px] font-bold ${active ? "text-forest" : "text-muted"}`}>
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-forest" aria-hidden />}
              <t.Icon size={22} />
              <span className="truncate">{t.label}</span>
              {t.label === "Review" && <Badge n={badge} className="absolute right-[calc(50%-1.6rem)] top-1" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

const ACCOUNT_LINKS = [
  { href: "/parent/account", label: "Account", sub: "Notifications, sign out" },
  { href: "/parent/devices", label: "Screens", sub: "TVs and tablets" },
  { href: "/parent/billing", label: "Plan", sub: "Subscription and billing" },
];

/** Phone and tablet: Account lives behind the profile button in the top bar. */
function AccountMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${active || open ? "bg-sage-soft text-forest" : "text-forest hover:bg-sand-soft"}`}>
        <IconUser size={22} /><span className="sr-only">Account</span>
      </button>
      {open && (
        <div id="account-menu" role="menu" className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-[var(--radius-card)] border border-sand bg-surface py-1 shadow-[var(--shadow-raised)]">
          {ACCOUNT_LINKS.map((l) => (
            <Link key={l.href} href={l.href} role="menuitem" onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-sand-soft">
              <span className="block text-sm font-bold text-forest">{l.label}</span>
              <span className="block text-xs text-muted">{l.sub}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
