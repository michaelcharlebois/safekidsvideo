import Link from "next/link";
import { VideoThumb } from "@/components/video-thumb";
import { Card, Stars } from "@/components/ui";
import { CONCERN_LABELS, CONCERN_TAGS, FORMAT_LABELS, type VideoFormat } from "@/lib/types";
import type { ChannelReport } from "@/lib/channel-report";

/** The report card body, shared by the parent page and the public page. `videoHref` decides where titles link. */
export function ChannelReportView({ r, videoHref }: { r: ChannelReport; videoHref: (id: string) => string | null }) {
  const total = r.reviewed || 1;
  const pct = (n: number) => `${Math.round((100 * n) / total)}%`;
  const tagRows = CONCERN_TAGS.map((t) => ({ t, ...(r.tags[t] ?? { any: 0, strong: 0 }) })).filter((x) => x.any > 0).sort((a, b) => b.strong - a.strong || b.any - a.any);
  const formats = (Object.entries(r.formats) as [VideoFormat, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      {r.reviewed === 0 ? (
        <Card className="p-4 text-sm text-muted">No reviewed videos yet for this channel. {r.videos.length ? `${r.videos.length} queued — the nightly reviewer will get to them.` : ""}</Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Reviewed" value={String(r.reviewed)} sub={`of ${r.videos.length} known`} />
              <Stat label="Parent rating" value={r.avgRating?.toFixed(1) ?? "—"} sub={<Stars value={r.avgRating ?? 0} />} />
              <Stat label="Age fit" value={r.ageFit ? `${r.ageFit.min}–${r.ageFit.max}` : "—"} sub="typical range" />
              <Stat label="Educational" value={r.avgEducational?.toFixed(1) ?? "—"} sub="out of 5" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Pace</p>
                <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-line">
                  <span className="bg-ok" style={{ width: pct(r.pace.calm) }} title={`calm ${pct(r.pace.calm)}`} />
                  <span className="bg-sun" style={{ width: pct(r.pace.moderate) }} title={`moderate ${pct(r.pace.moderate)}`} />
                  <span className="bg-bad" style={{ width: pct(r.pace.frenetic) }} title={`frenetic ${pct(r.pace.frenetic)}`} />
                </div>
                <p className="mt-1 text-xs text-muted">calm {pct(r.pace.calm)} · moderate {pct(r.pace.moderate)} · frenetic {pct(r.pace.frenetic)}{r.avgMinutes ? ` · videos run ~${r.avgMinutes} min` : ""}</p>
              </div>
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">What kind of videos</p>
                <p className="mt-1">{formats.map(([f, n]) => `${FORMAT_LABELS[f]} ${pct(n)}`).join(" · ")}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-extrabold">What comes up</h3>
            {tagRows.length === 0 ? <p className="mt-1 text-sm text-ok font-bold">Nothing flagged across {r.reviewed} reviewed videos.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {tagRows.map((x) => (
                  <li key={x.t} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 font-bold">{CONCERN_LABELS[x.t]}</span>
                    <span className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-line"><span className="bg-bad" style={{ width: pct(x.strong) }} /><span className="bg-sun" style={{ width: pct(x.any - x.strong) }} /></span>
                    <span className="w-28 shrink-0 text-right text-xs text-muted">{x.strong ? `${pct(x.strong)} moderate+` : `${pct(x.any)} mild`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <h3 className="font-extrabold">Best picks</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {r.bestPicks.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <VideoThumb src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} width={96} height={54} className="w-20 shrink-0 rounded-lg aspect-video object-cover bg-line" />
                    <span className="min-w-0"><TitleLink href={videoHref(v.id)}>{v.title}</TitleLink><span className="block text-xs text-muted">{r.cards.get(v.id)?.parentRecommendation}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4">
              <h3 className="font-extrabold">Watch out for</h3>
              {r.watchOut ? (
                <p className="mt-2 text-sm"><TitleLink href={videoHref(r.watchOut.video.id)}>{r.watchOut.video.title}</TitleLink><span className="block text-xs text-muted">{r.watchOut.why}</span></p>
              ) : <p className="mt-2 text-sm text-muted">Nothing above mild in what we&apos;ve reviewed.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function TitleLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <Link href={href} className="font-bold hover:underline">{children}</Link> : <span className="font-bold">{children}</span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-3 text-center">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs font-bold">{label}</p>
      <div className="text-xs text-muted flex justify-center">{sub}</div>
    </div>
  );
}
