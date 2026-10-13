import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { channelReport, channelSlug } from "@/lib/channel-report";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { ChannelReportView } from "@/components/channel-report-view";
import { Button, Card, Pill, TopBar } from "@/components/ui";
import { reviewChannelNow, toggleWhitelist } from "@/app/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ChannelPage(props: PageProps<"/parent/channel/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? `/login?next=/parent/channel/${id}` : `/unlock?next=/parent/channel/${id}`);
  const fid = v.familyId;
  const [r, lib, settings, wl] = await Promise.all([channelReport(id), getLibrary(fid), db.getSettings(fid, v.profileId), db.listWhitelist(fid)]);
  if (!r) notFound();
  const approved = wl.some((w) => w.kind === "channel" && w.targetId === id);
  const rows = lib.filter((x) => x.channelId === id).map((x) => ({ v: x, blocked: blockedReasons(x, settings) }));
  const visible = rows.filter((x) => x.v.whitelisted && !x.blocked.length).length;
  const backlog = rows.filter((x) => (!x.v.card || x.v.card.reviewer.model === "sample") && (x.v.durationSeconds ?? 0) <= 20 * 60).length;
  return (
    <>
      <TopBar title="Channel" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Dashboard</Link>} />
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
        {sp.reviewing === "1" && <Card className="p-3 bg-grass text-sm font-bold">Reviewing the next 5 in the background — refresh in a couple of minutes.</Card>}

        <ChannelReportView r={r} videoHref={(vid) => `/parent/video/${vid}`} />

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-extrabold">All videos <span className="text-muted font-bold">· {rows.length}</span></h3>
            {backlog > 0 && (
              <form action={reviewChannelNow}><input type="hidden" name="channelId" value={id} /><Button type="submit" variant="ghost" className="text-xs px-3 py-1.5">Review next 5 ({backlog} unreviewed)</Button></form>
            )}
          </div>
          <ul className="mt-2 divide-y divide-line">
            {rows.map(({ v: x, blocked }) => (
              <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
                <Image src={x.thumbnailUrl ?? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`} alt="" width={96} height={54} unoptimized className="w-20 shrink-0 rounded-lg aspect-video object-cover bg-line" />
                <div className="min-w-0 flex-1">
                  <Link href={`/parent/video/${x.id}`} className="font-bold hover:underline line-clamp-1">{x.title}</Link>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs">
                    {!x.card ? <Pill className="bg-line">unreviewed</Pill> : blocked.length ? <Pill className="bg-bad/10 text-bad">hidden: {blocked.join(", ")}</Pill> : <Pill className="bg-ok/10 text-ok">ok for {settings.profileName ?? "kid"}</Pill>}
                    {x.card && <span className="text-muted">★ {x.card.rating} · {x.card.pace}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
