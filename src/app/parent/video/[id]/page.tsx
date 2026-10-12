import Link from "next/link";
import { notFound } from "next/navigation";
import { db, DEFAULT_FAMILY_ID } from "@/lib/db";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { CONCERN_LABELS, CONCERN_TAGS } from "@/lib/types";
import { Button, Card, ConcernPill, PacePill, Pill, Stars, TopBar } from "@/components/ui";
import { confirmCard, toggleWhitelist } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function VideoPage(props: PageProps<"/parent/video/[id]">) {
  const { id } = await props.params;
  const fid = DEFAULT_FAMILY_ID;
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
            <b className="text-bad">Hidden from kid mode</b> — your filters block: {blocked.map((t) => CONCERN_LABELS[t]).join(", ")}.
          </Card>
        )}

        {!c ? (
          <Card className="p-6 text-center">
            <p className="font-bold">No content card yet.</p>
            <p className="text-sm text-muted mt-1">Run <code className="bg-line px-1 rounded">npm run review -- {v.id}</code> to generate one.</p>
          </Card>
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Stars value={c.rating} />
                <span className="font-bold">{c.rating}/5</span>
                <Pill className="bg-sky">ages {c.ageFit.min}–{c.ageFit.max}</Pill>
                <PacePill pace={c.pace} />
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
            {v.confirmations.agree} agree with the card · {v.confirmations.flag} flagged something
            {mine && <> · <b className="text-ink">you {mine.verdict === "agree" ? "agreed" : "flagged"}</b></>}
          </p>
          <form action={confirmCard} className="mt-3 space-y-3">
            <input type="hidden" name="videoId" value={v.id} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="verdict" value="agree" variant="primary">👍 Card is accurate</Button>
              <Button type="submit" name="verdict" value="flag" variant="danger">⚠ Flag something</Button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-bold text-muted">What should be flagged? (optional)</summary>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {CONCERN_TAGS.map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="checkbox" name={`tag:${t}`} defaultChecked={mine?.tags?.includes(t)} className="accent-accent" />
                    {CONCERN_LABELS[t]}
                  </label>
                ))}
              </div>
            </details>
            <textarea name="note" rows={2} defaultValue={mine?.note} placeholder="Two lines for other parents (optional)" className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
            <label className="flex items-center gap-2 text-sm text-muted">
              My kid is <input type="number" name="kidAge" min={1} max={14} defaultValue={mine?.kidAge ?? settings.kidAge} className="w-14 rounded-lg border border-line px-2 py-1" />
            </label>
          </form>
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
