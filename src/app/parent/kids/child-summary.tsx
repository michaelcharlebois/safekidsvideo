import Link from "next/link";
import type { ReactNode } from "react";
import { CONCERN_LABELS, FORMAT_LABELS, type FamilySettings, type Profile } from "@/lib/types";
import { MODE_UI, whenSentence } from "@/lib/modes";
import { Meter } from "@/components/ui";
import { IconClock, IconHand, IconPlayCircle, IconTv } from "@/components/icons";

export type ChildFacts = {
  profile: Profile;
  settings: FamilySettings;
  ready: number;
  /** Pending requests this child made (not historical records). */
  pending: number;
  usedToday: number;
  limitToday?: number;
  screens?: { name: string; personal: boolean }[];
};

/**
 * The three questions a parent asks about a child — what can they watch, when, and how do they ask for
 * something else — answered from the child's real settings. Used on the Kids overview and the child page.
 * `link(section)` makes each answer a door into the section that changes it.
 */
export function ChildSummary({ f, link, flush = false }: { f: ChildFacts; link?: (section: string) => string; flush?: boolean }) {
  const { profile: p, settings: s } = f;
  const mode = MODE_UI[s.mode];
  const held = [
    ...s.blockedTags.map((t) => CONCERN_LABELS[t]),
    ...s.blockedFormats.map((x) => FORMAT_LABELS[x].replace(/ \(.*\)$/, "")),
  ];
  return (
    <dl className={`grid gap-px overflow-hidden bg-sand sm:grid-cols-2 xl:grid-cols-4 ${flush ? "" : "rounded-[var(--radius-card)] border border-sand"}`}>
      <Answer icon={<IconPlayCircle size={18} />} q={`What can ${p.name} watch?`} href={link?.("viewing")}>
        <p className="font-bold text-forest">{mode.title} <span className="font-semibold text-muted">({mode.tagline})</span></p>
        <p>{f.ready} video{f.ready === 1 ? "" : "s"} ready in your library.</p>
        <p className="text-muted">{held.length ? `Holds back ${held.slice(0, 3).join(", ").toLowerCase()}${held.length > 3 ? ` and ${held.length - 3} more` : ""}.` : "No content held back beyond the AI review."}{s.kidAge ? ` Age ${s.kidAge}.` : " Age not set."}</p>
      </Answer>
      <Answer icon={<IconClock size={18} />} q="When?" href={link?.("time")}>
        <p className="font-bold text-forest">{whenSentence(s)}</p>
        <p className="text-muted">{f.usedToday} min watched today{f.limitToday ? ` of ${f.limitToday}` : ""}.</p>
        {f.limitToday ? <div className="mt-1.5"><Meter value={f.usedToday} max={f.limitToday} label={`${f.usedToday} of ${f.limitToday} minutes today`} /></div> : null}
      </Answer>
      <Answer icon={<IconHand size={18} />} q="Asking for more" href={link?.("viewing")}>
        <p>{mode.ask(p.name)}</p>
        {f.pending > 0 && <p className="font-bold text-apricot-ink">{p.name} asked for {f.pending === 1 ? "a video" : `${f.pending} videos`}. Waiting in Review.</p>}
      </Answer>
      <Answer icon={<IconTv size={18} />} q="Where" href={link?.("screens")}>
        {f.screens === undefined ? (
          <p className="text-muted">In local mode, this browser is the kid screen.</p>
        ) : f.screens.length === 0 ? (
          <p className="text-muted">No screens connected yet.</p>
        ) : (
          <ul>{f.screens.map((x) => <li key={x.name}>{x.name} <span className="text-muted">{x.personal ? `(${p.name}'s own)` : "(shared, PIN to switch)"}</span></li>)}</ul>
        )}
      </Answer>
    </dl>
  );
}

function Answer({ icon, q, href, children }: { icon: ReactNode; q: string; href?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col bg-surface p-4">
      <dt className="flex items-center gap-1.5 text-sm font-bold text-muted"><span className="text-forest">{icon}</span>{q}</dt>
      <dd className="mt-1.5 flex-1 space-y-0.5 text-sm text-ink">{children}</dd>
      {href && <dd className="mt-2"><Link href={href} className="text-sm font-bold text-forest underline decoration-sand underline-offset-4 hover:decoration-forest">Change</Link></dd>}
    </div>
  );
}
