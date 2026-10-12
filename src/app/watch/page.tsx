import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { pendingCheckIds, pendingVideoIds, recentlyApprovedIds } from "@/lib/activity";
import { db } from "@/lib/db";
import { askGrownUp } from "@/app/actions";
import { AutoRefresh } from "./auto-refresh";
import { CheckButton, type Suggestion } from "./check-button";
import type { VideoWithCard } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // kid-triggered reviews run in the background within this budget

const thumb = (v: VideoWithCard) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const fid = viewer.familyId;
  const [lib, settings, pending, checking, approved] = await Promise.all([
    getLibrary(fid), db.getSettings(fid), pendingVideoIds(fid), pendingCheckIds(fid), recentlyApprovedIds(fid),
  ]);

  const mine = lib.filter((v) => v.whitelisted);
  const playable = mine.filter((v) => blockedReasons(v, settings).length === 0);
  const justApproved = playable.filter((v) => approved.has(v.id));
  const suggestions: Suggestion[] = playable.slice(0, 3).map((v) => ({ id: v.id, title: v.title, thumbnailUrl: thumb(v) }));

  // Group by channel, newest upload first; channels with the most playable content first.
  const byChannel = new Map<string, VideoWithCard[]>();
  for (const v of mine) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  const groups = [...byChannel.entries()]
    .map(([channelId, vids]) => ({
      channelId,
      title: vids[0].channel?.title ?? channelId.replace(/^@/, ""),
      videos: vids.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    }))
    .sort((a, b) => b.videos.filter((v) => blockedReasons(v, settings).length === 0).length - a.videos.filter((v) => blockedReasons(v, settings).length === 0).length);

  return (
    <main className="flex-1 px-4 pb-8 space-y-8">
      {(pending.size > 0 || checking.size > 0) && <AutoRefresh />}

      {settings.mode !== "locked" && (
        <form action="/watch/search" className="flex gap-2">
          <input name="q" placeholder="What do you want to watch?" className="flex-1 rounded-full border-2 border-line bg-surface px-5 py-3 text-xl font-bold outline-none focus:border-accent" />
          <button type="submit" className="rounded-full bg-accent px-5 py-3 text-xl font-extrabold text-accent-ink active:scale-95">🔍</button>
        </form>
      )}

      {justApproved.length > 0 && (
        <Row title="🎉 A grown-up said yes!" tint="bg-sun/60">
          {justApproved.map((v) => <PlayTile key={v.id} v={v} />)}
        </Row>
      )}

      {mine.length === 0 && (
        <div className="mt-16 text-center">
          <p className="text-3xl font-extrabold">No videos yet</p>
          <p className="mt-2 text-muted font-semibold">Ask a grown-up to approve some channels.</p>
        </div>
      )}

      {groups.map((g) => (
        <Row key={g.channelId} title={g.title}>
          {g.videos.map((v) => {
            const blocked = blockedReasons(v, settings);
            if (blocked.length === 0) return <PlayTile key={v.id} v={v} />;
            const asked = pending.has(v.id);
            const unreviewed = !v.card || v.card.reviewer.model === "sample";
            const kidCanCheck = settings.mode === "open" && unreviewed;
            return (
              <li key={v.id} className="rounded-2xl bg-surface/70 p-2 shadow-sm">
                <div className="relative">
                  <Image src={thumb(v)} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line opacity-60 grayscale" />
                  <span className="absolute inset-0 flex items-center justify-center text-4xl">{asked ? "✅" : kidCanCheck ? "🔍" : "🔒"}</span>
                </div>
                <p className="mt-2 px-1 font-extrabold leading-snug line-clamp-2 text-sm text-muted">{v.title}</p>
                <div className="mt-2">
                  {asked ? (
                    <span className="block w-full rounded-full bg-grass py-2 text-center font-extrabold text-sm">Asked!</span>
                  ) : kidCanCheck ? (
                    <CheckButton videoId={v.id} label="Check it" suggestions={suggestions} initiallyChecking={checking.has(v.id)} />
                  ) : (
                    <form action={askGrownUp}>
                      <input type="hidden" name="videoId" value={v.id} />
                      <button type="submit" className="w-full rounded-full bg-sun py-2 font-extrabold text-sm active:scale-95">Ask a grown-up</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </Row>
      ))}
    </main>
  );
}

function Row({ title, tint, children }: { title: string; tint?: string; children: React.ReactNode }) {
  return (
    <section className={tint ? `rounded-2xl ${tint} p-3` : ""}>
      <h2 className="font-extrabold text-lg mb-3">{title}</h2>
      <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">{children}</ul>
    </section>
  );
}

function PlayTile({ v }: { v: VideoWithCard }) {
  return (
    <li>
      <Link href={`/watch/${v.id}`} className="block rounded-2xl bg-surface p-2 shadow-sm active:scale-[0.97] transition">
        <Image src={thumb(v)} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line" />
        <p className="mt-2 px-1 pb-1 font-extrabold leading-snug line-clamp-2 text-base">{v.title}</p>
      </Link>
    </li>
  );
}
