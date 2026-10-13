import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { listPendingRequests } from "@/lib/activity";
import { CONCERN_LABELS } from "@/lib/types";
import { Button, Card, ConcernPill, PacePill, Pill, Stars, TopBar } from "@/components/ui";
import { decideVideo, resolveLegacyAction, resolveWatchRequest } from "@/app/actions";
import { needsDecision } from "@/lib/gate";

export const dynamic = "force-dynamic";

/**
 * The review queue: one decision at a time. Only things that need a human —
 * kid requests first, then reviewed videos your filters are hiding. Unreviewed videos never show up here.
 */
export default async function ReviewPage(props: PageProps<"/parent/review">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/review" : "/unlock?next=/parent/review");
  const fid = v.familyId;
  const profiles = await db.listProfiles(fid);
  const kidId = (typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined) ?? v.profileId ?? profiles[0]?.id;
  const kid = profiles.find((p) => p.id === kidId);
  const [lib, settings, allRequests, legacy] = await Promise.all([getLibrary(fid, kidId), db.getSettings(fid, kidId), listPendingRequests(fid), db.listLegacyGrants(fid)]);
  const byId = new Map(lib.map((x) => [x.id, x]));
  const videosById = new Map((await Promise.all(legacy.map((g) => db.getVideo(g.targetId)))).filter(Boolean).map((x) => [x!.id, x!]));
  // This child's requests, plus old requests that never recorded which child asked (the parent picks).
  const requests = allRequests.filter((r) => r.profileId === kidId || !r.profileId);
  const error = typeof sp.error === "string" ? sp.error : null;

  const queue = [
    ...requests.map((r) => ({ kind: "request" as const, v: byId.get(r.videoId)!, requestId: r.id, requester: r.profileId })).filter((x) => x.v),
    ...lib
      .filter((x) => needsDecision(x, settings) && !requests.some((r) => r.videoId === x.id))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .map((x) => ({ kind: "hidden" as const, v: x, requestId: undefined, requester: undefined })),
  ];
  const skip = typeof sp.skip === "string" ? sp.skip.split(",").filter(Boolean) : [];
  const remaining = queue.filter((q) => !skip.includes(q.v.id));
  const item = remaining[0];
  const done = queue.length - remaining.length;

  return (
    <>
      <TopBar title="Review" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Dashboard</Link>} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted">Deciding for</span>
            {profiles.map((p) => (
              <Link key={p.id} href={`/parent/review?kid=${p.id}`} className={`rounded-full px-2.5 py-1 font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>{p.avatar} {p.name}</Link>
            ))}
          </div>
          <span className="text-muted">{remaining.length} left{done ? ` · ${done} skipped` : ""}</span>
        </div>
        {error && <Card className="p-3 border-bad/40 bg-bad/5 text-sm font-bold text-bad">{error}</Card>}

        {legacy.length > 0 && (
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-extrabold">Approvals from before per-child permissions</h2>
              <p className="text-sm text-muted">Approvals are now made for one child at a time. We couldn&apos;t tell which child these were for, so they&apos;re paused — nothing here plays until you choose.</p>
            </div>
            <ul className="divide-y divide-line">
              {legacy.map((g) => {
                const vid = videosById.get(g.targetId);
                const cands = profiles.filter((p) => g.candidateProfileIds.includes(p.id));
                return (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link href={`/parent/video/${g.targetId}`} className="min-w-0 flex-1 font-bold hover:underline line-clamp-1">{vid?.title ?? g.targetId}</Link>
                    <span className="text-xs text-muted">{g.kind === "override" ? "you approved it" : "a search check cleared it"}</span>
                    {(cands.length ? cands : profiles).map((p) => (
                      <form key={p.id} action={resolveLegacyAction}><input type="hidden" name="legacyId" value={g.id} /><input type="hidden" name="allowFor" value={p.id} /><Button type="submit" variant="ghost" className="text-xs px-2.5 py-1">Allow for {p.name}</Button></form>
                    ))}
                    <form action={resolveLegacyAction}><input type="hidden" name="legacyId" value={g.id} /><button type="submit" className="text-xs font-bold text-muted hover:text-ink">Dismiss</button></form>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {!item ? (
          <Card className="p-8 text-center space-y-2">
            <p className="text-4xl">🎉</p>
            <h1 className="text-xl font-extrabold">Nothing waiting on you.</h1>
            <p className="text-sm text-muted">New videos from your channels get reviewed overnight; anything your filters hide shows up here. Kid requests jump the line.</p>
            <Link href="/parent" className="inline-block pt-2"><Button variant="ghost">Back to dashboard</Button></Link>
          </Card>
        ) : (
          <QueueCard item={item} kidName={kid?.name ?? "your kid"} reasons={blockedReasons(item.v, settings)} nextSkip={[...skip, item.v.id].join(",")} kidId={kidId} profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} />
        )}
      </main>
    </>
  );
}

type Item = { kind: "request" | "hidden"; v: NonNullable<Awaited<ReturnType<typeof getLibrary>>[number]>; requestId?: string; requester?: string };

function QueueCard({ item, kidName, reasons, nextSkip, kidId, profiles }: { item: Item; kidName: string; reasons: string[]; nextSkip: string; kidId?: string; profiles: { id: string; name: string }[] }) {
  const { v } = item;
  const c = v.card;
  const present = c?.concerns.filter((x) => x.present) ?? [];
  const next = `/parent/review?kid=${kidId ?? ""}`;
  const skipHref = `/parent/review?kid=${kidId ?? ""}&skip=${nextSkip}`;
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video w-full bg-black">
        <Image src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" fill unoptimized className="object-cover" />
        {item.kind === "request" && <span className="absolute left-3 top-3 rounded-full bg-sun px-3 py-1 text-xs font-extrabold">🙋 {kidName} asked for this</span>}
        {c && <span className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-extrabold text-white">{Math.floor((v.durationSeconds ?? 0) / 60)} min · ages {c.ageFit.min}–{c.ageFit.max}</span>}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <h1 className="text-xl font-extrabold leading-tight">{v.title}</h1>
          <p className="text-sm text-muted"><Link href={`/parent/channel/${v.channelId}`} className="hover:underline">{v.channel?.title ?? v.channelId}</Link>{c ? <> · <Stars value={c.rating} /> · <PacePill pace={c.pace} /></> : null}</p>
        </div>
        {c ? (
          <>
            <p className="text-sm">{c.synopsis}</p>
            <p className="rounded-xl bg-surface p-3 text-sm"><b>Reviewer:</b> {c.parentRecommendation}</p>
            {present.length > 0 && (
              <div className="flex flex-wrap gap-1.5">{present.map((f) => <ConcernPill key={f.tag} f={f} flaggedBy={v.confirmations.flaggedTags[f.tag]} />)}</div>
            )}
            {present.some((f) => f.evidence) && (
              <ul className="text-xs text-muted space-y-0.5">
                {present.filter((f) => f.evidence).map((f) => <li key={f.tag}><b className="text-ink">{CONCERN_LABELS[f.tag]}</b>{f.timestamp ? ` @ ${f.timestamp}` : ""} — {f.evidence}</li>)}
              </ul>
            )}
          </>
        ) : <p className="text-sm text-muted">Not reviewed yet — the request came in before the reviewer got to it.</p>}
        {reasons.length > 0 && <p className="text-sm"><Pill className="bg-bad/10 text-bad">Hidden for {kidName}: {reasons.join(", ")}</Pill></p>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.kind === "request" ? (
            <form action={resolveWatchRequest} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="requestId" value={item.requestId} /><input type="hidden" name="next" value={next} />
              {item.requester ? (
                <Button type="submit" name="decision" value="approve">✓ Allow for {kidName}</Button>
              ) : (
                <>
                  {/* An old request that didn't record which child asked: the parent chooses; never "everyone". */}
                  <select name="profileId" required defaultValue="" className="rounded-full border border-line bg-bg px-3 py-2 text-sm">
                    <option value="" disabled>Which child?</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Button type="submit" name="decision" value="approve">✓ Allow</Button>
                </>
              )}
              <Button type="submit" name="decision" value="deny" variant="ghost">Not now</Button>
            </form>
          ) : (
            <form action={decideVideo} className="flex flex-wrap gap-2">
              <input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="profileId" value={kidId ?? ""} /><input type="hidden" name="next" value={next} />
              <Button type="submit" name="decision" value="allow">✓ Allow for {kidName}</Button>
              <Button type="submit" name="decision" value="hide" variant="ghost">Keep hidden</Button>
              <Button type="submit" name="decision" value="never" variant="danger">Never for {kidName}</Button>
            </form>
          )}
          <span className="ml-auto flex gap-3 text-xs font-bold text-muted">
            <Link href={`/parent/video/${v.id}`} className="hover:text-ink">Full card</Link>
            <a href={`https://www.youtube.com/watch?v=${v.id}${present[0]?.timestamp ? `&t=${toSec(present[0].timestamp)}` : ""}`} target="_blank" rel="noreferrer" className="hover:text-ink">Watch the moment ↗</a>
            <Link href={skipHref} className="hover:text-ink">Skip →</Link>
          </span>
        </div>
      </div>
    </Card>
  );
}

function toSec(ts: string) {
  const p = ts.split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0);
}
