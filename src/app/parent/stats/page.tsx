import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { kidStats } from "@/lib/stats";
import { Card, TopBar } from "@/components/ui";

export const dynamic = "force-dynamic";

/** How much, of what, and when — for one kid, over the last week or month. Plain bars, no chart library. */
export default async function StatsPage(props: PageProps<"/parent/stats">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/stats" : "/unlock?next=/parent/stats");
  const fid = v.familyId;
  const [family, profiles] = await Promise.all([db.getFamily(fid), db.listProfiles(fid)]);
  const kidId = (typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined) ?? v.profileId ?? profiles[0]?.id;
  const kid = profiles.find((p) => p.id === kidId);
  const days = sp.range === "30" ? 30 : 7;
  const s = await kidStats(fid, kidId, days, family.timezone);
  const trend = s.prevMinutes ? Math.round(((s.minutes - s.prevMinutes) / s.prevMinutes) * 100) : null;
  const maxDay = Math.max(1, ...s.byDay.map((d) => d.minutes));
  const maxHour = Math.max(1, ...s.byHour);
  const maxChan = Math.max(1, ...s.byChannel.map((c) => c.minutes));
  const paceTotal = s.pace.calm + s.pace.moderate + s.pace.frenetic || 1;
  const fmtTotal = s.byFormat.reduce((a, f) => a + f.minutes, 0) || 1;
  const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  const perDay = s.activeDays ? Math.round(s.minutes / s.activeDays) : 0;
  const href = (r: number, k = kidId) => `/parent/stats?kid=${k ?? ""}&range=${r}`;

  return (
    <>
      <TopBar
        title={kid ? `${kid.name}'s viewing` : "Viewing"}
        right={
          <span className="flex gap-1">
            {[7, 30].map((r) => <Link key={r} href={href(r)} className={`rounded-full px-3 py-1 text-xs font-bold border ${days === r ? "bg-ink text-bg border-ink" : "border-line"}`}>{r === 7 ? "Week" : "Month"}</Link>)}
          </span>
        }
      />
      <main className="mx-auto w-full max-w-2xl px-4 py-5 space-y-4">
        {profiles.length > 1 && (
          <div className="flex gap-2">{profiles.map((p) => <Link key={p.id} href={href(days, p.id)} className={`rounded-full px-3 py-1 text-sm font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line"}`}>{p.avatar} {p.name}</Link>)}</div>
        )}

        {s.plays === 0 ? (
          <Card className="p-8 text-center text-sm text-muted">Nothing watched in the last {days} days.</Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="flex items-baseline gap-3">
                <p className="text-4xl font-extrabold">{s.minutes >= 90 ? `${(s.minutes / 60).toFixed(1)} h` : `${s.minutes} min`}</p>
                <p className="text-sm text-muted">over {s.activeDays} of {days} days{perDay ? `, about ${perDay} min on days with video` : ""}</p>
              </div>
              {trend !== null && <p className={`mt-1 text-sm font-bold ${trend > 15 ? "text-warn" : trend < -15 ? "text-ok" : "text-muted"}`}>{trend > 0 ? "+" : ""}{trend}% vs the {days} days before</p>}
              <div className="mt-4 flex items-end gap-1" style={{ height: 72 }}>
                {s.byDay.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.minutes} min`}>
                    <div className="w-full rounded-t bg-ink" style={{ height: `${Math.round((d.minutes / maxDay) * 64)}px`, opacity: d.minutes ? 1 : 0.15 }} />
                    {days === 7 && <span className="text-[10px] text-muted">{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" })}</span>}
                  </div>
                ))}
              </div>
              {days === 30 && <p className="mt-1 flex justify-between text-[10px] text-muted"><span>{s.byDay[0]?.day.slice(5)}</span><span>today</span></p>}
            </Card>

            <Card className="p-4">
              <h2 className="font-extrabold">Channels</h2>
              <ul className="mt-2 space-y-2">
                {s.byChannel.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2"><Link href={`/parent/channel/${c.id}`} className="font-bold hover:underline truncate">{c.title}</Link><span className="shrink-0 text-xs text-muted">{c.minutes} min, {c.plays} play{c.plays === 1 ? "" : "s"}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-ink" style={{ width: `${Math.round((c.minutes / maxChan) * 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="p-4">
                <h2 className="font-extrabold">Kinds of video</h2>
                {s.byFormat.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing reviewed yet.</p> : (
                  <>
                    <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line">
                      {s.byFormat.map((f, i) => <span key={f.format} className="h-full" style={{ width: `${(100 * f.minutes) / fmtTotal}%`, background: ["#141a3a", "#2b3a8f", "#ffcf3f", "#2f9e6b", "#5f6478", "#c98a12", "#d94848", "#dbe7ff", "#d4f0cf"][i % 9] }} />)}
                    </div>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {s.byFormat.map((f, i) => <li key={f.format} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: ["#141a3a", "#2b3a8f", "#ffcf3f", "#2f9e6b", "#5f6478", "#c98a12", "#d94848", "#dbe7ff", "#d4f0cf"][i % 9] }} /><span className="flex-1">{f.label}</span><span className="text-muted">{Math.round((100 * f.minutes) / fmtTotal)}%</span></li>)}
                    </ul>
                  </>
                )}
                {s.reviewedShare < 0.9 && <p className="mt-2 text-[11px] text-muted">Based on the {Math.round(s.reviewedShare * 100)}% of minutes on reviewed videos.</p>}
              </Card>
              <Card className="p-4">
                <h2 className="font-extrabold">Pace</h2>
                <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line">
                  <span className="h-full bg-ok" style={{ width: `${(100 * s.pace.calm) / paceTotal}%` }} />
                  <span className="h-full bg-sun" style={{ width: `${(100 * s.pace.moderate) / paceTotal}%` }} />
                  <span className="h-full bg-bad" style={{ width: `${(100 * s.pace.frenetic) / paceTotal}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">calm {Math.round((100 * s.pace.calm) / paceTotal)}%, moderate {Math.round((100 * s.pace.moderate) / paceTotal)}%, frenetic {Math.round((100 * s.pace.frenetic) / paceTotal)}%</p>
                <h2 className="mt-4 font-extrabold">Time of day</h2>
                <div className="mt-2 flex items-end gap-px" style={{ height: 48 }}>
                  {s.byHour.map((m, h) => <div key={h} className="flex-1 rounded-t bg-ink" title={`${hourLabel(h)}: ${m} min`} style={{ height: `${Math.round((m / maxHour) * 44)}px`, opacity: m ? 1 : 0.12 }} />)}
                </div>
                <p className="mt-1 flex justify-between text-[10px] text-muted"><span>12a</span><span>6a</span><span>noon</span><span>6p</span><span>11p</span></p>
              </Card>
            </div>

            <Card className="p-4">
              <h2 className="font-extrabold">On repeat</h2>
              <ul className="mt-2 divide-y divide-line">
                {s.topVideos.map(({ video, plays, minutes }) => (
                  <li key={video.id} className="flex items-center gap-3 py-2 text-sm">
                    <Image src={video.thumbnailUrl ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" width={96} height={54} unoptimized className="w-20 shrink-0 rounded-lg aspect-video object-cover bg-line" />
                    <Link href={`/parent/video/${video.id}`} className="min-w-0 flex-1 font-bold hover:underline line-clamp-2">{video.title}</Link>
                    <span className="shrink-0 text-xs text-muted">{plays}×, {minutes} min</span>
                  </li>
                ))}
              </ul>
            </Card>
            <p className="text-xs text-muted">Minutes are estimates from what was started and finished. <Link href="/parent/insights" className="underline">See how days with video compare to how {kid?.name ?? "they"} felt →</Link></p>
          </>
        )}
      </main>
    </>
  );
}
