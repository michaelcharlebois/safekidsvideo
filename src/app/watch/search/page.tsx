import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { unstable_cache } from "next/cache";
import { searchKidsVideos } from "@/lib/youtube";

/** Pin a search's results for 10 minutes so polling/refreshes don't reshuffle the grid. */
const cachedSearch = unstable_cache(
  async (q: string, kidsOnly: boolean) => searchKidsVideos(q, 12, kidsOnly),
  ["kid-search"],
  { revalidate: 600 },
);
import { aiPasses, canPlay, getLibrary } from "@/lib/queries";
import { pendingCheckIds, pendingVideoIds, recentlyApprovedIds } from "@/lib/activity";
import { CheckButton, type Suggestion } from "../check-button";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background reviews of long videos run inside this request's budget

export default async function SearchPage(props: PageProps<"/watch/search">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const settings = await db.getSettings(viewer.familyId, viewer.profileId);
  if (settings.mode === "locked") redirect("/watch");

  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const [hits, lib, pending, checking, approved] = await Promise.all([
    q ? cachedSearch(q.toLowerCase().trim(), settings.kidsOnlySearch) : Promise.resolve([]),
    getLibrary(viewer.familyId),
    pendingVideoIds(viewer.familyId),
    pendingCheckIds(viewer.familyId),
    recentlyApprovedIds(viewer.familyId),
  ]);
  const byId = new Map(lib.map((v) => [v.id, v]));
  const ready = lib.filter((v) => canPlay(v, settings));
  const thumbOf = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  /** Already-cleared videos to offer while a check runs: same channel first, then anything. */
  const suggestionsFor = (channelId: string): Suggestion[] => {
    const same = ready.filter((v) => v.channelId === channelId);
    const rest = ready.filter((v) => v.channelId !== channelId);
    return [...same, ...rest].slice(0, 3).map((v) => ({ id: v.id, title: v.title, thumbnailUrl: thumbOf(v) }));
  };
  const noKey = !process.env.YOUTUBE_API_KEY;

  return (
    <main className="flex-1 px-5 pb-12 pt-2 space-y-6">
      <form className="flex gap-3" action="/watch/search">
        <input
          name="q"
          defaultValue={q}
          placeholder="What do you want to watch?"
          autoFocus={!q}
          autoComplete="off"
          className="bigbtn flex-1 rounded-full bg-white/10 px-6 py-4 text-2xl font-bold text-white placeholder:text-white/40 outline-none"
        />
        <button type="submit" className="bigbtn rounded-full bg-[var(--kfocus)] px-6 py-4 text-2xl font-extrabold text-[#0b1020] active:scale-95">🔍</button>
      </form>

      {noKey && <p className="text-center text-[var(--kmuted)] font-semibold">Search isn&apos;t set up yet (ask a grown-up to add a YouTube key).</p>}
      {q && !noKey && hits.length === 0 && <p className="text-center text-[var(--kmuted)] font-semibold text-xl">Nothing found for that. Try different words!</p>}

      <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
        {hits.map((h) => {
          const row = byId.get(h.id);
          const playable = row ? canPlay(row, settings) : false;
          const asked = pending.has(h.id);
          const hasCard = !!row?.card && row.card.reviewer.model !== "sample";
          const verdict = row && hasCard ? aiPasses(row, settings) : null;
          const saidYes = approved.has(h.id);
          return (
            <li key={h.id} className="tile !w-auto">
              {playable ? (
                <Link href={`/watch/${h.id}`} className="block outline-none" draggable={false}>
                  <div className="relative">
                    <Image src={h.thumbnailUrl} alt="" width={640} height={360} unoptimized draggable={false} className="w-full aspect-video object-cover" />
                    <span className="absolute left-3 bottom-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-2xl text-[#0b1020] shadow">▶</span>
                    {saidYes && <span className="absolute right-3 top-3 rounded-full bg-[var(--kfocus)] px-3 py-1 text-xs font-extrabold text-[#0b1020]">A grown-up said yes! 🎉</span>}
                  </div>
                  <p className="px-3 py-2 text-sm font-bold leading-snug line-clamp-1 text-[var(--kmuted)]">{h.title}</p>
                </Link>
              ) : (
                <>
                  <div className="relative">
                    <Image src={h.thumbnailUrl} alt="" width={640} height={360} unoptimized draggable={false} className="w-full aspect-video object-cover opacity-80" />
                    <span className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--kfocus)] text-xl font-extrabold text-[#0b1020] shadow">{asked ? "✓" : "?"}</span>
                  </div>
                  <div className="px-3 pt-2 pb-3">
                    <p className="text-sm font-bold leading-snug line-clamp-1 text-[var(--kmuted)]">{h.title}</p>
                    <p className="text-xs text-white/40 truncate">{h.channelTitle}</p>
                    <div className="mt-2">
                      {asked ? (
                        <span className="block w-full rounded-full bg-white/10 py-2 text-center text-sm font-extrabold">Asked a grown-up!</span>
                      ) : (
                        <CheckButton
                          videoId={h.id}
                          label={hasCard && verdict && !verdict.pass ? "Ask a grown-up 🙋" : "Let's check it! 🔍"}
                          suggestions={suggestionsFor(h.channelId)}
                          initiallyChecking={checking.has(h.id) && !hasCard}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
