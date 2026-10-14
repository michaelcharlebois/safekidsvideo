import type { ReactNode } from "react";
import { CONCERN_LABELS, FORMAT_LABELS, type ConcernFinding, type ContentCard, type VideoWithCard } from "@/lib/types";
import { STATUS_LABEL, type PlayStatus } from "@/lib/status";
import { IconAlert, IconBan, IconChannels, IconClock, IconEyeOff, IconPlayCircle, IconShield } from "@/components/icons";
import { foundConcerns } from "@/lib/gate";

/*
 * Brightframe primitives. Colours, radii and elevation come from the tokens in globals.css; pages compose
 * these rather than restyling. Controls are pills, cards are 18px, panels 24px; only one thing per screen
 * gets the raised shadow (the decision a parent needs to make).
 */

export function Card({ children, className = "", raised = false, as: Tag = "div" }: { children: ReactNode; className?: string; raised?: boolean; as?: "div" | "section" | "article" | "li" }) {
  return <Tag className={`rounded-[var(--radius-card)] border border-sand bg-surface ${raised ? "shadow-[var(--shadow-raised)]" : ""} ${className}`}>{children}</Tag>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "warm" | "danger" | "quiet";
const BUTTON_BASE = "inline-flex items-center justify-center gap-2 rounded-full font-bold transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-45";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-forest text-ivory hover:bg-forest-700",
  secondary: "border border-forest/25 bg-surface text-forest hover:border-forest/50 hover:bg-sage-soft",
  ghost: "border border-sand bg-transparent text-ink hover:bg-sand-soft", // kept for existing pages
  warm: "bg-apricot text-forest hover:brightness-95",
  danger: "border border-bad/30 bg-bad-soft text-bad hover:border-bad/60",
  quiet: "text-muted hover:text-forest",
};
const BUTTON_SIZE = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-3 text-[0.95rem]" } as const;

/** Class string for links styled as buttons (same look as <Button>). */
export const buttonClass = (variant: ButtonVariant = "primary", size: keyof typeof BUTTON_SIZE = "md", extra = "") =>
  `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${extra}`;

export function Button({
  children, variant = "primary", size = "md", className = "", ...rest
}: { children: ReactNode; variant?: ButtonVariant; size?: keyof typeof BUTTON_SIZE; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonClass(variant, size, className)} {...rest}>{children}</button>;
}

/** Status badge: colour AND icon AND words, so it never relies on colour alone. */
export function StatusBadge({ status, children, className = "" }: { status: PlayStatus; children?: ReactNode; className?: string }) {
  const tone = {
    plays: ["bg-ok-soft text-ok", IconPlayCircle],
    allowed: ["bg-sage-soft text-forest", IconShield],
    reviewing: ["bg-pending-soft text-pending", IconClock],
    uncertain: ["bg-warn-soft text-warn", IconAlert],
    held: ["bg-warn-soft text-warn", IconAlert],
    hidden: ["bg-sand-soft text-muted", IconEyeOff],
    blocked: ["bg-bad-soft text-bad", IconBan],
    outside: ["bg-sand-soft text-muted", IconChannels],
  } as const;
  const [cls, Icon] = tone[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${cls} ${className}`}>
      <Icon size={14} />{children ?? STATUS_LABEL[status]}
    </span>
  );
}

/** A neutral tag (format, age range, pace…) — information, not a verdict. */
export function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border border-sand bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted ${className}`}>{children}</span>;
}

/** Section heading with an optional action on the right ("See all"). */
export function SectionHeader({ title, sub, action, icon, id }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; icon?: ReactNode; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest">{icon}</span>}
        <div className="min-w-0">
          <h2 id={id} className="text-lg leading-tight">{title}</h2>
          {sub && <p className="text-sm text-muted">{sub}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 text-sm font-bold">{action}</div>}
    </div>
  );
}

/** Empty states: say what's missing and what to do next. */
export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {icon && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-soft text-forest">{icon}</span>}
      <p className="font-bold text-forest">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

/** Inline notice for errors / warnings / confirmations. */
export function Notice({ tone = "info", children, className = "" }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode; className?: string }) {
  const t = { info: "border-sand bg-sand-soft text-ink", warn: "border-warn/30 bg-warn-soft text-ink", bad: "border-bad/30 bg-bad-soft text-bad", ok: "border-ok/30 bg-ok-soft text-ok" }[tone];
  return <div role={tone === "bad" ? "alert" : "status"} className={`rounded-[var(--radius-card)] border px-4 py-3 text-sm ${t} ${className}`}>{children}</div>;
}

/** A thin progress meter with a text equivalent. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-2.5 w-full overflow-hidden rounded-full bg-sand-soft">
      <div className={`h-full rounded-full ${pct >= 100 ? "bg-warn" : "bg-forest"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span aria-label={`${value} out of 5`} className="text-warn tracking-tight">
      {"★".repeat(Math.round(value))}
      <span className="text-line">{"★".repeat(5 - Math.round(value))}</span>
    </span>
  );
}

const paceStyle = { calm: "bg-ok-soft text-ok", moderate: "bg-warn-soft text-warn", frenetic: "bg-bad-soft text-bad" } as const;

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${className}`}>{children}</span>;
}

export function PacePill({ pace }: { pace: ContentCard["pace"] }) {
  return <Pill className={paceStyle[pace]}>{pace}</Pill>;
}

export function ConcernPill({ f, flaggedBy = 0 }: { f: ConcernFinding; flaggedBy?: number }) {
  const tone = f.intensity >= 2 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn";
  return (
    <Pill className={tone} >
      {CONCERN_LABELS[f.tag]}
      {f.timestamp ? <span className="opacity-70 font-semibold"> · {f.timestamp}</span> : null}
      {flaggedBy ? <span className="opacity-70 font-semibold"> · {flaggedBy} parent{flaggedBy > 1 ? "s" : ""}</span> : null}
    </Pill>
  );
}

/** Compact summary used in the library list. */
export function CardSummary({ v, blocked }: { v: VideoWithCard; blocked: string[] }) {
  const c = v.card;
  if (!c) return <p className="text-sm text-muted">Not reviewed yet — run the reviewer to generate a content card.</p>;
  const present = foundConcerns(c);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Stars value={c.rating} />
        <span className="text-muted">ages {c.ageFit.min}–{c.ageFit.max}</span>
        <PacePill pace={c.pace} />
        <Pill className="bg-line">{FORMAT_LABELS[c.format ?? "other"]}</Pill>
        {c.reviewer.model === "sample" && <Pill className="bg-sky">sample card</Pill>}
        {blocked.length > 0 && <Pill className="bg-bad text-white">hidden from kid mode</Pill>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {present.length ? present.map((f) => <ConcernPill key={f.tag} f={f} flaggedBy={v.confirmations.flaggedTags[f.tag]} />) : <Pill className="bg-grass">no concerns found</Pill>}
      </div>
      <p className="text-sm text-muted">
        {v.confirmations.agree + v.confirmations.flag === 0
          ? "No parent confirmations yet"
          : `${v.confirmations.agree} parent${v.confirmations.agree === 1 ? "" : "s"} agree · ${v.confirmations.flag} flagged`}
      </p>
    </div>
  );
}

/** Page title row for parent sub-pages. The app nav lives in the parent layout; this just names the page. */
export function TopBar({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 lg:px-8 flex items-center justify-between gap-3">
      <h1 className="text-title">{title}</h1>
      <div className="flex items-center gap-2 text-sm">{right}</div>
    </div>
  );
}
