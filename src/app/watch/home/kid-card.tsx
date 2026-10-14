import Link from "next/link";
import { VideoThumb } from "@/components/video-thumb";
import { fmtDuration, type KidVideo } from "./view";

/**
 * One video on a kid Home. The card only links to the player, which checks authorization again.
 * Sizes: tv (10-foot, D-pad focus via .tile:focus-within), grid (tablet), row (phone).
 * `waiting` cards aren't links: the child asked and a grown-up hasn't answered.
 */
export function KidCard({ v, size, waiting = false, more = false }: { v: KidVideo; size: "tv" | "grid" | "row"; waiting?: boolean; more?: boolean }) {
  const thumb = (
    <span className="relative block overflow-hidden rounded-[inherit]">
      <VideoThumb dark src={v.thumb} width={640} height={360} draggable={false} className={`aspect-video w-full object-cover ${waiting ? "opacity-60" : ""}`} />
      {v.durationSeconds && !waiting ? <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white dur">{fmtDuration(v.durationSeconds)}</span> : null}
      {waiting && <span className="absolute left-2 top-2 rounded-full bg-[var(--kfocus)] px-2.5 py-1 text-xs font-extrabold text-[#2a1206]">Waiting for a grown-up</span>}
    </span>
  );
  if (size === "row") {
    const inner = (
      <span className="flex items-center gap-3 p-2">
        <span className="w-[44%] shrink-0 overflow-hidden rounded-xl">{thumb}</span>
        <span className="min-w-0 text-[1.0625rem] font-bold leading-snug text-[var(--kink)] line-clamp-3">{v.title}</span>
      </span>
    );
    return <li className="tile overflow-hidden" data-more={more ? "" : undefined}>{waiting ? <div aria-label={`${v.title}, waiting for a grown-up`}>{inner}</div> : <Link href={`/watch/${v.id}`} draggable={false} className="block">{inner}</Link>}</li>;
  }
  const title = size === "tv"
    ? <p className="tv-title px-[1vw] py-[0.8vw] text-[1.25vw] font-bold leading-snug text-[var(--kmuted)] line-clamp-2">{v.title}</p>
    : <p className="px-3 py-2.5 text-[1.0625rem] font-bold leading-snug text-[var(--kink)] line-clamp-2">{v.title}</p>;
  const body = <>{thumb}{title}</>;
  return (
    <li className="tile overflow-hidden">
      {waiting ? <div aria-label={`${v.title}, waiting for a grown-up`}>{body}</div> : <Link href={`/watch/${v.id}`} draggable={false} className="block outline-none">{body}</Link>}
    </li>
  );
}
