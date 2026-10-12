import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { pendingCheckIds, pendingVideoIds, recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { db } from "@/lib/db";
import { AutoRefresh } from "./auto-refresh";
import { AskTile, ChannelAvatar, PlayTile, Shelf, thumbOf } from "./kid-ui";
import type { Suggestion } from "./check-button";
import type { VideoWithCard } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // kid-triggered reviews run in the background within this budget

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const fid = viewer.familyId;
  const [lib, settings, pending, checking, approved, recent] = await Promise.all([
    getLibrary(fid), db.getSettings(fid), pendingVideoIds(fid), pendingCheckIds(fid), recentlyApprovedIds(fid), recentWatchIds(fid),
  ]);

  const byId = new Map(lib.map((v) => [v.id, v]));
  const mine = lib.filter((v) => v.whitelisted);
  const ok = (v: VideoWithCard) => blockedReasons(v, settings).length === 0;
  const playable = mine.filter(ok);
  const justApproved = playable.filter((v) => approved.has(v.id));
  const keepWatching = recent.map((id) => byId.get(id)).filter((v): v is VideoWithCard => !!v && ok(v));
  const suggestions: Suggestion[] = playable.slice(0, 3).map((v) => ({ id: v.id, title: v.title, thumbnailUrl: thumbOf(v) }));

  const byChannel = new Map<string, VideoWithCard[]>();
  for (const v of mine) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  const shelves = [...byChannel.entries()]
    .map(([channelId, vids]) => ({
      channelId,
      channel: vids[0].channel,
      title: vids[0].channel?.title ?? channelId.replace(/^@/, ""),
      // playable first, then newest
      videos: vids.sort((a, b) => Number(ok(b)) - Number(ok(a)) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    }))
    .sort((a, b) => b.videos.filter(ok).length - a.videos.filter(ok).length);

  return (
    <main className="flex-1 px-5 pb-12 pt-2 space-y-6">
      {(pending.size > 0 || checking.size > 0) && <AutoRefresh />}

      {mine.length === 0 && (
        <div className="mt-24 text-center">
          <p className="text-5xl">📺</p>
          <p className="mt-3 text-3xl font-extrabold">Nothing here yet</p>
          <p className="mt-2 text-[var(--kmuted)] font-semibold">Ask a grown-up to add some channels.</p>
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

      {shelves.map((s) => (
        <Shelf key={s.channelId} title={s.title} avatar={<ChannelAvatar channel={s.channel} name={s.title} />}>
          {s.videos.map((v) =>
            ok(v) ? (
              <PlayTile key={v.id} v={v} />
            ) : (
              <AskTile
                key={v.id}
                v={v}
                asked={pending.has(v.id)}
                kidCanCheck={settings.mode === "open" && (!v.card || v.card.reviewer.model === "sample")}
                checking={checking.has(v.id)}
                suggestions={suggestions}
              />
            ),
          )}
        </Shelf>
      ))}
    </main>
  );
}
