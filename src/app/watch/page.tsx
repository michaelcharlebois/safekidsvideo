import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { childSettings, getLibrary } from "@/lib/queries";
import { kidHome } from "@/lib/kid-home";
import { recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { watchEventsSince } from "@/lib/checkin";
import { tasteFrom } from "@/lib/arrange";
import { AutoRefresh } from "./auto-refresh";
import { ChannelAvatar, PlayTile, Shelf } from "./kid-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // kid-triggered reviews run in the background within this budget

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  if (!viewer.profileId) redirect("/watch/who"); // fail closed: no child, no shelves
  const fid = viewer.familyId;
  const [lib, settings, approved, recent, events] = await Promise.all([
    getLibrary(fid, viewer.profileId), childSettings(fid, viewer.profileId), recentlyApprovedIds(fid, viewer.profileId), recentWatchIds(fid, 8, viewer.profileId),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
  ]);

  if (!settings) redirect("/watch/who");
  const byId = new Map(lib.map((v) => [v.id, v]));
  // The one definition of this child's home screen (shared with the parent dashboard's preview).
  const home = kidHome({
    lib, settings, recentIds: recent, approvedIds: approved, now: Date.now(), // eslint-disable-line react-hooks/purity -- server component, rendered per request
    taste: tasteFrom(events.filter((e) => !viewer.profileId || e.profileId === viewer.profileId || !e.profileId), byId),
  });
  const { inventory: mine, justApproved, keepWatching, forYou, channels: ordered } = home;
  const stillChecking = ordered.some((s) => s.checking > 0);

  return (
    <main className="flex-1 px-5 pb-12 pt-2 space-y-6">
      {stillChecking && <AutoRefresh />}

      {ordered.length === 0 && keepWatching.length === 0 && (
        <div className="mt-24 text-center">
          <p className="text-5xl">📺</p>
          <p className="mt-3 text-3xl font-extrabold">Nothing here yet</p>
          <p className="mt-2 text-[var(--kmuted)] font-semibold">{mine.length ? "Your videos are being checked — back in a minute!" : "Ask a grown-up to add some channels."}</p>
        </div>
      )}

      {justApproved.length > 0 && (
        <Shelf title="A grown-up said yes! 🎉">
          {justApproved.map((v) => <PlayTile key={v.id} v={v} />)}
        </Shelf>
      )}

      {keepWatching.length > 0 && (
        <Shelf title="Keep watching">
          {keepWatching.map((v) => <PlayTile key={v.id} v={v} />)}
        </Shelf>
      )}

      {forYou.length > 0 && (
        <Shelf title={`For ${settings.profileName ?? "you"}`} avatar={<span className="text-2xl">{settings.profileAvatar ?? "⭐"}</span>}>
          {forYou.map((v) => <PlayTile key={v.id} v={v} />)}
        </Shelf>
      )}

      {ordered.map((s) => (
        <Shelf key={s.channelId} title={s.title} avatar={<ChannelAvatar channel={s.channel} name={s.title} />}>
          {s.videos.map((v) => <PlayTile key={v.id} v={v} />)}
          {s.checking > 0 && (
            <li className="tile flex aspect-video items-center justify-center p-4 text-center">
              <p className="animate-pulse text-lg font-extrabold text-[var(--kmuted)]">🔍 Checking {s.checking} new videos…<br /><span className="text-sm font-bold">back in a minute!</span></p>
            </li>
          )}
        </Shelf>
      ))}
    </main>
  );
}
