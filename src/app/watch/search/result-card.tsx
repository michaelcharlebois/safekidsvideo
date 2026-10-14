import Link from "next/link";
import { VideoThumb } from "@/components/video-thumb";
import { copyFor } from "@/lib/kid-search";
import { fmtDuration } from "../home/view";
import { ResultAction } from "./result-action";
import type { SearchResult } from "./view";

/**
 * One search result. Only a "play" result links anywhere (to the player, which authorizes again); every
 * other state says what happens next in a child's words. Declined and blocked results have no action: on
 * TV they're an inert, focusable button so the remote can still read them.
 */
export function ResultCard({ r, size }: { r: SearchResult; size: "tv" | "grid" | "row" }) {
  const c = copyFor(r.state);
  const plays = r.state.kind === "play";
  const tv = size === "tv";
  const badgeTone = plays ? "bg-[var(--kfocus)] text-[#2a1206]" : r.state.kind === "waiting" ? "bg-[#f5d77a] text-[#2a1206]" : "bg-[rgb(8_34_25/0.85)] text-[var(--kink)] ring-1 ring-[rgb(255_249_241/0.25)]";
  const badge = <span className={`absolute left-2 top-2 rounded-full font-extrabold ${tv ? "px-[0.8vw] py-[0.3vw] text-[1vw]" : "px-2.5 py-1 text-xs"} ${badgeTone}`}>{plays ? "▶ Ready" : c.badge}</span>;
  const thumb = (
    <span className="relative block overflow-hidden rounded-[inherit]">
      <VideoThumb dark src={r.thumb} width={640} height={360} draggable={false} className={`aspect-video w-full object-cover ${plays ? "" : "opacity-60"}`} />
      {r.durationSeconds && plays ? <span className="dur absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">{fmtDuration(r.durationSeconds)}</span> : null}
      {badge}
    </span>
  );
  const note = r.checking ? "Brightframe is watching it first…" : c.note;
  const text = tv
    ? <span className="block px-[1vw] pb-[0.4vw] pt-[0.8vw]"><span className="tv-title block text-[1.25vw] font-bold leading-snug text-[var(--kmuted)] line-clamp-2">{r.title}</span><span className="mt-[0.3vw] block text-[1.05vw] font-semibold text-[var(--kmuted)]">{plays ? r.channel : note}</span></span>
    : <span className="block px-3 pb-1 pt-2.5"><span className="block text-[1.0625rem] font-bold leading-snug text-[var(--kink)] line-clamp-2">{r.title}</span><span className="mt-0.5 block text-sm font-semibold text-[var(--kmuted)]">{plays ? r.channel : note}</span></span>;
  const label = `${r.title}. ${plays ? "Ready to watch." : `${c.badge}. ${note}`}`;

  // Ask/check and its aftermath (sent, waiting, checking) share one slot, so the control — and the remote's
  // focus — survives the change from "Ask a grown-up" to "Sent to a grown-up!" to "Waiting for a grown-up".
  const settled = r.state.kind === "waiting" ? "waiting" as const : r.checking ? "checking" as const : undefined;
  const action = plays || (!c.action && !settled) ? null
    : <div className={tv ? "px-[1vw] pb-[1vw]" : "px-3 pb-3"}><ResultAction videoId={r.id} label={c.action} settled={settled} tv={tv} /></div>;

  if (plays) {
    const inner = size === "row" ? <span className="flex items-center gap-3 p-2"><span className="w-[44%] shrink-0 overflow-hidden rounded-xl">{thumb}</span><span className="min-w-0">{text}</span></span> : <>{thumb}{text}</>;
    return <li className="tile overflow-hidden" data-result={r.id}><Link href={`/watch/${r.id}?from=search`} aria-label={label} draggable={false} className="block outline-none">{inner}</Link></li>;
  }
  // Not playable: the picture and words aren't a link. On TV, whatever can be focused is the one button.
  const body = size === "row"
    ? <span className="flex items-center gap-3 p-2"><span className="w-[44%] shrink-0 overflow-hidden rounded-xl">{thumb}</span><span className="min-w-0">{text}</span></span>
    : <>{thumb}{text}</>;
  return (
    <li className="tile overflow-hidden" data-result={r.id}>
      {tv && !action
        ? <button type="button" aria-disabled="true" aria-label={label} className="block w-full cursor-default text-left outline-none">{body}</button>
        : <div aria-label={action ? undefined : label}>{body}</div>}
      {action}
    </li>
  );
}
