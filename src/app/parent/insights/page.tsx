import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { findPatterns, listKidDays, localDay, MOODS, shapeDay, watchEventsSince, type DayShape } from "@/lib/checkin";
import { Card, TopBar } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Mood vs. what they watched, per kid, over the last 60 days. Honest about small numbers. */
export default async function InsightsPage() {
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/insights" : "/unlock?next=/parent/insights");
  const fid = v.familyId;
  const [family, profiles, videos] = await Promise.all([db.getFamily(fid), db.listProfiles(fid), db.listVideos()]);
  const tz = family.timezone;
  const sinceMs = Date.now() - 60 * 86_400_000; // eslint-disable-line react-hooks/purity -- server component
  const since = new Date(sinceMs);
  const [events, days] = await Promise.all([watchEventsSince(fid, since.toISOString()), listKidDays(fid, localDay(tz, since))]);
  const videoById = new Map(videos.map((x) => [x.id, x]));
  const cards = await db.listCards([...new Set(events.map((e) => e.videoId))]);
  const cardById = new Map(cards.map((c) => [c.videoId, c]));

  return (
    <>
      <TopBar title="Insights" right={<Link href="/parent/checkin" className="text-sm font-bold text-muted hover:text-ink">Tonight&apos;s check-in →</Link>} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        {profiles.map((p) => {
          const mine = days.filter((d) => d.profileId === p.id);
          const byDay = new Map<string, typeof events>();
          for (const e of events) {
            if (!(e.profileId === p.id || (!e.profileId && profiles.length === 1))) continue;
            const d = localDay(tz, new Date(e.startedAt));
            byDay.set(d, [...(byDay.get(d) ?? []), e]);
          }
          const rows = mine.map((d) => ({ day: d.day, mood: d.mood, note: d.note, shape: shapeDay(byDay.get(d.day) ?? [], videoById, cardById) as DayShape })).sort((a, b) => b.day.localeCompare(a.day));
          const avg = rows.length ? rows.reduce((a, r) => a + r.mood, 0) / rows.length : 0;
          const patterns = findPatterns(rows);
          return (
            <Card key={p.id} className="p-4 space-y-3">
              <h2 className="text-xl font-extrabold"><span className="mr-2">{p.avatar}</span>{p.name}</h2>
              {rows.length === 0 ? (
                <p className="text-sm text-muted">No check-ins yet. Answer tonight&apos;s question and come back in a couple of weeks.</p>
              ) : (
                <>
                  <p className="text-sm text-muted">{rows.length} check-in{rows.length === 1 ? "" : "s"} · average {avg.toFixed(1)} / 4 · {rows.filter((r) => r.shape.minutes > 0).length} days with video</p>
                  {rows.length < 10 && <p className="text-xs text-muted">Patterns need ~10 check-ins (with and without the thing) before they mean much. Keep going.</p>}
                  {patterns.length > 0 && (
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wide text-muted">Patterns so far</h3>
                      <ul className="mt-1 space-y-1 text-sm">
                        {patterns.slice(0, 6).map((pt) => (
                          <li key={pt.label} className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2">
                            <span><b>{pt.label}</b> <span className="text-muted">· {pt.withN} day{pt.withN === 1 ? "" : "s"} vs {pt.withoutN}</span></span>
                            <span className={`shrink-0 font-extrabold ${pt.delta < 0 ? "text-bad" : "text-ok"}`}>{pt.delta > 0 ? "+" : ""}{pt.delta.toFixed(1)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[11px] text-muted">Difference in average mood on days with vs. without. Correlation, not cause — but it&apos;s your kid, so you&apos;ll know what it means.</p>
                    </div>
                  )}
                  <ul className="flex flex-wrap gap-1">
                    {rows.slice(0, 42).reverse().map((r) => {
                      const m = MOODS.find((x) => x.value === r.mood)!;
                      return <li key={r.day} title={`${r.day}: ${m.label}${r.shape.minutes ? ` · ~${r.shape.minutes} min` : ""}${r.note ? ` · ${r.note}` : ""}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-xl">{m.emoji}</li>;
                    })}
                  </ul>
                </>
              )}
            </Card>
          );
        })}
      </main>
    </>
  );
}
