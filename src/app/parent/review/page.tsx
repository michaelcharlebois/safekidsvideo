import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrariesFor } from "@/lib/queries";
import { REASON, reviewEligibility } from "@/lib/gate";
import { listPendingRequests } from "@/lib/activity";
import { forChild, inboxOrder, isChildRequest, pendingDecisions, type InboxItem } from "@/lib/inbox";
import type { FamilySettings, Profile, VideoWithCard } from "@/lib/types";
import { Button, buttonClass, Card, EmptyState, Notice } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconHand, IconReview } from "@/components/icons";
import { decideVideo, resolveLegacyAction, resolveWatchRequest } from "@/app/actions";
import { UnreviewedConfirm } from "@/app/parent/unreviewed-confirm";
import { Assessment, eligibilityNote } from "@/app/parent/assessment";
import { detailHref } from "@/lib/back";
import { holdExplanation, type Evidence } from "@/lib/explain";

export const dynamic = "force-dynamic";

const PAGE = 25;
const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

/**
 * Review: the parent's inbox of permission decisions that are actually waiting (lib/inbox.ts — the same list
 * the Review badge counts): requests children made, older requests that didn't record a child, and approval
 * records from before per-child permissions. Videos held back automatically are not here; they're in
 * Library. Actions keep their exact meaning; unreviewed allows still go through the server-enforced
 * confirmation.
 */
