import Link from "next/link";
import { UnreviewedConfirm } from "@/app/parent/unreviewed-confirm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { videoForChildren } from "@/lib/queries";
import { reviewEligibility } from "@/lib/gate";
import { CONCERN_LABELS, CONCERN_TAGS, FORMAT_LABELS } from "@/lib/types";
import { Button, Card, ConcernPill, PacePill, Pill, Stars, TopBar } from "@/components/ui";
import { addAndReview, allowVideoForChild, decideVideo, manageFamilyBlock, runReview, unhideForFamily } from "@/app/actions";
import { FeedbackForm } from "./feedback-form";
import { VERDICT_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // parent-triggered reviews run in the background within this budget

export default async function VideoPage(props: PageProps<"/parent/video/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const reviewing = sp.reviewing === "1";
  const unblockAll = sp.unblockAll === "1";
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? `/login?next=/parent/video/${id}` : `/unlock?next=/parent/video/${id}`);
  const fid = viewer.familyId;
  const [view, settings, confirmations] = await Promise.all([videoForChildren(fid, id), db.getSettings(fid), db.listConfirmations([id])]);
  if (!view) notFound();
  const v = view.video;
  const c = v.card;
  const reviewed = reviewEligibility(c).eligible;
  const confirmFor = typeof sp.confirm === "string" ? view.perChild.find((k) => k.profile.id === sp.confirm) : undefined;
  const error = typeof sp.error === "string" ? sp.error : null;
  const mine = confirmations.find((x) => x.familyId === fid);
  const concerns = Array.isArray(c?.concerns) ? c.concerns : []; // a malformed card must not crash the page
  const present = concerns.filter((x) => x.present);
  const absent = concerns.filter((x) => !x.present);

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
            <p className="text-sm text-muted"><Link href={`/parent/channel/${v.channelId}`} className="hover:underline">{v.channel?.title ?? v.channelId}</Link></p>
          </div>
          <LibraryControl videoId={v.id} addedDirectly={view.addedDirectly} channelApproved={view.channelApproved} />
        </div>

        {error && <Card className="p-3 border-bad/40 bg-bad/5 text-sm font-bold text-bad">{error}</Card>}

        {confirmFor && !reviewed && (
          <UnreviewedConfirm
            childName={confirmFor.profile.name} reason={reviewEligibility(c).reason} action={allowVideoForChild}
            fields={{ videoId: v.id, profileId: confirmFor.profile.id }} cancelHref={`/parent/video/${v.id}`}
          />
        )}

        <Card className="p-4">
          <h2 className="font-extrabold">Who can watch this</h2>
          {view.familyBlocked && (
            <div className="mt-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm space-y-2">
              <p><b>Blocked for every child.</b> This block was set before permissions were per child, so no single child&apos;s &ldquo;Allow&rdquo; can get past it.</p>
              {unblockAll ? (
                <div className="space-y-2">
                  <p className="font-bold">Unblocking for everyone means:</p>
                  <ul className="space-y-0.5">
                    {view.perChild.map(({ profile, ifUnblocked }) => (
                      <li key={profile.id}>{profile.avatar} {profile.name}: {ifUnblocked?.allow ? <b className="text-bad">it would play</b> : <>still hidden ({ifUnblocked?.reasons.join(", ")})</>}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="confirm" value="1" /><Button type="submit" variant="danger" className="text-xs px-3 py-1">Unblock for everyone</Button></form>
                    <Link href={`/parent/video/${v.id}`}><Button variant="ghost" className="text-xs px-3 py-1">Cancel</Button></Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="split" /><Button type="submit" variant="ghost" className="text-xs px-3 py-1">Block each child separately</Button></form>
                  <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="remove" /><Button type="submit" variant="ghost" className="text-xs px-3 py-1">Unblock for everyone…</Button></form>
                </div>
              )}
              {!unblockAll && <p className="text-xs text-muted">&ldquo;Block each child separately&rdquo; keeps it blocked for every child you have now, then lets you change one child at a time. Children you add later won&apos;t be blocked automatically.</p>}
            </div>
          )}
          <ul className="mt-2 divide-y divide-line">
            {view.perChild.map(({ profile, v: kv, decision, childBlocked }) => (
              <li key={profile.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="text-xl">{profile.avatar}</span>
                <span className="font-bold">{profile.name}</span>
                <span className={`min-w-0 basis-full sm:basis-0 sm:flex-1 order-last sm:order-none ${decision.allow ? "text-ok" : "text-muted"}`}>
                  {decision.allow
                    ? decision.basis === "explicit" ? "Plays — you allowed it" : decision.basis === "open" ? "Plays — passes the review (Open mode)" : "Plays — reviewed and passes their rules"
                    : view.familyBlocked ? "Doesn't play: blocked for every child"
                    : childBlocked ? `Doesn't play: you chose Never for ${profile.name}`
                    : `Doesn't play: ${decision.reasons.join(", ")}`}
                </span>
                {view.familyBlocked ? null : kv.overridden ? (
                  <form action={allowVideoForChild}>
                    <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="undo" value="1" />
                    <Button type="submit" variant="ghost" className="text-xs px-3 py-1">Undo allow</Button>
                  </form>
                ) : (
                  <>
                  {(kv.dismissed || childBlocked) && (
                    <form action={decideVideo}>
                      <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="decision" value="undo" />
                      <input type="hidden" name="next" value={`/parent/video/${v.id}`} />
                      <Button type="submit" variant="ghost" className="text-xs px-3 py-1">{childBlocked ? "Undo Never" : "Stop keeping hidden"}</Button>
                    </form>
                  )}
                  {!decision.allow && (
                  <form action={allowVideoForChild}>
                    <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} />
                    <Button type="submit" variant="ghost" className="text-xs px-3 py-1">Allow for {profile.name}{!reviewed ? " (unreviewed)" : ""}</Button>
                  </form>
                  )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {v.dismissed && (
            <form action={unhideForFamily} className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <input type="hidden" name="videoId" value={v.id} />
              <span>Kept hidden for every child (decided before per-child permissions).</span>
              <button type="submit" className="font-bold text-ink hover:underline">Stop keeping hidden for everyone</button>
            </form>
          )}
          <p className="mt-2 text-xs text-muted">&ldquo;Allow for&rdquo; is just for that child, and overrides the review and their filters for this one video. &ldquo;Keep hidden&rdquo; holds until you change it, even if the review or the filters change later.</p>
        </Card>

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

/** Library source control: "Add & review" adds the video and starts its review — it does not, by itself, let anyone watch it. */
function LibraryControl({ videoId, addedDirectly, channelApproved }: { videoId: string; addedDirectly: boolean; channelApproved: boolean }) {
  if (channelApproved && !addedDirectly) return <span className="shrink-0 text-xs text-muted text-right">In your library<br />via an approved channel</span>;
  return (
    <form action={addAndReview} className="shrink-0 text-right">
      <input type="hidden" name="videoId" value={videoId} />
      {addedDirectly ? (
        <>
          <input type="hidden" name="remove" value="1" />
          <span className="block text-xs text-muted">In your library</span>
          <button type="submit" className="text-xs font-bold text-muted hover:text-bad">Remove</button>
        </>
      ) : (
        <Button type="submit">Add &amp; review</Button>
      )}
    </form>
  );
}
