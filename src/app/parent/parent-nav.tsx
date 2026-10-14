"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { Logo } from "@/components/logo";
import { IconAccount, IconHome, IconKids, IconPlus, IconReview, IconTv } from "@/components/icons";

type Tab = { href: string; label: string; Icon: ComponentType<{ size?: number }>; match: (p: string) => boolean };
const TABS: Tab[] = [
  { href: "/parent", label: "Home", Icon: IconHome, match: (p) => p === "/parent" || p.startsWith("/parent/video") || p.startsWith("/parent/channel") || p.startsWith("/parent/library") }, // Library gets its own tab after the navigation review
  { href: "/parent/review", label: "Review", Icon: IconReview, match: (p) => p.startsWith("/parent/review") },
  { href: "/parent/kids", label: "Kids", Icon: IconKids, match: (p) => p.startsWith("/parent/kids") || p.startsWith("/parent/settings") || p.startsWith("/parent/checkin") || p.startsWith("/parent/insights") || p.startsWith("/parent/stats") },
  { href: "/parent/account", label: "Account", Icon: IconAccount, match: (p) => p.startsWith("/parent/account") || p.startsWith("/parent/devices") || p.startsWith("/parent/billing") || p.startsWith("/parent/reviewer") },
];

/** Pages that are "about one child" (take ?kid=); switching child keeps you on them. Elsewhere it goes Home. */
const PER_CHILD = ["/parent", "/parent/library", "/parent/review", "/parent/settings", "/parent/stats", "/parent/insights", "/parent/checkin"];

export type NavKid = { id: string; name: string; avatar: string; pending: number };

/**
 * The parent shell's navigation, one component, three layouts:
 *  - ≥1024px: a left sidebar (logo, destinations, children, kid screen)
 *  - 768–1023px: a top bar with the destinations inline
 *  - <768px: a compact top bar + bottom tab bar (thumb reach)
 * `badge` = things waiting in Review. Destinations are the app's real ones; nothing here is decorative.
 */
export function ParentNav({ badge = 0, kids, defaultKidId }: { badge?: number; kids: NavKid[]; defaultKidId?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  // The Review inbox shows every child unless filtered, so no child is "selected" there by default.
  const activeKid = (sp.get("kid") && kids.some((k) => k.id === sp.get("kid")) ? sp.get("kid") : null) ?? (pathname === "/parent/review" ? null : defaultKidId ?? kids[0]?.id);
  const kidHref = (id: string) => `${PER_CHILD.includes(pathname) ? pathname : "/parent"}?kid=${id}`;
  const tabHref = (t: Tab) => (activeKid && t.href === "/parent" ? `${t.href}?kid=${activeKid}` : t.href);
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
                <Link href="/parent/kids" className="flex items-center gap-3 rounded-xl px-3 py-2 font-semibold text-muted hover:bg-sand-soft hover:text-forest">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-sand"><IconPlus size={16} /></span>
                  Add a child
                </Link>
              </li>
            </ul>
          </div>
        )}

        <Link href="/watch" className="mt-auto flex items-center gap-3 rounded-xl border border-sand px-3 py-2.5 text-sm font-bold text-forest hover:bg-sand-soft">
          <IconTv size={20} /> Open the kid screen
        </Link>
      </aside>
      </div>

      {/* ---- top bar (phone + tablet) ---- */}
      <header className="sticky top-0 z-20 border-b border-sand/70 bg-ivory/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/parent" className="inline-flex rounded-md" aria-label="Brightframe home"><Logo height={26} /></Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => {
              const active = t.match(pathname);
              return (
                <Link key={t.href} href={tabHref(t)} aria-current={active ? "page" : undefined}
                  className={`relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${active ? "bg-forest text-ivory" : "text-muted hover:text-forest"}`}>
                  {t.label}{t.label === "Review" && <Badge n={badge} />}
                </Link>
              );
            })}
          </nav>
          <Link href="/watch" className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-bold text-forest hover:bg-sand-soft">
            <IconTv size={18} /><span className="hidden sm:inline">Kid screen</span>
          </Link>
        </div>
      </header>

      {/* ---- bottom tabs (phone) ---- */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-sand bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link key={t.href} href={tabHref(t)} aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-bold ${active ? "text-forest" : "text-muted"}`}>
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-forest" aria-hidden />}
              <t.Icon size={22} />
              <span>{t.label}</span>
              {t.label === "Review" && <Badge n={badge} className="absolute right-[calc(50%-1.75rem)] top-1" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
