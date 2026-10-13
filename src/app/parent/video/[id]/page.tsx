import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { CONCERN_LABELS, CONCERN_TAGS, FORMAT_LABELS } from "@/lib/types";
import { Button, Card, ConcernPill, PacePill, Pill, Stars, TopBar } from "@/components/ui";
import { runReview, toggleWhitelist } from "@/app/actions";
import { FeedbackForm } from "./feedback-form";
import { VERDICT_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // parent-triggered reviews run in the background within this budget

export default async function VideoPage(props: PageProps<"/parent/video/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const reviewing = sp.reviewing === "1";
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? `/login?next=/parent/video/${id}` : `/unlock?next=/parent/video/${id}`);
  const fid = viewer.familyId;
  const [lib, settings, confirmations] = await Promise.all([getLibrary(fid), db.getSettings(fid), db.listConfirmations([id])]);
  const v = lib.find((x) => x.id === id);
  if (!v) notFound();
  const blocked = blockedReasons(v, settings);
  const c = v.card;
  const mine = confirmations.find((x) => x.familyId === fid);
  const present = c?.concerns.filter((x) => x.present) ?? [];
  const absent = c?.concerns.filter((x) => !x.present) ?? [];

  return (
    <>
      <TopBar title="Content card" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Library</Link>} />
      <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-4">
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0&modestbranding=1`}
            title={v.title}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight">{v.title}</h1>
            <p className="text-sm text-muted">{v.channel?.title ?? v.channelId}</p>
          </div>
          <form action={toggleWhitelist}>
            <input type="hidden" name="kind" value="video" />
            <input type="hidden" name="targetId" value={v.id} />
            <input type="hidden" name="on" value={v.whitelisted ? "0" : "1"} />
            <Button type="submit" variant={v.whitelisted ? "ghost" : "primary"}>{v.whitelisted ? "✓ Approved" : "Approve"}</Button>
          </form>
        </div>

        {blocked.length > 0 && (
          <Card className="p-3 border-bad/40 bg-bad/5 text-sm">
            <b className="text-bad">Hidden from kid mode</b> — your filters block: {blocked.join(", ")}.
          </Card>
        )}

        {!c ? (
          <Card className="p-6 text-center space-y-3">
            {reviewing ? (
              <>
                <p className="font-bold">Reviewing now…</p>
                <p className="text-sm text-muted">
                  {v.durationSeconds ? `${Math.round(v.durationSeconds / 60)} minutes of video; ` : ""}this can take a few minutes. Refresh to check.
                </p>
              </>
            ) : (
              <>
                <p className="font-bold">No content card yet.</p>
                {v.durationSeconds && v.durationSeconds > 30 * 60 ? (
                  <p className="text-sm text-muted">This one is {Math.round(v.durationSeconds / 60)} minutes long — too long for a kid-triggered check, but you can run it.</p>
                ) : null}
                <form action={runReview}>
                  <input type="hidden" name="videoId" value={v.id} />
                  <Button type="submit">Run AI review</Button>
                </form>
              </>
            )}
          </Card>
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={c.rating} />
                <span className="font-bold">{c.rating}/5</span>
                <Pill className="bg-sky">ages {c.ageFit.min}–{c.ageFit.max}</Pill>
                <PacePill pace={c.pace} />
                <Pill className="bg-line">{FORMAT_LABELS[c.format ?? "other"]}</Pill>
                <Pill className="bg-line">educational {c.educationalValue}/5</Pill>
                {c.reviewer.model === "sample"
                  ? <Pill className="bg-warn/20 text-warn">sample card — not a real review</Pill>
                  : <Pill className="bg-line">AI · {c.reviewer.model} · {Math.round(c.confidence * 100)}% confident</Pill>}
              </div>
              <p>{c.synopsis}</p>
              <p className="font-bold">Parent take: <span className="font-semibold">{c.parentRecommendation}</span></p>
            </Card>

            <Card className="p-4 space-y-3">
              <h2 className="font-extrabold">What&apos;s in it</h2>
              {present.length === 0 && <p className="text-sm text-ok font-bold">Nothing flagged across all {CONCERN_TAGS.length} concern types.</p>}
              <ul className="space-y-2">
                {present.map((f) => (
                  <li key={f.tag} className="text-sm">
                    <ConcernPill f={f} flaggedBy={v.confirmations.flaggedTags[f.tag]} />
                    {f.evidence && <span className="ml-2 text-muted">{f.evidence}</span>}
                    {f.timestamp && (
                      <a className="ml-2 text-accent font-bold" href={`https://www.youtube.com/watch?v=${v.id}&t=${toSeconds(f.timestamp)}s`} target="_blank" rel="noreferrer">
                        jump to {f.timestamp} ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {absent.length > 0 && (
                <p className="text-xs text-muted">Not found: {absent.map((f) => CONCERN_LABELS[f.tag]).join(" · ")}</p>
              )}
            </Card>
          </>
        )}

        <Card className="p-4">
          <h2 className="font-extrabold">Parents say</h2>
          <p className="text-sm text-muted">
            {v.confirmations.agree} agree with the card · {v.confirmations.flag} disputed it
            {mine && <> · <b className="text-ink">you: {VERDICT_LABELS[mine.verdict].toLowerCase()}</b></>}
            {c?.reviewer.revisions ? <> · revised {c.reviewer.revisions}× after feedback</> : null}
            {" · "}<Link href="/parent/reviewer" className="underline">how the reviewer learns</Link>
          </p>
          {sp.thanks === "1" && <p className="mt-2 rounded-xl bg-grass p-2 text-sm font-bold">Thanks — saved. Disputed cards get a second look overnight, and the pattern feeds the reviewer&apos;s calibration notes.</p>}
          <FeedbackForm videoId={v.id} present={present} absent={absent} ageFit={c?.ageFit} mine={mine} kidAge={settings.kidAge} />
          {confirmations.filter((x) => x.note).length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-line pt-3">
              {confirmations.filter((x) => x.note).map((x) => (
                <li key={x.id} className="text-sm">
                  <span className={`font-bold ${x.verdict === "agree" ? "text-ok" : "text-bad"}`}>{x.verdict === "agree" ? "👍" : "⚠"}</span>{" "}
                  {x.note} {x.kidAge ? <span className="text-muted">— parent of a {x.kidAge}-year-old</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}

function toSeconds(ts: string) {
  const p = ts.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0);
}
