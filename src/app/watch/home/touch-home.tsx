import Link from "next/link";
import { IconHand } from "@/components/icons";
import { PhoneTabs, PhoneTopBar, StayingUp, TabletTopBar } from "../chrome";
import { KidCard } from "./kid-card";
import { ShowMore } from "./show-more";
import { askLine, type KidHomeView } from "./view";

const PHONE_PER_SECTION = 4;
const PHONE_WAITING = 3;
const TABLET_PER_SECTION = 8;


const Empty = ({ view }: { view: KidHomeView }) => (
  <div className="mt-16 text-center">
    <p className="text-2xl font-extrabold">Nothing to watch yet</p>
    <p className="mt-2 font-semibold text-[var(--kmuted)]">{view.mode === "locked" ? "Ask a grown-up to add some videos." : "Try Search, or ask a grown-up."}</p>
  </div>
);

/** Tablet Home: touch-first. A clear top bar, large-card grids, and one line on how to get more videos. */
export function TabletHome({ view }: { view: KidHomeView }) {
  const { shelves, waiting } = view;
  return (
    <div className="kid-bf touch flex-1 px-6 pb-12 pt-5 lg:px-10">
      <TabletTopBar child={view.child} canSearch={view.canSearch} canSwitch={view.canSwitch} active="home" exitTarget={view.exitTarget} title={`Hi, ${view.child.name}!`} />

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-[rgb(255_249_241/0.07)] px-4 py-3">
        <IconHand size={22} className="text-[var(--kfocus)]" />
        <p className="flex-1 text-base font-semibold text-[var(--kink)]">{askLine(view.mode)}</p>
        {view.canSearch && <Link href="/watch/search" className="flex h-11 items-center rounded-full bg-[var(--kfocus)] px-5 font-extrabold text-[#2a1206]">Find a video</Link>}
        {view.stayingUpUntil && <StayingUp until={view.stayingUpUntil} />}
        {view.minutesLeft != null && <span className="rounded-full bg-[rgb(255_249_241/0.1)] px-3 py-1.5 text-sm font-bold text-[var(--kmuted)]">{view.minutesLeft} min left today</span>}
      </div>

      {shelves.length === 0 && waiting.length === 0 ? <Empty view={view} /> : (
        <div className="mt-6 space-y-8">
          {shelves.map((s) => (
            <section key={s.id} aria-label={s.title}>
              <h2 className="text-xl font-extrabold">{s.title}</h2>
              <ShowMore limit={TABLET_PER_SECTION} label={s.title} className="mt-3 grid grid-cols-3 gap-4 lg:grid-cols-4">
                {s.videos.map((v) => <KidCard key={v.id} v={v} size="grid" />)}
              </ShowMore>
              {s.comingSoon > 0 && <p className="mt-2 text-sm font-semibold text-[var(--kmuted)]">{s.comingSoon} more coming soon.</p>}
            </section>
          ))}
          {waiting.length > 0 && (
            <section aria-label="Waiting for a grown-up">
              <h2 className="text-xl font-extrabold">Waiting for a grown-up <span className="text-[var(--kmuted)]">({waiting.length})</span></h2>
              <p className="text-sm font-semibold text-[var(--kmuted)]">You asked for these. If a grown-up says yes, they&apos;ll show up here to watch.</p>
              <ShowMore limit={TABLET_PER_SECTION} label="Waiting for a grown-up" className="mt-3 grid grid-cols-3 gap-4 lg:grid-cols-4">{waiting.map((v) => <KidCard key={v.id} v={v} size="grid" waiting />)}</ShowMore>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Phone Home: one column of wide cards, four per section, and a bottom tab bar within thumb reach. */
export function PhoneHome({ view }: { view: KidHomeView }) {
  const { shelves, waiting } = view;
  return (
    <div className="kid-bf touch flex flex-1 flex-col">
      <PhoneTopBar child={view.child} canSwitch={view.canSwitch} exitTarget={view.exitTarget} title={`Hi, ${view.child.name}!`} sub={[view.stayingUpUntil ? `Staying up until ${view.stayingUpUntil}` : null, view.minutesLeft != null ? `${view.minutesLeft} min left today` : null].filter(Boolean).join(" · ") || undefined} />

      <div className="flex-1 px-4 pb-24">
        {view.asking && (
          <div className="mt-2 rounded-2xl bg-[rgb(255_249_241/0.08)] p-4" role="status">
            <p className="font-extrabold">Want something new?</p>
            <p className="mt-1 text-[1.0625rem] font-semibold text-[var(--kmuted)]">{askLine(view.mode)}</p>
            <div className="mt-3 flex gap-2">
              {view.canSearch && <Link href="/watch/search" className="flex h-12 flex-1 items-center justify-center rounded-full bg-[var(--kfocus)] font-extrabold text-[#2a1206]">Find a video</Link>}
              <Link href="/watch" className="flex h-12 flex-1 items-center justify-center rounded-full bg-[rgb(255_249_241/0.1)] font-extrabold">Back to my videos</Link>
            </div>
          </div>
        )}
        {shelves.length === 0 && waiting.length === 0 ? <Empty view={view} /> : (
          <div className="mt-3 space-y-6">
            {shelves.map((s) => (
              <section key={s.id} aria-label={s.title}>
                <h2 className="text-lg font-extrabold">{s.title}</h2>
                <ShowMore limit={PHONE_PER_SECTION} label={s.title} className="mt-2 space-y-2">
                  {s.videos.map((v) => <KidCard key={v.id} v={v} size="row" />)}
                </ShowMore>
              </section>
            ))}
            {waiting.length > 0 && (
              <section aria-label="Waiting for a grown-up">
                <h2 className="text-lg font-extrabold">Waiting for a grown-up <span className="text-[var(--kmuted)]">({waiting.length})</span></h2>
                <p className="text-sm font-semibold text-[var(--kmuted)]">You asked. They&apos;ll move up to your videos if a grown-up says yes.</p>
                <ShowMore limit={PHONE_WAITING} label="Waiting for a grown-up" className="mt-2 space-y-2">{waiting.map((v) => <KidCard key={v.id} v={v} size="row" waiting />)}</ShowMore>
              </section>
            )}
          </div>
        )}
      </div>

      <PhoneTabs canSearch={view.canSearch} active={view.asking ? "ask" : "home"} />
    </div>
  );
}
