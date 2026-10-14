import { IconSearch } from "@/components/icons";
import { PhoneTabs, PhoneTopBar, TabletTopBar, TvTopBar } from "../chrome";
import { KidCard } from "../home/kid-card";
import { ShowMore } from "../home/show-more";
import { ResultCard } from "./result-card";
import { SearchFocus } from "./search-focus";
import { TvKeyboard } from "./tv-keyboard";
import { modeLine, type SearchView } from "./view";

function Status({ view, tv = false }: { view: SearchView; tv?: boolean }) {
  const p = tv ? "text-[1.6vw]" : "text-base";
  if (view.source === "none") return <p className={`${p} font-semibold text-[var(--kmuted)]`}>Search isn&apos;t set up yet. Ask a grown-up.</p>;
  if (!view.q) return null;
  if (view.results.length === 0) return <p className={`${p} font-bold`}>Nothing found for &ldquo;{view.q}&rdquo;. Try different words!</p>;
  return null;
}
const Practice = ({ view, tv = false }: { view: SearchView; tv?: boolean }) => view.source === "catalogue"
  ? <p className={`${tv ? "text-[1.1vw]" : "text-xs"} font-semibold text-[var(--kmuted)]`}>Practice search: showing videos already in Brightframe (no YouTube search on this computer).</p>
  : null;
const anyChecking = (v: SearchView) => v.results.some((r) => r.checking);

/** TV: a remote-operated keyboard (no text field, so no TV pop-up keyboard), results as one shelf above it. */
export function TvSearch({ view }: { view: SearchView }) {
  const results = view.results.length > 0;
  return (
    <div className="kid-bf tv flex-1 px-[5vw] pb-[6vh] pt-[4vh]" data-typing>
      <SearchFocus q={view.q} />
      <TvTopBar child={view.child} canSearch canSwitch={view.canSwitch} active="search" minutesLeft={view.minutesLeft} exitTarget={view.exitTarget} />
      <p className="mt-[2vh] text-[1.4vw] font-semibold text-[var(--kmuted)]">{modeLine(view.mode)}</p>
      {results && (
        <section aria-label={`Results for ${view.q}`} className="mt-[2vh]">
          <h2 className="text-[2vw] font-extrabold">Results for &ldquo;{view.q}&rdquo;</h2>
          <Practice view={view} tv />
          <ul className="shelf" data-nav-row>{view.results.map((r) => <ResultCard key={r.id} r={r} size="tv" />)}</ul>
        </section>
      )}
      {anyChecking(view) && view.ready.length > 0 && (
        <section aria-label="Ready while you wait" className="mt-[1vh]">
          <h2 className="text-[1.6vw] font-extrabold">While you wait, these are ready</h2>
          <ul className="shelf" data-nav-row>{view.ready.map((v) => <KidCard key={v.id} v={v} size="tv" />)}</ul>
        </section>
      )}
      <section aria-label="Type to search" className="mt-[2vh] max-w-[60vw]">
        {results && <h2 className="mb-[1vh] text-[1.6vw] font-extrabold">Search again</h2>}
        <div className="mb-[1vh]"><Status view={view} tv /></div>
        {view.source !== "none" && <TvKeyboard initial={view.q} />}
      </section>
    </div>
  );
}

/** Touch search box: a normal field, so the device's own keyboard appears; Search on that keyboard submits. */
function SearchBox({ q, big }: { q: string; big?: boolean }) {
  return (
    <form action="/watch/search" role="search" className="flex gap-2">
      <label className="relative flex-1">
        <span className="sr-only">Search for a video</span>
        <IconSearch size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--kmuted)]" />
        <input
          name="q" type="search" defaultValue={q} placeholder="What do you want to watch?" autoFocus={!q}
          autoComplete="off" autoCorrect="off" enterKeyHint="search" maxLength={80}
          className={`w-full rounded-full bg-[rgb(255_249_241/0.1)] pl-12 pr-4 font-bold text-[var(--kink)] placeholder:text-[var(--kmuted)] outline-none focus:ring-4 focus:ring-[var(--kfocus)] ${big ? "h-14 text-xl" : "h-12 text-lg"}`}
        />
      </label>
      <button type="submit" className={`rounded-full bg-[var(--kfocus)] px-5 font-extrabold text-[#2a1206] ${big ? "h-14 text-lg" : "h-12"}`}>Search</button>
    </form>
  );
}

export function TabletSearch({ view }: { view: SearchView }) {
  return (
    <div className="kid-bf touch flex-1 px-6 pb-12 pt-5 lg:px-10">
      <TabletTopBar child={view.child} canSearch canSwitch={view.canSwitch} active="search" exitTarget={view.exitTarget} title="Search" />
      <div className="mx-auto mt-6 max-w-3xl space-y-3">
        <SearchBox q={view.q} big />
        <p className="text-center text-sm font-semibold text-[var(--kmuted)]">{modeLine(view.mode)}</p>
      </div>
      <div className="mt-6 space-y-4">
        <Status view={view} />
        {view.results.length > 0 && (
          <section aria-label={`Results for ${view.q}`}>
            <h2 className="text-xl font-extrabold">Results for &ldquo;{view.q}&rdquo;</h2>
            <Practice view={view} />
            <ul className="mt-3 grid grid-cols-3 gap-4 lg:grid-cols-4">{view.results.map((r) => <ResultCard key={r.id} r={r} size="grid" />)}</ul>
          </section>
        )}
        {anyChecking(view) && view.ready.length > 0 && (
          <section aria-label="Ready while you wait">
            <h2 className="text-lg font-extrabold">While you wait, these are ready</h2>
            <ul className="mt-3 grid grid-cols-3 gap-4 lg:grid-cols-4">{view.ready.map((v) => <KidCard key={v.id} v={v} size="grid" />)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

const PHONE_RESULTS = 6;
export function PhoneSearch({ view }: { view: SearchView }) {
  return (
    <div className="kid-bf touch flex flex-1 flex-col pb-24">
      <PhoneTopBar child={view.child} canSwitch={view.canSwitch} exitTarget={view.exitTarget} title="Search" />
      <div className="space-y-2 px-4">
        <SearchBox q={view.q} />
        <p className="text-sm font-semibold text-[var(--kmuted)]">{modeLine(view.mode)}</p>
      </div>
      <div className="mt-4 space-y-3 px-4">
        <Status view={view} />
        {view.results.length > 0 && (
          <section aria-label={`Results for ${view.q}`}>
            <h2 className="text-lg font-extrabold">Results for &ldquo;{view.q}&rdquo; <span className="text-[var(--kmuted)]">({view.results.length})</span></h2>
            <Practice view={view} />
            <ShowMore limit={PHONE_RESULTS} label="results" className="mt-2 space-y-3">{view.results.map((r) => <ResultCard key={r.id} r={r} size="row" />)}</ShowMore>
          </section>
        )}
        {anyChecking(view) && view.ready.length > 0 && (
          <section aria-label="Ready while you wait">
            <h2 className="text-lg font-extrabold">While you wait, these are ready</h2>
            <ul className="mt-2 space-y-3">{view.ready.map((v) => <KidCard key={v.id} v={v} size="row" />)}</ul>
          </section>
        )}
      </div>
      <PhoneTabs canSearch active="search" />
    </div>
  );
}
