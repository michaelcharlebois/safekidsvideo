import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { childSettings, getLibrary } from "@/lib/queries";
import { kidHome } from "@/lib/kid-home";
import { pendingVideoIds, recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { watchEventsSince } from "@/lib/checkin";
import { attributedTo } from "@/lib/sessions";
import { tasteFrom } from "@/lib/arrange";
import { timeState } from "@/lib/screentime";
import { clockTime } from "@/lib/bedtime";
import { supabaseEnabled } from "@/lib/supabase/server";
import { chooseKidUi, KID_UI_COOKIE } from "@/lib/form-factor";
import type { VideoWithCard } from "@/lib/types";
import { AutoRefresh } from "./auto-refresh";
import { TvHome } from "./home/tv-home";
import { PhoneHome, TabletHome } from "./home/touch-home";
import type { KidHomeView, KidVideo } from "./home/view";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // kid-triggered reviews run in the background within this budget

const card = (v: VideoWithCard): KidVideo => ({ id: v.id, title: v.title, thumb: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, durationSeconds: v.durationSeconds });

/**
 * Kid Home. The content is computed ONCE here from the child-scoped gate (kidHome(): inventory ∩
 * authorize() for this child) and handed to one of three layouts — TV, tablet or phone — which only
 * present it. Tiles link to the player, which authorizes again.
 */
export default async function WatchPage(props: PageProps<"/watch">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  if (!viewer.profileId) redirect("/watch/who"); // fail closed: no child, no shelves
  const fid = viewer.familyId;
  const sp = await props.searchParams;
  const [lib, settings, approved, recent, events, pending, profiles, family, h, jar] = await Promise.all([
    getLibrary(fid, viewer.profileId), childSettings(fid, viewer.profileId), recentlyApprovedIds(fid, viewer.profileId), recentWatchIds(fid, 8, viewer.profileId),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
    pendingVideoIds(fid, viewer.profileId), db.listProfiles(fid), db.getFamily(fid), headers(), cookies(),
  ]);
  if (!settings) redirect("/watch/who");
  const byId = new Map(lib.map((v) => [v.id, v]));
  const home = kidHome({
    lib, settings, recentIds: recent, approvedIds: approved, now: Date.now(), // eslint-disable-line react-hooks/purity -- server component, rendered per request
    taste: tasteFrom(events.filter((e) => attributedTo(e.profileId, viewer.profileId!, profiles.length)), byId),
  });
  const time = await timeState(fid, settings, family.timezone);
  const playable = new Set(home.playable.map((v) => v.id));

  const name = settings.profileName ?? "you";
  const view: KidHomeView = {
    child: { id: viewer.profileId, name, avatar: settings.profileAvatar ?? "⭐" },
    mode: settings.mode,
    canSearch: settings.mode !== "locked",
    canSwitch: profiles.length > 1 && !(viewer.role === "device" && viewer.assignedProfileId),
    shelves: [
      ...(home.justApproved.length ? [{ id: "approved", title: "A grown-up said yes!", kind: "approved" as const, videos: home.justApproved.map(card), comingSoon: 0 }] : []),
      ...(home.keepWatching.length ? [{ id: "recent", title: "Keep watching", kind: "recent" as const, videos: home.keepWatching.map(card), comingSoon: 0 }] : []),
      ...(home.forYou.length ? [{ id: "for-you", title: `For ${name}`, kind: "for-you" as const, videos: home.forYou.map(card), comingSoon: 0 }] : []),
      ...home.channels.map((c) => ({ id: c.channelId, title: c.title, kind: "channel" as const, videos: c.videos.map(card), comingSoon: c.checking })),
    ],
    // Asked for and not answered yet. Never playable from Home (and only listed if it isn't playable anyway).
    waiting: [...pending].filter((id) => !playable.has(id)).map((id) => byId.get(id)).filter((v): v is VideoWithCard => !!v).map(card),
    minutesLeft: time.allowed ? time.remainingMinutes : undefined,
    stayingUpUntil: time.allowed && time.extendedUntil ? clockTime(new Date(time.extendedUntil), family.timezone) : undefined,
    exitTarget: supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent",
    asking: sp.ask === "1",
  };
  const override = typeof sp.ui === "string" ? sp.ui : jar.get(KID_UI_COOKIE)?.value;
  const ui = chooseKidUi(h.get("user-agent") ?? "", override);
  const refresh = home.channels.some((s) => s.checking > 0) || view.waiting.length > 0;

  return (
    <>
      {refresh && <AutoRefresh />}
      {ui === "tv" ? <TvHome view={view} />
        : ui === "tablet" ? <TabletHome view={view} />
        : ui === "phone" ? <PhoneHome view={view} />
        : (
          <>
            <div className="flex flex-1 flex-col sm:hidden"><PhoneHome view={view} /></div>
            <div className="hidden flex-1 flex-col sm:flex"><TabletHome view={view} /></div>
          </>
        )}
    </>
  );
}
