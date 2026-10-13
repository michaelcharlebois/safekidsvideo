import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { watchEventsSince } from "@/lib/checkin";
import { forKid, orderShelves, tasteFrom } from "@/lib/arrange";
import { db } from "@/lib/db";
import { AutoRefresh } from "./auto-refresh";
import { ChannelAvatar, PlayTile, Shelf } from "./kid-ui";
import type { VideoWithCard } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // kid-triggered reviews run in the background within this budget

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const fid = viewer.familyId;
  const [lib, settings, approved, recent, events] = await Promise.all([
    getLibrary(fid), db.getSettings(fid, viewer.profileId), recentlyApprovedIds(fid), recentWatchIds(fid, 8, viewer.profileId),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
  ]);

  const byId = new Map(lib.map((v) => [v.id, v]));
  const mine = lib.filter((v) => v.whitelisted);
  const ok = (v: VideoWithCard) => blockedReasons(v, settings).length === 0;
  const playable = mine.filter(ok);
  const justApproved = playable.filter((v) => approved.has(v.id));
  const keepWatching = recent.map((id) => byId.get(id)).filter((v): v is VideoWithCard => !!v && ok(v));
  const taste = tasteFrom(events.filter((e) => !viewer.profileId || e.profileId === viewer.profileId || !e.profileId), byId);
  const forYou = playable.length >= 6 ? forKid(playable, settings, taste, 8) : [];

  // Home is only things that play. Unchecked videos live under Search, not in front of a six-year-old.
  const byChannel = new Map<string, VideoWithCard[]>();
  for (const v of mine) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  const FRESH_MS = 30 * 60 * 1000;
  const now = Date.now(); // eslint-disable-line react-hooks/purity -- server component, rendered per request
  const shelves = [...byChannel.entries()]
    .map(([channelId, vids]) => {
      const videos = vids.filter(ok).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      const unreviewed = vids.filter((v) => !v.card || v.card.reviewer.model === "sample").length;
      const added = vids[0].channel?.createdAt ? Date.parse(vids[0].channel.createdAt) : 0;
      return {
        channelId,
        channel: vids[0].channel,
        title: vids[0].channel?.title ?? channelId.replace(/^@/, ""),
        videos,
        // A channel approved in the last half hour with nothing cleared yet is still being checked.
        checking: videos.length === 0 && unreviewed > 0 && now - added < FRESH_MS ? unreviewed : 0,
      };
    })
    .filter((s) => s.videos.length > 0 || s.checking > 0);
  const ordered = orderShelves(shelves.map((x) => ({ ...x, id: x.channelId })), settings.channelOrder);
  const stillChecking = shelves.some((s) => s.checking > 0);

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
