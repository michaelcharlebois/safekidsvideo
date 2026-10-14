import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { listKidDays, localDay, MOODS, shapeDay, watchEventsSince } from "@/lib/checkin";
import { Button, Card, Notice, TopBar } from "@/components/ui";
import { saveCheckin } from "@/app/actions";
import { TimezoneSync } from "./timezone-sync";

export const dynamic = "force-dynamic";

/** The evening question, one card per kid: how were they, and here's what they watched. */
export default async function CheckinPage(props: PageProps<"/parent/checkin">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/checkin" : "/unlock?next=/parent/checkin");
  const fid = v.familyId;
  const [family, profiles] = await Promise.all([db.getFamily(fid), db.listProfiles(fid)]);
  const tz = family.timezone;
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : localDay(tz);
  const start = new Date(`${day}T00:00:00`);
  const [events, done, videos, channels] = await Promise.all([
    watchEventsSince(fid, new Date(start.getTime() - 12 * 3600 * 1000).toISOString()), listKidDays(fid, day), db.listVideos(), db.listChannels(),
  ]);
  const todays = events.filter((e) => localDay(tz, new Date(e.startedAt)) === day);
  const videoById = new Map(videos.map((x) => [x.id, x]));
  const cards = await db.listCards([...new Set(todays.map((e) => e.videoId))]);
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  const channelTitle = (id: string) => channels.find((c) => c.id === id)?.title ?? id;

  return (
    <>
      <TopBar title="Check-in" right={<Link href="/parent/activity#checkins" className="text-sm font-bold text-forest hover:underline">Activity</Link>} />
      <TimezoneSync current={tz} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        <p className="text-sm text-muted">{day === localDay(tz) ? "Today" : day}. Takes five seconds. After a few weeks, Activity starts showing patterns.</p>
        {sp.saved === "1" && <Notice tone="ok">Saved. Thanks.</Notice>}
        {profiles.map((p) => {
          const mine = todays.filter((e) => e.profileId === p.id || (!e.profileId && profiles.length === 1));
          const shape = shapeDay(mine, videoById, cardById);
          const existing = done.find((d) => d.profileId === p.id && d.day === day);
          return (
            <Card key={p.id} className="space-y-3 p-5">
              <h2 className="text-xl"><span className="mr-2" aria-hidden>{p.avatar}</span>How was {p.name} today?</h2>
              <form action={saveCheckin} className="space-y-3">
                <input type="hidden" name="profileId" value={p.id} />
                <input type="hidden" name="day" value={day} />
                <div className="grid grid-cols-4 gap-2">
                  {MOODS.map((m) => (
                    <label key={m.value} className="cursor-pointer">
                      <input type="radio" name="mood" value={m.value} defaultChecked={existing?.mood === m.value} required className="peer sr-only" />
                      <span className="flex flex-col items-center gap-1 rounded-xl border border-sand bg-surface py-3 peer-checked:border-forest peer-checked:bg-sage-soft peer-checked:ring-2 peer-checked:ring-forest peer-focus-visible:ring-2 peer-focus-visible:ring-forest">
                        <span className="text-3xl" aria-hidden>{m.emoji}</span><span className="text-xs font-bold text-forest">{m.label}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <input name="note" defaultValue={existing?.note} placeholder="Anything notable? (slept badly, big day at school, meltdown at dinner…)" className="w-full rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted">{shape.minutes ? `~${shape.minutes} min of video today` : "No video today"}</span>
                  <Button type="submit" size="sm">{existing ? "Update" : "Save"}</Button>
                </div>
              </form>
              {shape.videos.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-bold text-forest">What {p.name} watched ({shape.videos.length})</summary>
                  <ul className="mt-2 divide-y divide-sand">
                    {shape.videos.map(({ video, card, minutes }, i) => (
                      <li key={`${video.id}-${i}`} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0"><Link href={`/parent/video/${video.id}`} className="font-bold hover:underline line-clamp-1">{video.title}</Link><span className="block text-xs text-muted">{channelTitle(video.channelId)}{card ? ` · ${card.pace}` : ""}</span></span>
                        <span className="shrink-0 text-xs text-muted">~{minutes} min</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          );
        })}
      </main>
    </>
  );
}
