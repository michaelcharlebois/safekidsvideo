import { TvTopBar } from "../chrome";
import { KidCard } from "./kid-card";
import { TvFocus } from "./focus-first";
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
      <TvFocus />
      <TvTopBar child={child} canSearch={view.canSearch} canSwitch={view.canSwitch} active="home" minutesLeft={view.minutesLeft} exitTarget={view.exitTarget} startOn={view.canSearch ? "search" : "home"} />

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
              <h2 className="text-[2vw] font-extrabold">Waiting for a grown-up <span className="text-[var(--kmuted)]">({waiting.length})</span></h2>
              <p className="text-[1.3vw] font-semibold text-[var(--kmuted)]">You asked for these. They&apos;ll show up above if a grown-up says yes.</p>
              <ul className="shelf" data-nav-row>{waiting.map((v) => <KidCard key={v.id} v={v} size="tv" waiting />)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
