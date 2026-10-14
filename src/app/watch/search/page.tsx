import { redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { searchKidsVideos, type SearchHit } from "@/lib/youtube";
import { childSettings, getLibrary, playableFor } from "@/lib/queries";
import { pendingCheckIds, pendingVideoIds, recentlyDeclinedIds } from "@/lib/activity";
import { searchState } from "@/lib/kid-search";
import { timeState } from "@/lib/screentime";
import { supabaseEnabled } from "@/lib/supabase/server";
import { kidUi } from "@/lib/kid-ui-server";
import type { Video } from "@/lib/types";
import { AutoRefresh } from "../auto-refresh";
import { PhoneSearch, TabletSearch, TvSearch } from "./layouts";
import type { SearchView } from "./view";

/** Pin a search's results for 10 minutes so polling/refreshes don't reshuffle the grid. */
const cachedSearch = unstable_cache(
  async (q: string, kidsOnly: boolean) => searchKidsVideos(q, 12, kidsOnly),
  ["kid-search"],
  { revalidate: 600 },
);

/** Local development without a YouTube key: search the titles already in Brightframe's catalogue, labelled as practice. */
async function catalogueSearch(q: string): Promise<SearchHit[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all: Video[] = await db.listVideos();
  return all
    .filter((v) => words.every((w) => `${v.title} ${v.channelId}`.toLowerCase().includes(w)))
    .slice(0, 12)
    .map((v) => ({ id: v.id, title: v.title, channelId: v.channelId, channelTitle: v.channelId.replace(/^@/, ""), thumbnailUrl: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, durationSeconds: v.durationSeconds, madeForKids: false }));
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background reviews of long videos run inside this request's budget

/**
 * Kid Search. Locked mode has no search. Every result's state comes from THIS child's gate (searchState):
 * only "play" links to the player (which authorizes again); everything else says whether Brightframe checks
 * it first or a grown-up decides, and asking goes through the checkVideo server action.
 */
export default async function SearchPage(props: PageProps<"/watch/search">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const fid = viewer.familyId;
  const settings = await childSettings(fid, viewer.profileId);
  if (!viewer.profileId || !settings) redirect("/watch/who");
  if (settings.mode === "locked") redirect("/watch");
  const mode = settings.mode;

  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80).trim() : "";
  const source: SearchView["source"] = process.env.YOUTUBE_API_KEY ? "youtube" : !supabaseEnabled ? "catalogue" : "none";
  const [hits, lib, pending, checking, declined, profiles, family, ui] = await Promise.all([
    !q ? Promise.resolve([]) : source === "youtube" ? cachedSearch(q.toLowerCase(), settings.kidsOnlySearch) : source === "catalogue" ? catalogueSearch(q) : Promise.resolve([]),
    getLibrary(fid, viewer.profileId), pendingVideoIds(fid, viewer.profileId), pendingCheckIds(fid, viewer.profileId),
    recentlyDeclinedIds(fid, viewer.profileId), db.listProfiles(fid), db.getFamily(fid), kidUi(sp.ui),
  ]);
  const byId = new Map(lib.map((v) => [v.id, v]));
  const time = await timeState(fid, settings, family.timezone);
  const results = hits.map((h) => {
    const row = byId.get(h.id);
    const state = searchState(row, settings, { pending: pending.has(h.id), declined: declined.has(h.id) });
    return {
      id: h.id, title: h.title, channel: row?.channel?.title ?? h.channelTitle, thumb: h.thumbnailUrl, durationSeconds: row?.durationSeconds ?? h.durationSeconds,
      state, checking: state.kind === "check" && checking.has(h.id),
    };
  });
  const ready = playableFor(lib, settings).slice(0, 6).map((v) => ({ id: v.id, title: v.title, thumb: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, durationSeconds: v.durationSeconds }));

  const view: SearchView = {
    child: { name: settings.profileName ?? "you", avatar: settings.profileAvatar ?? "⭐" },
    mode, q, results, ready, source,
    canSwitch: profiles.length > 1 && !(viewer.role === "device" && viewer.assignedProfileId),
    minutesLeft: time.allowed ? time.remainingMinutes : undefined,
    exitTarget: supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent",
  };

  return (
    <>
      {results.some((r) => r.checking || r.state.kind === "waiting") && <AutoRefresh />}
      {ui === "tv" ? <TvSearch view={view} />
        : ui === "tablet" ? <TabletSearch view={view} />
        : ui === "phone" ? <PhoneSearch view={view} />
        : (
          <>
            <div className="flex flex-1 flex-col sm:hidden"><PhoneSearch view={view} /></div>
            <div className="hidden flex-1 flex-col sm:flex"><TabletSearch view={view} /></div>
          </>
        )}
    </>
  );
}
