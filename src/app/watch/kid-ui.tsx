import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Channel, VideoWithCard } from "@/lib/types";
import { askGrownUp } from "@/app/actions";
import { CheckButton, type Suggestion } from "./check-button";

/* Kid-mode building blocks: shelves of big tiles, remote-friendly. */

export const thumbOf = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

const AVATAR_COLORS = ["#ff7a59", "#2f9e6b", "#4f7cff", "#d98c1f", "#b35cff", "#ff4f8b"];

export function ChannelAvatar({ channel, name, size = 44 }: { channel?: Channel; name: string; size?: number }) {
  if (channel?.thumbnailUrl) {
    return <Image src={channel.thumbnailUrl} alt="" width={size} height={size} unoptimized className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <span className="inline-flex items-center justify-center rounded-full font-extrabold text-white" style={{ width: size, height: size, background: color, fontSize: size * 0.5 }}>
      {name.replace(/^@/, "").charAt(0).toUpperCase()}
    </span>
  );
}

export function Shelf({ title, avatar, children }: { title: string; avatar?: ReactNode; children: ReactNode }) {
  return (
    <section className="-mx-5">
      <h2 className="flex items-center gap-3 px-5 text-xl sm:text-2xl font-extrabold tracking-tight">
        {avatar}
        {title}
      </h2>
      <ul className="shelf">{children}</ul>
    </section>
  );
}

export function PlayTile({ v }: { v: VideoWithCard }) {
  return (
    <li className="tile">
      <Link href={`/watch/${v.id}`} className="block outline-none" draggable={false}>
        <div className="relative">
          <Image src={thumbOf(v)} alt="" width={640} height={360} unoptimized draggable={false} className="w-full aspect-video object-cover" />
          <span className="absolute left-3 bottom-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-2xl text-[#0b1020] shadow">▶</span>
        </div>
        <p className="px-3 py-2 text-sm font-bold leading-snug line-clamp-1 text-[var(--kmuted)]">{v.title}</p>
      </Link>
    </li>
  );
}

/**
 * A video the kid can't play yet. In open mode it's an invitation ("Let's check!");
 * otherwise it's a polite ask to a grown-up.
 */
export function AskTile({
  v, asked, kidCanCheck, checking, suggestions,
}: { v: VideoWithCard; asked: boolean; kidCanCheck: boolean; checking: boolean; suggestions: Suggestion[] }) {
  return (
    <li className="tile">
      <div className="relative">
        <Image src={thumbOf(v)} alt="" width={640} height={360} unoptimized draggable={false} className="w-full aspect-video object-cover opacity-80" />
        <span className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--kfocus)] text-xl font-extrabold text-[#0b1020] shadow">
          {asked ? "✓" : "?"}
        </span>
      </div>
      <div className="px-3 pt-2 pb-3">
        <p className="text-sm font-bold leading-snug line-clamp-1 text-[var(--kmuted)]">{v.title}</p>
        <div className="mt-2">
          {asked ? (
            <span className="block w-full rounded-full bg-white/10 py-2 text-center text-sm font-extrabold">Asked a grown-up!</span>
          ) : kidCanCheck ? (
            <CheckButton videoId={v.id} label="Let's check it! 🔍" suggestions={suggestions} initiallyChecking={checking} />
          ) : (
            <form action={askGrownUp}>
              <input type="hidden" name="videoId" value={v.id} />
              <button type="submit" className="bigbtn w-full rounded-full bg-[var(--kfocus)] py-2 text-sm font-extrabold text-[#0b1020] active:scale-95">Ask a grown-up 🙋</button>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
