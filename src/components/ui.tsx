import type { ReactNode } from "react";
import { CONCERN_LABELS, FORMAT_LABELS, type ConcernFinding, type ContentCard, type VideoWithCard } from "@/lib/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-surface border border-line shadow-[0_1px_0_rgba(0,0,0,0.03)] ${className}`}>{children}</div>;
}

export function Button({
  children, variant = "primary", className = "", ...rest
}: { children: ReactNode; variant?: "primary" | "ghost" | "danger"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 font-bold text-sm transition active:scale-[0.98] disabled:opacity-50";
  const v = {
    primary: "bg-ink text-bg hover:bg-ink/90",
    ghost: "bg-transparent border border-line text-ink hover:bg-bg",
    danger: "bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20",
  }[variant];
  return (
    <button className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
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

const paceStyle = { calm: "bg-grass", moderate: "bg-sun", frenetic: "bg-accent/20" } as const;

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${className}`}>{children}</span>;
}

export function PacePill({ pace }: { pace: ContentCard["pace"] }) {
  return <Pill className={paceStyle[pace]}>{pace}</Pill>;
}

export function ConcernPill({ f, flaggedBy = 0 }: { f: ConcernFinding; flaggedBy?: number }) {
  const tone = f.intensity >= 2 ? "bg-bad/10 text-bad" : "bg-warn/15 text-warn";
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
  const present = c.concerns.filter((x) => x.present);
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
    <div className="mx-auto w-full max-w-5xl px-4 pt-5 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2 text-sm">{right}</div>
    </div>
  );
}
