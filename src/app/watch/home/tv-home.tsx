import Link from "next/link";
import { BrandMark } from "@/components/logo";
import { IconSearch } from "@/components/icons";
import { ExitButton } from "../exit-button";
import { KidCard } from "./kid-card";
import { FocusFirst } from "./focus-first";
import type { KidHomeView } from "./view";

/**
 * TV Home: remote-first, 10-foot. One focus row for the header, one per shelf (data-nav-row), so the
 * shared RemoteNav moves left/right within a row and up/down between rows; OK opens; Return goes Home
 * (and on Home leaves the TV app). Sizes are in vw so they hold from 1280 to 3840 wide; 5%/4% safe areas.
 */
export function TvHome({ view }: { view: KidHomeView }) {
  const { child, shelves, waiting } = view;
  return (
    <div className="kid-bf tv flex-1 px-[5vw] pb-[6vh] pt-[4vh]">
      <FocusFirst />
      <header data-nav-row className="flex items-center gap-[1.2vw]">
        <BrandMark tone="dark" size={0} className="h-[3.2vw] w-auto" />
        <Link href="/watch" aria-current="page" className="bigbtn ml-[1vw] rounded-full bg-[rgb(255_249_241/0.1)] px-[1.6vw] py-[0.8vw] text-[1.5vw] font-extrabold">Home</Link>
        {view.canSearch && (
          <Link href="/watch/search" className="bigbtn flex items-center gap-[0.6vw] rounded-full px-[1.6vw] py-[0.8vw] text-[1.5vw] font-extrabold text-[var(--kmuted)]"><IconSearch size={0} className="h-[1.5vw] w-[1.5vw]" />Search</Link>
        )}
        <div className="ml-auto flex items-center gap-[1.2vw]">
          {view.minutesLeft != null && <span className="text-[1.2vw] font-bold text-[var(--kmuted)]">{view.minutesLeft} min left today</span>}
          {view.canSwitch
            ? <Link href="/watch/who" className="bigbtn flex items-center gap-[0.6vw] rounded-full bg-[rgb(255_249_241/0.1)] py-[0.5vw] pl-[0.5vw] pr-[1.4vw] text-[1.4vw] font-extrabold"><span className="text-[2vw] leading-none" aria-hidden>{child.avatar}</span>{child.name}</Link>
            : <span className="flex items-center gap-[0.6vw] text-[1.4vw] font-extrabold"><span className="text-[2vw] leading-none" aria-hidden>{child.avatar}</span>{child.name}</span>}
          <ExitButton target={view.exitTarget} />
        </div>
      </header>

      {shelves.length === 0 && waiting.length === 0 ? (
        <div className="mt-[14vh] text-center">
          <p className="text-[3vw] font-extrabold">Nothing to watch yet</p>
          <p className="mt-[1vh] text-[1.6vw] font-semibold text-[var(--kmuted)]">{view.mode === "locked" ? "Ask a grown-up to add some videos." : "Try Search, or ask a grown-up."}</p>
        </div>
      ) : (
        <div className="mt-[3vh] space-y-[2.5vh]">
          {shelves.map((s) => (
            <section key={s.id} aria-label={s.title}>
              <h2 className="flex items-center gap-[0.8vw] text-[2vw] font-extrabold">{s.kind === "approved" && <span className="h-[1.2vw] w-[1.2vw] rounded-full bg-[var(--kfocus)]" aria-hidden />}{s.title}</h2>
              <ul className="shelf" data-nav-row>
                {s.videos.map((v) => <KidCard key={v.id} v={v} size="tv" />)}
                {s.comingSoon > 0 && <li className="tile flex aspect-video items-center justify-center p-[1vw] text-center text-[1.3vw] font-bold text-[var(--kmuted)]">{s.comingSoon} more coming soon</li>}
              </ul>
            </section>
          ))}
          {waiting.length > 0 && (
            <section aria-label="Waiting for a grown-up">
              <h2 className="text-[2vw] font-extrabold">Waiting for a grown-up</h2>
              <p className="text-[1.3vw] font-semibold text-[var(--kmuted)]">You asked for these. They&apos;ll show up above if a grown-up says yes.</p>
              <ul className="mt-[1vh] flex gap-[1.6vw] overflow-hidden">{waiting.slice(0, 4).map((v) => <KidCard key={v.id} v={v} size="tv" waiting />)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
