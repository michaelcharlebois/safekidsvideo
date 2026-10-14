import Link from "next/link";
import { VideoThumb } from "@/components/video-thumb";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { computeKidStats, type KidStats } from "@/lib/stats";
import { findPatterns, historyRecorded, sampleActivityAllowed, listKidDays, localDay, MOODS, shapeDay, watchEventsSince, type KidDay, type WatchEvent } from "@/lib/checkin";
import { historyByDay } from "@/lib/history";
import { attributedTo } from "@/lib/sessions";
import { detailHref } from "@/lib/back";
import { sampleActivity } from "@/lib/activity-sample";
import type { Channel, ContentCard, Video } from "@/lib/types";
import { Button, buttonClass, Card, EmptyState, Notice, SectionHeader } from "@/components/ui";
import { IconActivity, IconClock, IconKids, IconTv } from "@/components/icons";
import { saveCheckin } from "@/app/actions";

export const dynamic = "force-dynamic";

const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
const fmtMin = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m} min`);
const hourLabel = (h: number) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "noon" : `${h - 12} pm`);

/**
 * Activity: what one child watched, how much time it took, and any patterns worth noticing. Everything
 * comes from recorded viewing and the parent's own evening check-ins (the existing stats, history,
 * insights and check-in, together). Minutes are estimates and the page says so; where nothing is
 * recorded, it says that instead of showing zeros as facts.
 */
export default async function ActivityPage(props: PageProps<"/parent/activity">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/activity" : "/unlock?next=/parent/activity");
  const fid = v.familyId;
  const [family, profiles] = await Promise.all([db.getFamily(fid), db.listProfiles(fid)]);
  const kid = profiles.find((p) => p.id === sp.kid) ?? profiles.find((p) => p.id === v.profileId) ?? profiles[0];
  if (!kid) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-10"><Card><EmptyState icon={<IconKids />} title="Add a child first" action={<Link href="/parent/kids#add" className={buttonClass("primary")}>Add a child</Link>}>Activity shows what each child watched and for how long.</EmptyState></Card></main>;
  }
  const tz = family.timezone;
  const days = sp.range === "30" ? 30 : 7;
  const now = Date.now();
  const recorded = historyRecorded();
  // Design preview only: a deployment that records nothing can show labelled sample data when asked to.
  const sample = sampleActivityAllowed() && process.env.BRIGHTFRAME_SAMPLE_ACTIVITY === "1" ? sampleActivity(kid.id, now) : null;

  let events: WatchEvent[] = [], videos: Video[] = [], cards: ContentCard[] = [], channels: Channel[] = [], checkins: KidDay[] = [];
  if (sample) ({ events, videos, cards, channels, checkins } = sample);
  else if (recorded) {
    const since = new Date(now - 60 * 86_400_000);
    [events, checkins, channels] = await Promise.all([watchEventsSince(fid, since.toISOString()), listKidDays(fid, localDay(tz, since)), db.listChannels()]);
    const ids = [...new Set(events.map((e) => e.videoId))];
    [videos, cards] = await Promise.all([Promise.all(ids.map((id) => db.getVideo(id))).then((vs) => vs.filter((x): x is Video => !!x)), db.listCards(ids)]);
  }
  const s = computeKidStats({ events, videos, cards, channels, profileId: kid.id, childCount: profiles.length, days, tz, now });
  const videoById = new Map(videos.map((x) => [x.id, x]));
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  const windowStart = now - days * 86_400_000;
  // Built from every loaded row (so a session that straddles the window start pairs correctly), then windowed.
  const allHistory = historyByDay(events, videoById, (iso) => localDay(tz, new Date(iso)), kid.id, profiles.length);
  const history = { ...allHistory, unattributed: s.unattributed, days: allHistory.days.map((d) => ({ ...d, items: d.items.filter((i) => Date.parse(i.at) >= windowStart) })).filter((d) => d.items.length).map((d) => ({ ...d, minutes: d.items.reduce((a, i) => a + i.minutes, 0) })) };
  const today = localDay(tz, new Date(now));
  const href = (o: { range?: number; kid?: string } = {}) => `/parent/activity?kid=${o.kid ?? kid.id}&range=${o.range ?? days}`;

  // Check-ins: the parent's own answers, with what that day's viewing looked like.
  const mine = checkins.filter((d) => d.profileId === kid.id);
  const eventsByDay = new Map<string, WatchEvent[]>();
  for (const e of events) if (attributedTo(e.profileId, kid.id, profiles.length)) { const d = localDay(tz, new Date(e.startedAt)); eventsByDay.set(d, [...(eventsByDay.get(d) ?? []), e]); }
  const moodRows = mine.map((d) => ({ day: d.day, mood: d.mood, note: d.note, shape: shapeDay(eventsByDay.get(d.day) ?? [], videoById, cardById) })).sort((a, b) => b.day.localeCompare(a.day));
  const patterns = findPatterns(moodRows);
  const tonight = mine.find((d) => d.day === today);
  const trend = s.prevMinutes ? Math.round(((s.minutes - s.prevMinutes) / s.prevMinutes) * 100) : null;

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title sm:text-display">Activity</h1>
          <p className="text-sm text-muted sm:text-base">What {kid.name} watched, for how long, and how the days went.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profiles.length > 1 && (
            <nav aria-label="Show activity for" className="flex gap-1.5 lg:hidden">
              {profiles.map((p) => (
                <Link key={p.id} href={href({ kid: p.id })} aria-current={p.id === kid.id ? "true" : undefined}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${p.id === kid.id ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink"}`}>
                  <span aria-hidden>{p.avatar}</span>{p.name}
                </Link>
              ))}
            </nav>
          )}
          <div role="group" aria-label="Period" className="inline-flex rounded-full border border-sand bg-surface p-0.5 text-sm font-bold">
            {[7, 30].map((r) => (
              <Link key={r} href={href({ range: r })} aria-current={days === r ? "true" : undefined} className={`rounded-full px-3.5 py-1.5 ${days === r ? "bg-sage-soft text-forest" : "text-muted hover:text-forest"}`}>{r === 7 ? "7 days" : "30 days"}</Link>
            ))}
          </div>
        </div>
      </header>

      <div className="mt-4 space-y-3">
        {sample && <Notice tone="warn"><b>Sample data.</b> This preview deployment records no viewing, so the numbers below are made up to show the layout. A family account shows real viewing.</Notice>}
        {!recorded && !sample && (
          <Notice><b>Nothing is recorded here.</b> Viewing history and check-ins are kept by your family account, on connected TVs and tablets. In this local mode nothing is saved, so there&apos;s nothing to show yet.</Notice>
        )}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {/* ---- time ---- */}
          <Card as="section" className="p-5">
            <SectionHeader icon={<IconClock />} title={days === 7 ? "The last 7 days" : "The last 30 days"} />
            {s.plays === 0 ? (
              <p className="mt-3 text-sm text-muted">{recorded || sample ? `Nothing watched in the last ${days} days.` : "No viewing recorded."}</p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-4xl font-extrabold tracking-tight text-forest">{fmtMin(s.minutes)}</p>
                  <p className="text-sm text-muted">on {s.activeDays} of {days} days{s.activeDays ? `, about ${Math.round(s.minutes / s.activeDays)} min on days with video` : ""}</p>
                </div>
                {trend !== null && <p className="mt-1 text-sm text-muted"><b className="text-ink">{trend > 0 ? "+" : ""}{trend}%</b> compared with the {days} days before.</p>}
                {s.starts > 0 && <p className="mt-1 text-sm text-muted">{s.starts} video{s.starts === 1 ? "" : "s"} started, {s.finishes} finished, {s.skips} skipped.</p>}
                <DayBars days={s.byDay} today={today} week={days === 7} />
                <p className="mt-3 text-xs text-muted">Minutes are estimates: a finished video counts its full length; one left early counts about 60% of it.</p>
              </>
            )}
          </Card>

          {/* ---- history ---- */}
          <Card as="section" className="overflow-hidden">
            <div className="border-b border-sand px-5 py-4"><SectionHeader icon={<IconTv />} title={`What ${kid.name} watched`} sub={days === 7 ? "Day by day, newest first." : "The last 30 days, newest first."} /></div>
            {history.days.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{recorded || sample ? "Nothing watched in this period." : "No viewing recorded."}</p>
            ) : (
              <ol className="divide-y divide-sand">
                {history.days.slice(0, days === 7 ? 7 : 10).map((d) => (
                  <li key={d.day} className="px-5 py-4">
                    <p className="flex items-baseline justify-between gap-2 text-sm"><b className="text-forest">{dayName(d.day, today)}</b><span className="text-muted">~{d.minutes} min</span></p>
                    <ul className="mt-2 space-y-2">
                      {d.items.slice(0, 6).map((i, n) => (
                        <li key={`${i.video.id}-${n}`} className="flex items-center gap-3">
                          <VideoThumb src={thumb(i.video)} width={96} height={54} className="aspect-video w-20 shrink-0 rounded-lg bg-sand-soft object-cover" />
                          <span className="min-w-0 flex-1">
                            <Link href={detailHref(`/parent/video/${i.video.id}`, "library", kid.id)} className="block text-sm font-semibold leading-snug text-ink hover:underline line-clamp-2">{i.video.title}</Link>
                            <span className="text-xs text-muted">{channels.find((c) => c.id === i.video.channelId)?.title ?? i.video.channelId} · ~{i.minutes} min{i.ended ? ` · ${i.ended === "left" ? "left early" : i.ended}` : ""}</span>
                          </span>
                        </li>
                      ))}
                      {d.items.length > 6 && <li className="text-xs text-muted">and {d.items.length - 6} more</li>}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            {(history.unattributed > 0 || history.unknown > 0) && (
              <p className="border-t border-sand px-5 py-3 text-xs text-muted">
                {history.unattributed > 0 && `${history.unattributed} play${history.unattributed === 1 ? "" : "s"} in this period came from a screen that didn't record which child was watching. They aren't counted for any child. `}
                {history.unknown > 0 && `${history.unknown} play${history.unknown === 1 ? " is" : "s are"} of videos no longer in Brightframe and aren't listed.`}
              </p>
            )}
          </Card>

          {/* ---- patterns in what they watch ---- */}
          {s.plays > 0 && (
            <Card as="section" className="p-5">
              <SectionHeader icon={<IconActivity />} title="Viewing patterns" sub="Where the time went in this period." />
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <BarList title="Channels" rows={s.byChannel.map((c) => ({ key: c.id, label: c.title, value: c.minutes, note: `${c.minutes} min, ${c.plays} play${c.plays === 1 ? "" : "s"}` }))} />
                <BarList title="Kinds of video" rows={s.byFormat.map((f) => ({ key: f.format, label: f.label, value: f.minutes, note: `${f.minutes} min` }))}
                  empty="No reviewed videos watched yet." footnote={s.reviewedShare < 0.9 ? `Based on the ${Math.round(s.reviewedShare * 100)}% of minutes spent on reviewed videos.` : undefined} />
                <BarList title="Pace" rows={(["calm", "moderate", "frenetic"] as const).map((p) => ({ key: p, label: p[0].toUpperCase() + p.slice(1), value: s.pace[p], note: `${s.pace[p]} min` }))}
                  empty="No reviewed videos watched yet." />
                <HourBars hours={s.byHour} />
              </div>
              {s.topVideos.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-forest">Watched most</h3>
                  <ul className="mt-2 divide-y divide-sand">
                    {s.topVideos.map(({ video, plays, minutes }) => (
                      <li key={video.id} className="flex items-center gap-3 py-2 text-sm">
                        <VideoThumb src={thumb(video)} width={96} height={54} className="aspect-video w-16 shrink-0 rounded-lg bg-sand-soft object-cover" />
                        <Link href={detailHref(`/parent/video/${video.id}`, "library", kid.id)} className="min-w-0 flex-1 font-semibold hover:underline line-clamp-2">{video.title}</Link>
                        <span className="shrink-0 text-xs text-muted">{plays}×, {minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* ---- check-ins ---- */}
        <aside className="space-y-6" id="checkins">
          <Card as="section" className="p-5">
            <SectionHeader title={`How was ${kid.name} today?`} sub="Your five-second evening check-in. Only you see it." />
            {recorded ? (
              <form action={saveCheckin} className="mt-4 space-y-3">
                <input type="hidden" name="profileId" value={kid.id} /><input type="hidden" name="day" value={today} />
                <input type="hidden" name="next" value={`${href()}#checkins`} />
                <div className="grid grid-cols-4 gap-2">
                  {MOODS.map((m) => (
                    <label key={m.value} className="cursor-pointer">
                      <input type="radio" name="mood" value={m.value} defaultChecked={tonight?.mood === m.value} required className="peer sr-only" />
                      <span className="flex flex-col items-center gap-1 rounded-xl border border-sand bg-surface py-2.5 peer-checked:border-forest peer-checked:bg-sage-soft peer-checked:ring-2 peer-checked:ring-forest peer-focus-visible:ring-2 peer-focus-visible:ring-forest">
                        <span className="text-2xl" aria-hidden>{m.emoji}</span><span className="text-xs font-bold text-forest">{m.label}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <input name="note" defaultValue={tonight?.note} placeholder="Anything notable? (optional)" className="w-full rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest" />
                <Button type="submit" size="sm">{tonight ? "Update" : "Save"}</Button>
                {sp.saved === "1" && <p className="text-sm font-bold text-ok">Saved.</p>}
              </form>
            ) : <p className="mt-3 text-sm text-muted">{sample ? "Check-ins are saved with a family account." : "Check-ins are saved with your family account, so they aren't available in this local mode."}</p>}
          </Card>

          <Card as="section" className="p-5">
            <SectionHeader title="Days and moods" sub="Your check-ins next to what that day's viewing looked like." />
            {moodRows.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No check-ins yet. After a couple of weeks of answers, patterns start to show here.</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted">{moodRows.length} check-in{moodRows.length === 1 ? "" : "s"} in the last 60 days.</p>
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Recent check-ins, oldest first">
                  {moodRows.slice(0, 28).reverse().map((r) => {
                    const m = MOODS.find((x) => x.value === r.mood)!;
                    return <li key={r.day} title={`${r.day}: ${m.label}${r.shape.minutes ? `, ~${r.shape.minutes} min of video` : ", no video"}${r.note ? `. ${r.note}` : ""}`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-sand bg-surface text-lg"><span aria-hidden>{m.emoji}</span><span className="sr-only">{r.day}: {m.label}</span></li>;
                  })}
                </ul>
                {moodRows.length < 10 ? (
                  <p className="mt-3 text-xs text-muted">Patterns need about 10 check-ins, with and without each kind of day, before they mean much. {10 - moodRows.length} to go.</p>
                ) : patterns.length === 0 ? (
                  <p className="mt-3 text-xs text-muted">No clear differences between kinds of days so far.</p>
                ) : (
                  <div className="mt-4">
                    <h3 className="text-sm font-bold text-forest">Patterns so far</h3>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {patterns.slice(0, 5).map((pt) => (
                        <li key={pt.label} className="flex items-center justify-between gap-2 rounded-xl border border-sand bg-surface px-3 py-2">
                          <span><b className="text-ink">{pt.label}</b> <span className="text-xs text-muted">{pt.withN} days vs {pt.withoutN}</span></span>
                          <span className="shrink-0 font-bold text-ink">{pt.delta > 0 ? "+" : ""}{pt.delta.toFixed(1)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">The difference in average mood (1–4) on days with versus without. It shows a correlation, not a cause.</p>
                  </div>
                )}
              </>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}

function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** Minutes per day: one series, one hue, rounded ends on the baseline, today labelled. */
function DayBars({ days, today, week }: { days: KidStats["byDay"]; today: string; week: boolean }) {
  const max = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <figure className="mt-5">
      <div className="flex h-28 items-end gap-[2px] sm:gap-1" aria-hidden>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.minutes} min`}>
            <div className={`w-full rounded-t-[4px] ${d.minutes ? "bg-forest" : "bg-sand"}`} style={{ height: d.minutes ? `${Math.max(4, Math.round((d.minutes / max) * 100))}%` : "2px" }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[11px] text-muted sm:gap-1" aria-hidden>
        {days.map((d, i) => (
          <span key={d.day} className={`flex-1 text-center ${d.day === today ? "font-bold text-forest" : ""}`}>{d.day === today ? "Today" : week ? new Date(`${d.day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" }) : i === 0 ? d.day.slice(5) : ""}</span>
        ))}
      </div>
      {/* The same numbers as text, for screen readers. */}
      <figcaption className="sr-only">Minutes watched per day: {days.map((d) => `${d.day} ${d.minutes} minutes`).join("; ")}.</figcaption>
    </figure>
  );
}

function BarList({ title, rows, empty, footnote }: { title: string; rows: { key: string; label: string; value: number; note: string }[]; empty?: string; footnote?: string }) {
  const shown = rows.filter((r) => r.value > 0);
  const max = Math.max(1, ...shown.map((r) => r.value));
  return (
    <div>
      <h3 className="text-sm font-bold text-forest">{title}</h3>
      {shown.length === 0 ? <p className="mt-1 text-sm text-muted">{empty ?? "Nothing yet."}</p> : (
        <ul className="mt-2 space-y-2">
          {shown.slice(0, 6).map((r) => (
            <li key={r.key} className="text-sm">
              <div className="flex items-baseline justify-between gap-2"><span className="truncate text-ink">{r.label}</span><span className="shrink-0 text-xs text-muted">{r.note}</span></div>
              <div className="mt-1 h-2 rounded-full bg-sand-soft" aria-hidden><div className="h-2 rounded-full bg-forest" style={{ width: `${Math.max(3, Math.round((r.value / max) * 100))}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
      {footnote && <p className="mt-2 text-xs text-muted">{footnote}</p>}
    </div>
  );
}

function HourBars({ hours }: { hours: number[] }): ReactNode {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  return (
    <div>
      <h3 className="text-sm font-bold text-forest">Time of day</h3>
      <p className="text-xs text-muted">{hours.some(Boolean) ? `Most viewing around ${hourLabel(peak)}.` : "Nothing yet."}</p>
      <div className="mt-2 flex h-14 items-end gap-[2px]" aria-hidden>
        {hours.map((m, h) => <div key={h} className={`flex-1 rounded-t-[3px] ${m ? "bg-forest" : "bg-sand"}`} title={`${hourLabel(h)}: ${m} min`} style={{ height: m ? `${Math.max(6, Math.round((m / max) * 100))}%` : "2px" }} />)}
      </div>
      <p className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden><span>12 am</span><span>6 am</span><span>noon</span><span>6 pm</span><span>11 pm</span></p>
      <p className="sr-only">Minutes by hour: {hours.map((m, h) => `${hourLabel(h)} ${m}`).join(", ")}.</p>
    </div>
  );
}
