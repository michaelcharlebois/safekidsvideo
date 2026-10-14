import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { videoForChildren } from "@/lib/queries";
import { isFound, reviewEligibility } from "@/lib/gate";
import { playStatus } from "@/lib/status";
import { backLink } from "@/lib/back";
import { holdExplanation } from "@/lib/explain";
import { VERDICT_LABELS } from "@/lib/types";
import type { AuthDecision } from "@/lib/gate";
import { Button, buttonClass, Card, Notice, StatusBadge } from "@/components/ui";
import { IconChevron, IconKids, IconReview, IconShield } from "@/components/icons";
import { addAndReview, allowVideoForChild, decideVideo, manageFamilyBlock, runReview, unhideForFamily } from "@/app/actions";
import { UnreviewedConfirm } from "@/app/parent/unreviewed-confirm";
import { Assessment, eligibilityNote } from "@/app/parent/assessment";
import { FeedbackForm } from "./feedback-form";
import { VideoPreview } from "./preview";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // parent-triggered reviews run in the background within this budget

/**
 * One video. Three separate things, kept visually separate:
 *   Who can watch this — each child's status from the gate, and whether it comes from the AI review
 *                         passing their settings or from a parent's explicit decision (with the actions).
 *   AI review           — the assessment itself, with its uncertainty.
 *   Other parents       — their feedback; and, apart from it, your own feedback on the review.
 * Phone: decision first; the player loads only when tapped; the review follows.
 * Desktop: the decision column sits beside the review.
 */
