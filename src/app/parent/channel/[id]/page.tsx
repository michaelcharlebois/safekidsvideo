import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { channelReport, channelSlug } from "@/lib/channel-report";
import { blockedReasons, canPlay, getLibrary } from "@/lib/queries";
import { backLink } from "@/lib/back";
import { ChannelReportView } from "@/components/channel-report-view";
import { Button, Card, Notice, Pill } from "@/components/ui";
import { reviewChannelNow, toggleWhitelist } from "@/app/actions";
import { localDay, watchEventsSince, type WatchEvent } from "@/lib/checkin";
import type { VideoWithCard } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ChannelPage(props: PageProps<"/parent/channel/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? `/login?next=/parent/channel/${id}` : `/unlock?next=/parent/channel/${id}`);
  const fid = v.familyId;
  const back = backLink(sp);
  const profiles = await db.listProfiles(fid);
  const kidId = (typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined) ?? v.profileId ?? profiles[0]?.id;
  const [r, lib, settings, wl] = await Promise.all([channelReport(id), getLibrary(fid, kidId), db.getSettings(fid, kidId), db.listWhitelist(fid)]);
  if (!r) notFound();
  const since = new Date(Date.now() - 30 * 86_400_000); // eslint-disable-line react-hooks/purity -- server component
  const channelVideoIds = new Set(lib.filter((x) => x.channelId === id).map((x) => x.id));
  const allEvents = await watchEventsSince(fid, since.toISOString());
  const watching = viewingFor(allEvents.filter((e) => channelVideoIds.has(e.videoId) && (!kidId || e.profileId === kidId || !e.profileId)), new Map(lib.map((x) => [x.id, x])));
  const familyMinutes = viewingFor(allEvents.filter((e) => !kidId || e.profileId === kidId || !e.profileId), new Map(lib.map((x) => [x.id, x]))).minutes;
  const approved = wl.some((w) => w.kind === "channel" && w.targetId === id);
  const rows = lib.filter((x) => x.channelId === id).map((x) => ({ v: x, blocked: blockedReasons(x, settings) }));
  const visible = rows.filter((x) => canPlay(x.v, settings)).length;
  const backlog = rows.filter((x) => (!x.v.card || x.v.card.reviewer.model === "sample") && (x.v.durationSeconds ?? 0) <= 20 * 60).length;
  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 pt-5"><Link href={back.href} className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-forest">‹ {back.label}</Link></div>
      <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-4">
        <div className="flex items-start gap-3">
          {r.channel.thumbnailUrl && <Image src={r.channel.thumbnailUrl} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded-full object-cover bg-line" />}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold leading-tight">{r.channel.title}</h1>
            <p className="text-sm text-muted">{r.channel.handle} · <Link href={`/c/${channelSlug(r.channel)}`} className="underline">public report card</Link></p>
            {approved && <p className="text-xs text-muted mt-1">{visible} visible to {settings.profileName ?? "your kid"} right now</p>}
          </div>
          <form action={toggleWhitelist}>
            <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={id} /><input type="hidden" name="on" value={approved ? "0" : "1"} />
            <Button type="submit" variant={approved ? "ghost" : "primary"}>{approved ? "✓ Approved" : "Approve channel"}</Button>
          </form>
        </div>
        {sp.reviewing === "1" && <Notice tone="info"><b>Review requested</b> for up to 5 videos without a completed review. Refresh later to see which have one.</Notice>}

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg mr-auto">{settings.profileName ?? "Your kid"}&apos;s viewing <span className="text-sm font-normal text-muted">last 30 days</span></h2>
            {profiles.length > 1 && profiles.map((p) => (
              <Link key={p.id} href={`/parent/channel/${id}?kid=${p.id}`} className={`rounded-full px-2.5 py-1 text-xs font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>{p.avatar} {p.name}</Link>
            ))}
          </div>
          {watching.plays === 0 ? (
            <p className="mt-2 text-sm text-muted">{settings.profileName ?? "They"} hasn&apos;t watched this channel in the last 30 days.</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Fig n={watching.minutes >= 90 ? `${(watching.minutes / 60).toFixed(1)} h` : `${watching.minutes} min`} label={familyMinutes ? `${Math.round((100 * watching.minutes) / familyMinutes)}% of all their watching` : "watched"} />
                <Fig n={String(watching.plays)} label={`plays, ${watching.distinct} different videos`} />
                <Fig n={watching.ended ? `${Math.round((100 * watching.finished) / watching.ended)}%` : "—"} label="finished" tone={watching.ended && watching.finished / watching.ended < 0.5 ? "warn" : undefined} />
                <Fig n={watching.lastAt ? ago(watching.lastAt) : "—"} label="last watched" />
              </div>
              <div className="mt-4">
                <p className="text-xs font-bold text-muted">Minutes per day</p>
                <div className="mt-1 flex items-end gap-0.5" style={{ height: 48 }}>
                  {watching.byDay.map((d) => <div key={d.day} title={`${d.day}: ${d.minutes} min`} className="flex-1 rounded-t bg-ink" style={{ height: `${Math.round((d.minutes / Math.max(1, ...watching.byDay.map((x) => x.minutes))) * 44)}px`, opacity: d.minutes ? 1 : 0.12 }} />)}
                </div>
              </div>
            </>
          )}
        </Card>

        <ChannelReportView r={r} videoHref={(vid) => `/parent/video/${vid}`} />

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-extrabold">All videos <span className="text-muted font-bold">· {rows.length}</span></h3>
            {backlog > 0 && (
              <form action={reviewChannelNow}><input type="hidden" name="channelId" value={id} /><Button type="submit" variant="ghost" className="text-xs px-3 py-1.5">Review next 5 ({backlog} unreviewed)</Button></form>
            )}
          </div>
          <ul className="mt-2 divide-y divide-line">
            {[...rows].sort((a, b) => (watching.perVideo.get(b.v.id)?.plays ?? 0) - (watching.perVideo.get(a.v.id)?.plays ?? 0)).map(({ v: x, blocked }) => (
              <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                <Image src={x.thumbnailUrl ?? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`} alt="" width={96} height={54} unoptimized className="w-20 shrink-0 rounded-lg aspect-video object-cover bg-line" />
                <div className="min-w-0 flex-1">
                  <Link href={`/parent/video/${x.id}`} className="font-bold hover:underline line-clamp-1">{x.title}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                    {!x.card ? <Pill className="bg-line">unreviewed</Pill> : blocked.length ? <Pill className="bg-bad/10 text-bad">hidden: {blocked.join(", ")}</Pill> : <Pill className="bg-ok/10 text-ok">ok for {settings.profileName ?? "kid"}</Pill>}
                    {x.card && <span className="text-muted">★ {x.card.rating} · {x.card.pace}</span>}
                  </div>
                </div>
                {(() => {
                  const pv = watching.perVideo.get(x.id);
                  if (!pv) return <span className="shrink-0 text-xs text-muted">not watched</span>;
                  return (
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-bold">{pv.plays}× <span className="font-normal text-muted">· {pv.minutes} min</span></span>
                      <span className={`block ${pv.ended && pv.finished / pv.ended < 0.5 ? "text-warn" : "text-muted"}`}>{pv.ended ? `finished ${pv.finished}/${pv.ended}` : ""}{pv.lastAt ? `, ${ago(pv.lastAt)}` : ""}</span>
                    </span>
                  );
                })()}
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}

type PerVideo = { plays: number; minutes: number; finished: number; ended: number; lastAt?: string };

/** Viewing summary for a set of watch events: plays are rows without an outcome; outcome rows say how each play ended. */
function viewingFor(events: WatchEvent[], byId: Map<string, VideoWithCard>) {
  const perVideo = new Map<string, PerVideo>();
  const dayMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) dayMap.set(localDay(undefined, new Date(Date.now() - i * 86_400_000)), 0);
  let minutes = 0, plays = 0, finished = 0, ended = 0, lastAt: string | undefined;
  for (const e of events) {
    const pv = perVideo.get(e.videoId) ?? { plays: 0, minutes: 0, finished: 0, ended: 0 };
    if (e.outcome) {
      pv.ended++; ended++;
      if (e.outcome === "finished") { pv.finished++; finished++; }
      const m = Math.round((e.endedAtSec ?? 0) / 60);
      pv.minutes += m; minutes += m;
      const d = localDay(undefined, new Date(e.startedAt));
      if (dayMap.has(d)) dayMap.set(d, (dayMap.get(d) ?? 0) + m);
    } else {
      pv.plays++; plays++;
      if (!pv.lastAt || e.startedAt > pv.lastAt) pv.lastAt = e.startedAt;
      if (!lastAt || e.startedAt > lastAt) lastAt = e.startedAt;
      // Plays without an outcome row (older data): estimate from the video's length.
      void byId;
    }
    perVideo.set(e.videoId, pv);
  }
  // Older plays that never logged an ending still count toward minutes, estimated.
  for (const [vid, pv] of perVideo) {
    const missing = pv.plays - pv.ended;
    if (missing > 0) {
      const dur = (byId.get(vid)?.durationSeconds ?? 300) / 60;
      const est = Math.round(missing * dur * 0.6);
      pv.minutes += est; minutes += est;
    }
  }
  return { minutes, plays, finished, ended, lastAt, distinct: [...perVideo.values()].filter((p) => p.plays > 0).length, perVideo, byDay: [...dayMap.entries()].map(([day, m]) => ({ day, minutes: m })) };
}

function ago(iso: string) {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function Fig({ n, label, tone }: { n: string; label: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl bg-bg p-3">
      <p className={`text-2xl font-display ${tone === "warn" ? "text-warn" : ""}`}>{n}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
