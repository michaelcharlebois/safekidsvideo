import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { searchKidsVideos } from "@/lib/youtube";
import { aiPasses, canPlay, getLibrary } from "@/lib/queries";
import { pendingVideoIds } from "@/lib/activity";
import { CheckButton } from "./check-button";

export const dynamic = "force-dynamic";
export const maxDuration = 180; // a kid-triggered review can take a minute or two

export default async function SearchPage(props: PageProps<"/watch/search">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const settings = await db.getSettings(viewer.familyId);
  if (settings.mode === "locked") redirect("/watch");

  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const [hits, lib, pending] = await Promise.all([
    q ? searchKidsVideos(q, 12, settings.kidsOnlySearch) : Promise.resolve([]),
    getLibrary(viewer.familyId),
    pendingVideoIds(viewer.familyId),
  ]);
  const byId = new Map(lib.map((v) => [v.id, v]));
  const noKey = !process.env.YOUTUBE_API_KEY;

  return (
    <main className="flex-1 px-4 pb-8 space-y-5">
      <form className="flex gap-2" action="/watch/search">
        <input
          name="q"
          defaultValue={q}
          placeholder="What do you want to watch?"
          autoFocus={!q}
          className="flex-1 rounded-full border-2 border-line bg-surface px-5 py-3 text-xl font-bold outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-full bg-accent px-5 py-3 text-xl font-extrabold text-accent-ink active:scale-95">🔍</button>
      </form>

      {noKey && <p className="text-center text-muted font-semibold">Search isn&apos;t set up yet (ask a grown-up to add a YouTube key).</p>}
      {q && !noKey && hits.length === 0 && <p className="text-center text-muted font-semibold">Nothing kid-safe found for that. Try different words!</p>}

      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {hits.map((h) => {
          const row = byId.get(h.id);
          const playable = row ? canPlay(row, settings) : false;
          const asked = pending.has(h.id);
          const hasCard = !!row?.card && row.card.reviewer.model !== "sample";
          const verdict = row && hasCard ? aiPasses(row, settings) : null;
          return (
            <li key={h.id} className="rounded-2xl bg-surface p-2 shadow-sm">
              {playable ? (
                <Link href={`/watch/${h.id}`} className="block active:scale-[0.97] transition">
                  <Image src={h.thumbnailUrl} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line" />
                </Link>
              ) : (
                <div className="relative">
                  <Image src={h.thumbnailUrl} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line opacity-70" />
                  <span className="absolute inset-0 flex items-center justify-center text-4xl">{asked ? "✅" : hasCard ? "🔒" : "🔍"}</span>
                </div>
              )}
              <p className="mt-2 px-1 font-extrabold leading-snug line-clamp-2 text-sm">{h.title}</p>
              <p className="px-1 text-xs text-muted truncate">{h.channelTitle}</p>
              <div className="mt-2">
                {playable ? (
                  <Link href={`/watch/${h.id}`} className="block w-full rounded-full bg-grass py-2 text-center font-extrabold text-sm">▶ Play</Link>
                ) : asked ? (
                  <span className="block w-full rounded-full bg-grass py-2 text-center font-extrabold text-sm">Asked a grown-up!</span>
                ) : (
                  <CheckButton videoId={h.id} label={hasCard && verdict && !verdict.pass ? "Ask a grown-up" : "Check it"} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