export default async function VideoPage(props: PageProps<"/parent/video/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  // "Reviewing now" only with evidence: the add/run action stamps when it started a review job. After 15
  // minutes with no review stored, the job didn't finish, and the page says so instead of waiting forever.
  // There is no stored job state for an AI review, so the page never claims one is running or has failed.
  // `?reviewing=1` only means this visit followed a request that started one.
  const requested = sp.reviewing === "1";
  const unblockAll = sp.unblockAll === "1";
  const back = backLink(sp);
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? `/login?next=/parent/video/${id}` : `/unlock?next=/parent/video/${id}`);
  const fid = viewer.familyId;
  const [view, settings, confirmations] = await Promise.all([videoForChildren(fid, id), db.getSettings(fid), db.listConfirmations([id])]);
  if (!view) notFound();
  const v = view.video;
  const c = v.card;
  const reviewed = reviewEligibility(c).eligible;
  const confirmFor = typeof sp.confirm === "string" ? view.perChild.find((k) => k.profile.id === sp.confirm) : undefined;
  const allowedFor = typeof sp.allowed === "string" ? view.perChild.find((k) => k.profile.id === sp.allowed)?.profile : undefined;
  const error = typeof sp.error === "string" ? sp.error : null;
  const mine = confirmations.find((x) => x.familyId === fid);
  const others = confirmations.filter((x) => x.familyId !== fid);
  const concerns = Array.isArray(c?.concerns) ? c.concerns : []; // a malformed card must not crash the page
  const present = concerns.filter(isFound);
  const absent = concerns.filter((x) => !isFound(x));
  const othersAgree = others.filter((x) => x.verdict === "agree").length;

  const who = (
    <Card as="section" raised className="overflow-hidden" >
      <div className="border-b border-sand px-5 py-4">
        <h2 className="flex items-center gap-2 text-lg"><IconKids size={20} />Who can watch this</h2>
        <p className="mt-0.5 text-sm text-muted">Each child is decided separately.</p>
      </div>

      {view.familyBlocked && (
        <div className="border-b border-sand bg-bad-soft/60 px-5 py-4 text-sm space-y-2">
          <p><b className="text-bad">Blocked for every child.</b> This block was set before permissions were per child, so no single child&apos;s &ldquo;Allow&rdquo; can get past it. It also applies to any child you add later, until you change it.</p>
          {unblockAll ? (
            <div className="space-y-2">
              <p className="font-bold">Unblocking for everyone means:</p>
              <ul className="space-y-0.5">
                {view.perChild.map(({ profile, ifUnblocked }) => (
                  <li key={profile.id}>{profile.avatar} {profile.name}: {ifUnblocked?.allow ? <b className="text-bad">it would play</b> : <>still not playing ({ifUnblocked?.reasons.join(", ")})</>}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="confirm" value="1" /><Button type="submit" variant="danger" size="sm">Unblock for everyone</Button></form>
                <Link href={`/parent/video/${v.id}`} className={buttonClass("quiet", "sm")}>Cancel</Link>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="split" /><Button type="submit" variant="secondary" size="sm">Block each child separately</Button></form>
                <form action={manageFamilyBlock}><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="op" value="remove" /><Button type="submit" variant="quiet" size="sm">Unblock for everyone…</Button></form>
              </div>
              <p className="text-xs text-muted">&ldquo;Block each child separately&rdquo; keeps it blocked for every child you have now, then lets you change one child at a time. Children you add later won&apos;t be blocked by it.</p>
            </>
          )}
        </div>
      )}

      <ul className="divide-y divide-sand">
        {view.perChild.map(({ profile, settings: s, v: kv, decision, childBlocked }) => {
          const st = playStatus(kv, s).status;
          const autoHeld = st === "held" || st === "uncertain" || st === "reviewing";
          return (
            <li key={profile.id} className="space-y-2 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-xl ring-1 ring-sand" aria-hidden>{profile.avatar}</span>
                <span className="font-bold text-forest">{profile.name}</span>
                <span className="ml-auto"><StatusBadge status={st} /></span>
              </div>
              <p className="text-sm text-ink">{explain(profile.name, decision, view.familyBlocked, childBlocked, kv.dismissed, holdExplanation(kv, s)?.summary)}</p>
              {!view.familyBlocked && (
                <div className="flex flex-wrap gap-2">
                  {kv.overridden ? (
                    <form action={allowVideoForChild}>
                      <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="undo" value="1" />
                      <Button type="submit" variant="secondary" size="sm">Undo allow</Button>
                    </form>
                  ) : (
                    <>
                      {!decision.allow && (
                        <form action={allowVideoForChild}>
                          <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} />
                          {/* An automatic hold gets a deliberate, secondary exception, read after the findings. */}
                          {autoHeld
                            ? <Button type="submit" variant="secondary" size="sm">Allow exception for {profile.name}{reviewed ? "" : " (not reviewed)"}</Button>
                            : <Button type="submit" size="sm">Allow for {profile.name}{reviewed ? "" : " (not reviewed)"}</Button>}
                        </form>
                      )}
                      {autoHeld && st === "held" && <a href="#ai-review" className={buttonClass("quiet", "sm")}>What the review found</a>}
                      {(kv.dismissed || childBlocked) && (
                        <form action={decideVideo}>
                          <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={profile.id} /><input type="hidden" name="decision" value="undo" />
                          <input type="hidden" name="next" value={`/parent/video/${v.id}`} />
                          <Button type="submit" variant="secondary" size="sm">{childBlocked ? `Undo Never for ${profile.name}` : "Stop keeping hidden"}</Button>
                        </form>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {v.dismissed && (
        <form action={unhideForFamily} className="flex flex-wrap items-center gap-2 border-t border-sand px-5 py-3 text-xs text-muted">
          <input type="hidden" name="videoId" value={v.id} />
          <span>Kept hidden for every child (decided before per-child permissions).</span>
          <button type="submit" className="font-bold text-forest underline">Stop keeping hidden for everyone</button>
        </form>
      )}
      <details className="border-t border-sand px-5 py-2.5 text-xs text-muted">
        <summary className="cursor-pointer font-bold text-forest">What&apos;s the difference?</summary>
        <p className="mt-1.5"><b className="text-forest">Passes the AI review</b> means the review exists, is confident, and nothing in it conflicts with that child&apos;s settings. <b className="text-forest">Allowed by you</b> is your decision for one child, and plays even if the review or settings would hold it back.</p>
      </details>
    </Card>
  );

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-8">
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-forest"><IconChevron size={16} className="rotate-180" />{back.label}</Link>

      {/* ---- title + library source ---- */}
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl leading-tight sm:text-title">{v.title}</h1>
          <p className="text-sm text-muted"><Link href={`/parent/channel/${v.channelId}`} className="hover:underline">{v.channel?.title ?? v.channelId}</Link></p>
        </div>
        <LibraryControl videoId={v.id} addedDirectly={view.addedDirectly} channelApproved={view.channelApproved} />
      </header>

      <div className="mt-4 space-y-3">
        {error && <Notice tone="bad">{error}</Notice>}
        {sp.added === "1" && (
          <Notice tone="ok">
            Added to your family&apos;s sources.{" "}
            {reviewed ? "Each child's settings decide whether it plays: see Who can watch this." : requested ? "An AI review was requested. Until a review is stored and passes, it won't play for any child unless you allow it." : "It hasn't been reviewed, so it won't play for any child unless you allow it."}
          </Notice>
        )}
        {sp.removed === "1" && <Notice tone="ok">Removed from your family&apos;s sources. A child you allowed it for can still watch it.</Notice>}
        {allowedFor && <Notice tone="ok">{sp.undone === "1" ? `Undone. ${allowedFor.name} is back to the normal rules for this video.` : `Allowed for ${allowedFor.name}.`}</Notice>}
        {confirmFor && !reviewed && (
          <UnreviewedConfirm childName={confirmFor.profile.name} reason={reviewEligibility(c).reason} action={allowVideoForChild}
            fields={{ videoId: v.id, profileId: confirmFor.profile.id }} cancelHref={`/parent/video/${v.id}`} />
        )}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-8">
        {/* Decision column: first on a phone, right-hand and sticky on desktop. */}
        <aside className="lg:order-2 lg:sticky lg:top-6">{who}</aside>

        <div className="min-w-0 space-y-6 lg:order-1">
          <VideoPreview id={v.id} title={v.title} thumbnailUrl={v.thumbnailUrl} duration={v.durationSeconds} />

          {/* ---- AI review ---- */}
          <Card as="section" className="scroll-mt-20 p-5" >
            <div id="ai-review" className="relative -top-20" aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg"><IconReview size={20} />AI review</h2>
              {c?.reviewer?.model && c.reviewer.model !== "sample" && (
                <p className="text-xs text-muted">Reviewed {c.reviewer.reviewedAt?.slice(0, 10)}{c.reviewer.revisions ? `, revised ${c.reviewer.revisions}× after parent feedback` : ""}</p>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">What an AI found watching the whole video. It&apos;s an assessment, not a guarantee.</p>
            <div className="mt-4">
              {!c ? (
                <div className="space-y-3 text-sm">
                  <Notice tone="warn">{eligibilityNote(undefined)}</Notice>
                  {requested && <p className="font-bold text-ink">Review requested. No completed review yet.</p>}
                  {requested && <p className="text-muted">Reviews usually take a few minutes{v.durationSeconds ? ` (this video is ${Math.round(v.durationSeconds / 60)} minutes long)` : ""}. Refresh later to see whether one has been stored.</p>}
                  <form action={runReview} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="videoId" value={v.id} />
                    <Button type="submit" variant={requested ? "secondary" : "primary"} size={requested ? "sm" : "md"}>{requested ? "Request the review again" : "Run the AI review"}</Button>
                    {v.durationSeconds && v.durationSeconds > 30 * 60 ? <span className="text-muted">It&apos;s {Math.round(v.durationSeconds / 60)} minutes long, too long for a kid-triggered check.</span> : null}
                  </form>
                </div>
              ) : (
                <>
                  <Assessment v={v} />
                  {!reviewed && (
                    <form action={runReview} className="mt-3"><input type="hidden" name="videoId" value={v.id} /><Button type="submit" variant="secondary" size="sm">Run the AI review again</Button></form>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* ---- other parents ---- */}
          <Card as="section" className="p-5">
            <h2 className="text-lg">Other parents</h2>
            {others.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No other families have given feedback on this review yet.</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">{othersAgree} of {others.length} found the review accurate. Parents can only make a review stricter, never clear something the AI found.</p>
                {others.some((x) => x.note) && (
                  <ul className="mt-3 space-y-2">
                    {others.filter((x) => x.note).map((x) => (
                      <li key={x.id} className="rounded-xl bg-sand-soft px-3 py-2 text-sm">
                        <span className={`font-bold ${x.verdict === "agree" ? "text-ok" : "text-warn"}`}>{VERDICT_LABELS[x.verdict]}. </span>
                        {x.note} {x.kidAge ? <span className="text-muted">(parent of a {x.kidAge}-year-old)</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>

          {/* ---- your feedback (only once there's a review to give feedback on) ---- */}
          {c && <Card as="section" className="p-5">
            <h2 className="text-lg">Your feedback on the review</h2>
            <p className="mt-1 text-sm text-muted">
              {mine ? <>You said: <b className="text-ink">{VERDICT_LABELS[mine.verdict].toLowerCase()}</b>. Change it any time. </> : null}
              Disputed reviews get a second look overnight. <Link href="/parent/reviewer" className="font-bold text-forest underline">How the reviewer learns</Link>
            </p>
            {sp.thanks === "1" && <Notice tone="ok" className="mt-3">Saved. Thanks for helping the reviewer get better.</Notice>}
            <FeedbackForm videoId={v.id} present={present} absent={absent} ageFit={c?.ageFit} mine={mine} kidAge={settings.kidAge} />
          </Card>}
        </div>
      </div>
    </main>
  );
}

/** One sentence per child: what's deciding it, in the words the parent uses (no "safe"). */
function explain(name: string, d: AuthDecision, familyBlocked: boolean, childBlocked: boolean, keptHidden: boolean, hold?: string): ReactNode {
  if (familyBlocked) return "Blocked for every child.";
  if (d.allow) {
    if (d.basis === "explicit") return <>You allowed it for {name}. <span className="text-muted">This overrides the AI review and {name}&apos;s settings for this one video.</span></>;
    if (d.basis === "open") return <>Passes the AI review against {name}&apos;s settings. <span className="text-muted">Plays because {name} is in Open mode.</span></>;
    return <>Passes the AI review against {name}&apos;s settings. <span className="text-muted">It&apos;s in your library.</span></>;
  }
  if (childBlocked) return `You chose Never for ${name}.`;
  if (keptHidden) return `You chose to keep it hidden from ${name}. That holds even if the review or settings change.`;
  if (hold) return <>Doesn&apos;t play for {name}. <span className="text-muted">{hold}</span></>;
  return <>Doesn&apos;t play for {name}: <span className="text-muted">{d.reasons.join(", ")}.</span></>;
}

/** Library source control: "Add & review" adds the video and starts its review — it does not, by itself, let anyone watch it. */
function LibraryControl({ videoId, addedDirectly, channelApproved }: { videoId: string; addedDirectly: boolean; channelApproved: boolean }) {
  if (channelApproved && !addedDirectly) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1.5 text-xs font-bold text-forest"><IconShield size={14} />In your library through its channel</span>;
  }
  return (
    <form action={addAndReview} className="flex items-center gap-2">
      <input type="hidden" name="videoId" value={videoId} />
      {addedDirectly ? (
        <>
          <input type="hidden" name="remove" value="1" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1.5 text-xs font-bold text-forest"><IconShield size={14} />In your library</span>
          <Button type="submit" variant="quiet" size="sm">Remove</Button>
        </>
      ) : (
        <Button type="submit" variant="secondary" size="sm">Add &amp; review</Button>
      )}
    </form>
  );
}