export default async function ReviewPage(props: PageProps<"/parent/review">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/review" : "/unlock?next=/parent/review");
  const fid = v.familyId;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const [profiles, requests, legacy] = await Promise.all([db.listProfiles(fid), listPendingRequests(fid), db.listLegacyGrants(fid)]);
  const kidFilter = profiles.find((p) => p.id === str("kid"));
  const all = pendingDecisions({ requests, childIds: profiles.map((p) => p.id), legacy }).sort(inboxOrder);
  const items = kidFilter ? forChild(all, kidFilter.id) : all;
  const shown = str("all") === "1" ? items : items.slice(0, PAGE);
  // Only the videos on this page are joined with their reviews and grants (no catalogue scan).
  const children = await getLibrariesFor(fid, shown.map((i) => i.videoId));
  const asked = all.filter(isChildRequest).length;
  const older = all.length - asked;
  const here = `/parent/review${kidFilter ? `?kid=${kidFilter.id}` : ""}`;
  const error = str("error") || null;

  // Videos as each child sees them (flags are per child); any child's copy carries the shared facts.
  const videoFor = (videoId: string, profileId: string | null): VideoWithCard | undefined =>
    (profileId ? children.find((c) => c.profile.id === profileId)?.lib.find((x) => x.id === videoId) : undefined)
    ?? children[0]?.lib.find((x) => x.id === videoId);
  const settingsFor = (profileId: string) => children.find((c) => c.profile.id === profileId)?.settings;

  // The unreviewed-video disclosure, when an "Allow" needs the parent's explicit confirmation.
  const confirmVideo = str("confirm") ? await db.getVideo(str("confirm")) : undefined;
  const confirmKid = profiles.find((p) => p.id === str("for"));
  const via = str("via");
  const confirm = confirmVideo && confirmKid && ["request", "queue", "legacy"].includes(via)
    ? {
        kid: confirmKid, video: confirmVideo, reason: reviewEligibility(await db.getCard(confirmVideo.id)).reason,
        action: via === "request" ? resolveWatchRequest : via === "legacy" ? resolveLegacyAction : decideVideo,
        fields: (via === "request" ? { requestId: str("ref"), decision: "approve", profileId: confirmKid.id, next: here }
          : via === "legacy" ? { legacyId: str("ref"), allowFor: confirmKid.id }
          : { videoId: confirmVideo.id, profileId: confirmKid.id, decision: "allow", next: here }) as Record<string, string>,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      <header>
        <h1 className="text-title sm:text-display">Review</h1>
        <p className="text-sm text-muted sm:text-base">
          {all.length === 0 ? "Nothing is waiting on you."
            : [asked ? `${asked} request${asked === 1 ? "" : "s"} from your children` : null, older ? `${older} older record${older === 1 ? "" : "s"} to sort out` : null].filter(Boolean).join(", ") + "."}
        </p>
      </header>

      {profiles.length > 1 && (
        <nav aria-label="Show decisions for" className="mt-5 flex flex-wrap gap-1.5">
          <Chip href="/parent/review" active={!kidFilter}>Everyone <Count n={all.length} /></Chip>
          {profiles.map((p) => (
            <Chip key={p.id} href={`/parent/review?kid=${p.id}`} active={kidFilter?.id === p.id}><span aria-hidden>{p.avatar}</span>{p.name} <Count n={forChild(all, p.id).length} /></Chip>
          ))}
        </nav>
      )}

      <div className="mt-5 space-y-4">
        {items.length > 0 && (
          <details className="rounded-[var(--radius-card)] border border-sand bg-surface text-sm">
            <summary className="cursor-pointer px-4 py-3 font-bold text-forest">What each choice does</summary>
            <dl className="grid gap-x-6 gap-y-2 border-t border-sand px-4 py-3 sm:grid-cols-2">
              <div><dt className="font-bold text-forest">Allow for a child</dt><dd className="text-muted">Plays for that child only, even if the AI review or their settings would hold it back.</dd></div>
              <div><dt className="font-bold text-forest">Not now</dt><dd className="text-muted">Turns down a request. It doesn&apos;t change what the child can watch.</dd></div>
              <div><dt className="font-bold text-forest">Don&apos;t allow</dt><dd className="text-muted">Closes an old approval record without giving any child access.</dd></div>
              <div><dt className="font-bold text-forest">Keep hidden or Never</dt><dd className="text-muted">Standing restrictions for one child. They&apos;re on each video&apos;s page and in <Link href="/parent/library" className="font-bold text-forest underline">Library</Link>.</dd></div>
            </dl>
          </details>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        {confirm && <UnreviewedConfirm childName={confirm.kid.name} title={confirm.video.title} reason={confirm.reason} action={confirm.action} fields={confirm.fields} cancelHref={here} />}

        {items.length === 0 ? (
          <Card>
            <EmptyState icon={<IconCheck />} title={kidFilter ? `Nothing waiting for ${kidFilter.name}` : "Nothing waiting on you"}
              action={<Link href="/parent" className={buttonClass("secondary")}>Back to Home</Link>}>
              When a child asks for a video, it shows up here. Videos a child&apos;s settings hold back automatically aren&apos;t tasks: you can browse and change them in <Link href={`/parent/library${kidFilter ? `?kid=${kidFilter.id}` : ""}`} className="font-bold text-forest underline">Library</Link>.
            </EmptyState>
          </Card>
        ) : (
          <ul className="space-y-4">
            {shown.map((item) => {
              const childId = item.kind === "legacy" ? null : item.profileId;
              return (
                <li key={item.key}>
                  <InboxCard item={item} v={videoFor(item.videoId, childId)} child={profiles.find((p) => p.id === childId)}
                    settings={childId ? settingsFor(childId) : undefined} profiles={profiles} next={here} />
                </li>
              );
            })}
          </ul>
        )}
        {shown.length < items.length && (
          <p className="text-center"><Link href={`${here}${kidFilter ? "&" : "?"}all=1`} className={buttonClass("secondary")}>Show all {items.length}</Link></p>
        )}
      </div>
    </main>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${active ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink hover:border-forest/40"}`}>
      {children}
    </Link>
  );
}
const Count = ({ n }: { n: number }) => <span className="opacity-70">{n}</span>;

/** Where a decision came from. */
function Origin({ item }: { item: InboxItem }) {
  if (isChildRequest(item)) return <span className="inline-flex items-center gap-1 rounded-full bg-apricot-soft px-2.5 py-1 text-xs font-bold text-apricot-ink"><IconHand size={14} />Child&apos;s request</span>;
  if (item.kind === "request") return <span className="inline-flex items-center gap-1 rounded-full bg-sand-soft px-2.5 py-1 text-xs font-bold text-muted"><IconClock size={14} />Older request</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-sand-soft px-2.5 py-1 text-xs font-bold text-muted"><IconClock size={14} />Old approval record</span>;
}

const toSeconds = (ts: string) => { const p = ts.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0); };

/** Compact evidence: what, how strong, when, and who said so. */
function EvidenceList({ items, videoId }: { items: Evidence[]; videoId: string }) {
  return (
    <ul className="space-y-1.5" aria-label="Why it's held back">
      {items.slice(0, 3).map((e) => (
        <li key={e.label} className="rounded-xl border border-sand bg-surface px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-bold text-forest">{e.label}</span>
            {e.severity && <span className={`rounded-full px-2 text-xs font-bold ${e.severity === "Strong" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>{e.severity}</span>}
            {e.timestamp && (
              <a href={`https://www.youtube.com/watch?v=${videoId}&t=${toSeconds(e.timestamp)}s`} target="_blank" rel="noreferrer" className="text-xs font-bold text-forest underline decoration-sand underline-offset-2">at {e.timestamp}</a>
            )}
            <span className="ml-auto text-xs text-muted">
              {e.source === "ai" ? (e.parents ? `AI review, and ${e.parents} parents` : "AI review") : e.source === "parents" ? `Flagged by ${e.parents} other parent${e.parents === 1 ? "" : "s"}` : "Your settings"}
            </span>
          </div>
          {e.evidence && <p className="mt-0.5 text-muted line-clamp-2">{e.evidence}</p>}
        </li>
      ))}
      {items.length > 3 && <li className="text-xs text-muted">{items.length - 3} more on the video&apos;s page</li>}
    </ul>
  );
}

function ChildChip({ p }: { p?: Pick<Profile, "name" | "avatar"> }) {
  return p
    ? <span className="inline-flex items-center gap-1.5 rounded-full border border-sand bg-surface px-2.5 py-1 text-xs font-bold text-forest"><span aria-hidden>{p.avatar}</span>{p.name}</span>
    : <span className="inline-flex items-center rounded-full border border-dashed border-sand px-2.5 py-1 text-xs font-bold text-muted">Child not recorded</span>;
}

function InboxCard({ item, v, child, settings, profiles, next }: {
  item: InboxItem; v?: VideoWithCard; child?: Profile; settings?: FamilySettings; profiles: Profile[]; next: string;
}) {
  const outside = v && settings ? blockedReasons(v, settings).includes(REASON.notInLibrary) : false;
  const unreviewed = !reviewEligibility(v?.card).eligible;
  const note = eligibilityNote(v?.card);
  // What holds it back for this child, attributed to its real source (AI review, other parents, settings).
  const hold = v && settings && !unreviewed ? holdExplanation(v, settings) : null;
  const evidence = hold?.evidence ?? [];

  const why =
    item.kind === "request"
      ? [child ? `${child.name} asked to watch this.` : "A child asked to watch this, but the request didn't record which one.",
         hold?.summary ?? (outside && !unreviewed ? `It isn't in ${child?.name}'s library, so it needs your OK.` : "")].filter(Boolean).join(" ")
    : item.legacyKind === "override" ? "Before permissions were per child, a parent approved this video. It's paused until you choose a child."
    : "Before permissions were per child, an automatic Open-mode check cleared this. No parent approved it. It's paused until you choose.";

  return (
    <Card as="article" className="overflow-hidden" raised={isChildRequest(item)}>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ---- the decision ---- */}
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.kind !== "legacy" && <ChildChip p={child} />}
            <Origin item={item} />
          </div>
          <div className="flex gap-3 sm:gap-4">
            {v && (
              <Link href={detailHref(`/parent/video/${v.id}`, "review", child?.id)} className="relative block w-28 shrink-0 overflow-hidden rounded-xl bg-sand-soft sm:w-44" aria-label={`Open ${v.title}`}>
                <Image src={thumb(v)} alt="" width={320} height={180} unoptimized className="aspect-video w-full object-cover" />
                {v.durationSeconds ? <span className="absolute bottom-1.5 right-1.5 rounded bg-forest-900/85 px-1 text-[11px] font-bold text-ivory">{Math.floor(v.durationSeconds / 60)}:{String(v.durationSeconds % 60).padStart(2, "0")}</span> : null}
              </Link>
            )}
            <div className="min-w-0">
              <Link href={detailHref(`/parent/video/${item.videoId}`, "review", child?.id)} className="block font-bold leading-snug text-forest hover:underline line-clamp-2 sm:text-lg">{v?.title ?? "Video details unavailable"}</Link>
              <p className="text-sm text-muted">{v?.channel?.title ?? v?.channelId ?? item.videoId}</p>
            </div>
          </div>
          {why && <p className="text-sm text-ink">{why}</p>}
          {/* The evidence behind the hold, before the actions (also on phones, without expanding anything). */}
          {evidence.length > 0 && <EvidenceList items={evidence} videoId={item.videoId} />}
          {unreviewed && (
            <p className="flex items-start gap-1.5 rounded-xl bg-warn-soft px-3 py-2 text-sm text-ink">
              <IconAlert size={16} className="mt-0.5 shrink-0 text-warn" />
              <span>{note} Allowing it will ask you to confirm first.</span>
            </p>
          )}

          {/* ---- actions (existing semantics) ---- */}
          <div className="flex flex-wrap items-center gap-2">
            {item.kind === "request" && (
              <form action={resolveWatchRequest} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="requestId" value={item.requestId} /><input type="hidden" name="next" value={next} />
                {child ? (
                  <Button type="submit" name="decision" value="approve">Allow for {child.name}</Button>
                ) : (
                  <>
                    <label className="sr-only" htmlFor={`who-${item.requestId}`}>Which child asked?</label>
                    <select id={`who-${item.requestId}`} name="profileId" required defaultValue="" className="rounded-full border border-sand bg-surface px-3 py-2 text-sm font-semibold">
                      <option value="" disabled>Which child?</option>
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <Button type="submit" name="decision" value="approve">Allow</Button>
                  </>
                )}
                <Button type="submit" name="decision" value="deny" variant="secondary">Not now</Button>
              </form>
            )}
            {item.kind === "legacy" && (
              <>
                {(item.candidateIds.length ? profiles.filter((p) => item.candidateIds.includes(p.id)) : profiles).map((p) => (
                  <form key={p.id} action={resolveLegacyAction}>
                    <input type="hidden" name="legacyId" value={item.legacyId} /><input type="hidden" name="allowFor" value={p.id} />
                    <Button type="submit" variant="secondary">Allow for {p.name}</Button>
                  </form>
                ))}
                <form action={resolveLegacyAction}><input type="hidden" name="legacyId" value={item.legacyId} /><Button type="submit" variant="quiet">Don&apos;t allow</Button></form>
              </>
            )}
          </div>

          {/* Phone: the detailed assessment is one tap away instead of in the way of the actions. */}
          {v && !unreviewed && (
            <details className="rounded-xl border border-sand lg:hidden">
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-forest">What the AI review found</summary>
              <div className="border-t border-sand p-3"><Assessment v={v} compact /></div>
            </details>
          )}
        </div>

        {/* ---- the assessment, alongside (desktop) ---- */}
        <aside className="hidden border-l border-sand bg-sand-soft/50 p-5 lg:block" aria-label="AI review">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-forest"><IconReview size={16} />AI review</p>
          {v ? <Assessment v={v} compact /> : <p className="text-sm text-muted">No details for this video.</p>}
          <Link href={detailHref(`/parent/video/${item.videoId}`, "review", child?.id)} className="mt-3 inline-block text-sm font-bold text-forest underline decoration-sand underline-offset-4">Full review and who can watch</Link>
        </aside>
      </div>
    </Card>
  );
}
