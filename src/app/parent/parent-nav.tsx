"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/parent", label: "Home", icon: "⌂", match: (p: string) => p === "/parent" || p.startsWith("/parent/video") || p.startsWith("/parent/channel") },
  { href: "/parent/review", label: "Review", icon: "✓", match: (p: string) => p.startsWith("/parent/review") },
  { href: "/parent/kids", label: "Kids", icon: "☺", match: (p: string) => p.startsWith("/parent/kids") || p.startsWith("/parent/settings") || p.startsWith("/parent/checkin") || p.startsWith("/parent/insights") },
  { href: "/parent/account", label: "Account", icon: "⚙", match: (p: string) => p.startsWith("/parent/account") || p.startsWith("/parent/devices") || p.startsWith("/parent/billing") || p.startsWith("/parent/reviewer") },
];

/** Four destinations. Bottom tabs on a phone, a header row on wider screens. `badge` = things waiting in Review. */
export function ParentNav({ badge = 0, kidAvatar }: { badge?: number; kidAvatar?: string }) {
  const pathname = usePathname();
  const items = TABS.map((t) => ({ ...t, active: t.match(pathname) }));
  const Tab = ({ t, mobile }: { t: (typeof items)[number]; mobile?: boolean }) => (
    <Link
      href={t.href}
      aria-current={t.active ? "page" : undefined}
      className={mobile
        ? `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${t.active ? "text-ink" : "text-muted"}`
        : `relative rounded-full px-3 py-1.5 text-sm font-bold ${t.active ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}
    >
      {mobile && <span className={`text-xl leading-none ${t.active ? "" : "opacity-70"}`}>{t.label === "Kids" && kidAvatar ? kidAvatar : t.icon}</span>}
      <span>{t.label}</span>
      {t.label === "Review" && badge > 0 && (
        <span className={`absolute ${mobile ? "right-[calc(50%-1.6rem)] top-1" : "-right-1 -top-1"} min-w-5 rounded-full bg-sun px-1.5 text-center text-[11px] font-extrabold text-ink`}>{badge}</span>
      )}
    </Link>
  );
  return (
    <>
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/parent" className="text-xl font-extrabold tracking-tight">Sift</Link>
          <nav className="hidden items-center gap-1 md:flex">{items.map((t) => <Tab key={t.href} t={t} />)}</nav>
          <Link href="/watch" className="text-sm font-bold text-muted hover:text-ink">Kid screen →</Link>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {items.map((t) => <Tab key={t.href} t={t} mobile />)}
      </nav>
    </>
  );
}
