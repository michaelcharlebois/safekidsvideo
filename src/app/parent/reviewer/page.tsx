import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { feedbackStats, isDisagreement } from "@/lib/learn";
import { CONCERN_LABELS, CONCERN_TAGS, VERDICT_LABELS } from "@/lib/types";
import { Button, Card, TopBar } from "@/components/ui";
import { learnNow, saveReviewerNotes } from "@/app/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How the AI reviewer is doing against parents, and the calibration notes it learns from. */
export default async function ReviewerPage(props: PageProps<"/parent/reviewer">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/reviewer" : "/unlock?next=/parent/reviewer");
  const admin = v.admin;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString(); // eslint-disable-line react-hooks/purity -- server component
  const [stats, notes, history, recent, recentCards] = await Promise.all([
    feedbackStats(90), db.getReviewerNotes(), db.listReviewerNotes(5), db.listAllConfirmations(monthAgo), db.listCardsSince(monthAgo),
  ]);
  const spend = spendByDay(recentCards);
  const disputes = recent.filter(isDisagreement).slice(0, 12);
  const videos = new Map((await Promise.all(disputes.map((d) => db.getVideo(d.videoId)))).filter(Boolean).map((x) => [x!.id, x!]));
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
  const tagRows = CONCERN_TAGS.map((t) => ({ t, ...(stats.perTag[t] ?? { agree: 0, overcall: 0, missed: 0 }) })).filter((r) => r.agree + r.overcall + r.missed > 0);

  return (
    <>
      <TopBar title="Reviewer" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Dashboard</Link>} />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-4">
        {sp.learning === "1" && <Card className="p-3 bg-grass text-sm font-bold">Learning in the background — new notes and any re-reviews land within a few minutes. Refresh to see them.</Card>}
        {sp.saved === "1" && <Card className="p-3 bg-grass text-sm font-bold">Notes saved. Every review from now on uses them.</Card>}
        {sp.error === "admin" && <Card className="p-3 border-bad/40 bg-bad/5 text-sm font-bold">Only a Sift admin can change the shared reviewer notes. Your feedback on individual cards still counts.</Card>}

        <Card className="p-4">
          <h2 className="font-extrabold">How parents rate the cards <span className="text-muted font-bold">· last 90 days</span></h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Accurate" value={pct(stats.agree, stats.confirmations)} sub={`${stats.agree} of ${stats.confirmations}`} />
            <Stat label="Too strict" value={pct(stats.tooStrict, stats.confirmations)} sub={`${stats.tooStrict}`} />
            <Stat label="Too lenient" value={pct(stats.tooLenient, stats.confirmations)} sub={`${stats.tooLenient}`} />
          </div>
          {tagRows.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-muted"><th className="py-1">Tag</th><th>Fair</th><th>Over-called</th><th>Missed</th></tr></thead>
              <tbody>
                {tagRows.map((r) => (
                  <tr key={r.t} className="border-t border-line">
                    <td className="py-1 font-bold">{CONCERN_LABELS[r.t]}</td><td>{r.agree}</td>
                    <td className={r.overcall > r.agree ? "text-bad font-bold" : ""}>{r.overcall}</td>
                    <td className={r.missed > r.agree ? "text-bad font-bold" : ""}>{r.missed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted">Age range votes — fine for younger: {stats.age.younger} · about right: {stats.age.right} · needs older: {stats.age.older}</p>
        </Card>

        <Card className="p-4">
          <h2 className="font-extrabold">Spend <span className="text-muted font-bold">· last 30 days, estimated</span></h2>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Reviews" value={String(spend.reviews)} sub={`${spend.metered} metered`} />
            <Stat label="Total" value={`$${spend.total.toFixed(2)}`} sub={`$${spend.perReview.toFixed(3)} / review`} />
            <Stat label="Per day" value={`$${spend.perDay.toFixed(2)}`} sub={`${spend.days} active day${spend.days === 1 ? "" : "s"}`} />
          </div>
          {spend.byDay.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1 text-[11px] text-muted">
              {spend.byDay.slice(-14).map(([d, c]) => <li key={d} className="rounded bg-surface px-1.5 py-0.5">{d.slice(5)} ${c.toFixed(2)}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Priced from token counts at the rates in GEMINI_PRICE_*; nightly discovery stops at DISCOVERY_BUDGET_USD.</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-extrabold">Calibration notes {notes ? <span className="text-muted font-bold">· v{notes.version} · {notes.source === "learn" ? "learned" : "edited by a parent"}</span> : null}</h2>
              <p className="text-sm text-muted">Appended to the reviewer&apos;s instructions on every review. Rewritten nightly from new feedback; disputed cards get re-reviewed with the dispute in hand. Edit by hand if you know something it doesn&apos;t.</p>
            </div>
            {admin && <form action={learnNow}><Button type="submit" variant="ghost">Learn now</Button></form>}
          </div>
          {admin ? (
            <form action={saveReviewerNotes} className="mt-3 space-y-2">
              <textarea name="notes" rows={10} defaultValue={notes?.notes ?? ""} placeholder={"- Nothing learned yet. Dispute a few cards, then press Learn now — or write rules here, e.g.\n- Channel branding intros and outros are not commercialism."} className="w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent" />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{history.length > 1 ? `Previous versions: ${history.slice(1).map((h) => `v${h.version}`).join(", ")}` : ""}</span>
                <Button type="submit">Save notes</Button>
              </div>
            </form>
          ) : (
            <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-surface p-3 font-mono text-xs">{notes?.notes ?? "Nothing learned yet."}</pre>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-extrabold">Recent disputes</h2>
          {disputes.length === 0 ? <p className="mt-1 text-sm text-muted">None in the last 30 days.</p> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {disputes.map((d) => {
                const vid = videos.get(d.videoId);
                const votes = Object.entries(d.tagVotes ?? {}).filter(([, x]) => x !== "agree").map(([t, x]) => `${CONCERN_LABELS[t as keyof typeof CONCERN_LABELS]} ${x}`);
                return (
                  <li key={d.id} className="py-2">
                    <Link href={`/parent/video/${d.videoId}`} className="font-bold hover:underline">{vid?.title ?? d.videoId}</Link>
                    <p className="text-muted">{VERDICT_LABELS[d.verdict]}{votes.length ? ` · ${votes.join(", ")}` : ""}{d.ageVote && d.ageVote !== "right" ? ` · age too ${d.ageVote === "younger" ? "cautious" : "permissive"}` : ""}{d.note ? ` · “${d.note}”` : ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}

function spendByDay(cards: { reviewer: { reviewedAt: string }; usage?: { costUsd: number } }[]) {
  const by = new Map<string, number>();
  let total = 0, metered = 0;
  for (const c of cards) {
    if (!c.usage) continue;
    metered++;
    total += c.usage.costUsd;
    const d = c.reviewer.reviewedAt.slice(0, 10);
    by.set(d, (by.get(d) ?? 0) + c.usage.costUsd);
  }
  const byDay = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { reviews: cards.length, metered, total, perReview: metered ? total / metered : 0, days: byDay.length, perDay: byDay.length ? total / byDay.length : 0, byDay };
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-surface p-3">
      <p className="text-2xl font-extrabold">{value}</p>
      <p className="text-xs font-bold">{label}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}
