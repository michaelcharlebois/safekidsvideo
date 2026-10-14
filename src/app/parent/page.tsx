import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { getLibrary } from "@/lib/queries";
import { reviewEligibility } from "@/lib/gate";
import { playStatus, type PlayStatus } from "@/lib/status";
import { MODE_LABELS, type VideoWithCard } from "@/lib/types";
import { Button, buttonClass, Card, EmptyState, Meter, Notice, SectionHeader, StatusBadge, Tag } from "@/components/ui";
import { IconAlert, IconArrowDown, IconArrowUp, IconChannels, IconChevron, IconClock, IconHand, IconPlayCircle, IconPlus, IconTv } from "@/components/icons";
import { grantMoreTime, moveChannel, resolveWatchRequest, reviewNextBatch, toggleWhitelist } from "@/app/actions";
import { localDay, watchEventsSince } from "@/lib/checkin";
import { orderShelves, tasteFrom } from "@/lib/arrange";
import { kidHome } from "@/lib/kid-home";
import { forChild, pendingDecisions } from "@/lib/inbox";
import { listPendingRequests, recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { minutesUsedToday } from "@/lib/screentime";
import { AddPanel } from "./library/sources";
import { billingStatus } from "@/lib/billing";
import { ChannelAvatar } from "@/app/watch/kid-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background batch reviews run within this budget

/** Library filters (?view=). Names kept for existing links; labels are the new status words. */
type View = "visible" | "hidden" | "unreviewed";
const VIEW_OF: Record<PlayStatus, View> = { plays: "visible", allowed: "visible", reviewing: "unreviewed", uncertain: "hidden", held: "hidden", hidden: "hidden", blocked: "hidden", outside: "hidden" };
const VIEW_LABEL: Record<View, string> = { visible: "Ready", hidden: "Held back", unreviewed: "Awaiting review" };
const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
const fmtTime = (hhmm?: string) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/**
 * Home: one child at a time. Top to bottom: who and how they're set up; four counts that each open the
 * matching list; the decision waiting on you (if any); what's on their screen right now; their channels.
 * Every number is computed from the gate (authorize) for THIS child — nothing here is sample data.
 */
export default async function ParentPage(props: PageProps<"/parent">) {
  const sp = await props.searchParams;
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent");
  const fid = viewer.familyId;
  const family = await db.getFamily(fid);
  if (!family.onboardedAt) redirect("/start");
  const billing = billingStatus(family);
  const profiles = await db.listProfiles(fid);
  const kidId = (typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined) ?? viewer.profileId ?? profiles[0]?.id;
  const kid = profiles.find((p) => p.id === kidId);
  const [lib, settings, channels, allRequests, wl, recent, approvedIds, events, usedToday] = await Promise.all([
    getLibrary(fid, kidId), db.getSettings(fid, kidId), db.listChannels(), listPendingRequests(fid), db.listWhitelist(fid), recentWatchIds(fid, 8, kidId), recentlyApprovedIds(fid, kidId),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
    kidId ? minutesUsedToday(fid, kidId, family.timezone) : Promise.resolve(0),
  ]);
  const approvedChannels = new Set(wl.filter((w) => w.kind === "channel" && w.profileId == null).map((w) => w.targetId));
  const moreAsk = typeof sp.more === "string" ? profiles.find((p) => p.id === sp.more) : undefined;
  const batchStarted = typeof sp.batch === "string" ? Number(sp.batch) : 0;
  const view: View | undefined = (["visible", "hidden", "unreviewed"] as View[]).includes(sp.view as View) ? (sp.view as View) : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const byId = new Map(lib.map((v) => [v.id, v]));

  // Everything below derives from the gate's decision for this child.
  // The child's content, from the SAME selector the kid home screen uses (lib/kid-home.ts): inventory is
  // what's in their library at all (blocked and unreviewed included, so they can be managed); "ready" is
  // inventory ∩ authorize(), i.e. exactly the kid screen's playable set.
  const home = kidHome({
    lib, settings, recentIds: recent, approvedIds, now: Date.now(), // eslint-disable-line react-hooks/purity -- server component
    taste: tasteFrom(events.filter((e) => !kidId || e.profileId === kidId || !e.profileId), byId),
  });
  const mine = home.inventory;
  const stat = new Map(mine.map((v) => [v.id, playStatus(v, settings)]));
  const viewOf = (v: VideoWithCard) => VIEW_OF[stat.get(v.id)?.status ?? playStatus(v, settings).status];
  const ready = home.playable;
  const reviewing = mine.filter((v) => viewOf(v) === "unreviewed");
  // This child's requests from the Review inbox (lib/inbox.ts), plus older requests that never recorded a
  // child (Review lets you pick one). Videos held back automatically are not decisions; they're in Library.
  const decisions = kid ? forChild(pendingDecisions({ requests: allRequests, childIds: [kid.id], legacy: [] }), kid.id) : [];
  const requests = allRequests.filter((r) => decisions.some((d) => d.kind === "request" && d.requestId === r.id) && byId.has(r.videoId));
  const needsYou = requests.length;
  const backlog = reviewing.filter((v) => (v.durationSeconds ?? 0) <= 20 * 60).length;
  const limit = settings.dailyMinutes ? settings.dailyMinutes + (settings.bonusDay === localDay(family.timezone) ? settings.bonusMinutes ?? 0 : 0) : undefined;

  // The kid screen, in miniature: the same shelves they see.
  const keepWatching = home.keepWatching;
  const tvShelves = home.shelves.slice(0, 2); // the first shelves, titled exactly as on the kid screen
  const readyChannels = new Set(ready.map((v) => v.channelId)).size;

  // Channels (family content sources) with what each means for this child.
  const groups = [...approvedChannels].map((id) => {
    const vids = mine.filter((v) => v.channelId === id);
    const channel = channels.find((c) => c.id === id);
    const count = (w: View) => vids.filter((v) => viewOf(v) === w).length;
    return { id, title: channel?.title ?? vids[0]?.channel?.title ?? id, channel, vids, ready: count("visible"), held: count("hidden"), reviewing: count("unreviewed") };
  });
  const orderedGroups = orderShelves(groups.map((g) => ({ ...g, videos: g.vids.filter((v) => viewOf(v) === "visible") })), settings.channelOrder);
  const filtered = (view || q)
    ? groups.map((g) => ({ ...g, shown: g.vids.filter((v) => (!view || viewOf(v) === view) && (!q || v.title.toLowerCase().includes(q))).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) })).filter((g) => g.shown.length)
    : null;
  const libHref = (v?: View) => `/parent?kid=${kidId ?? ""}${v ? `&view=${v}` : ""}#channels`;

  if (!kid) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card><EmptyState icon={<IconPlus />} title="Add your first child" action={<Link href="/parent/kids" className={buttonClass("primary")}>Add a child</Link>}>Each child gets their own library rules, viewing mode and screen-time limits.</EmptyState></Card>
      </main>
    );
  }

  const setup = [
    MODE_LABELS[settings.mode].title === "Open, ask first" ? "Ask-first mode" : `${MODE_LABELS[settings.mode].title} mode`,
    settings.dailyMinutes ? `up to ${settings.dailyMinutes} minutes a day` : "no daily limit",
    settings.bedtime ? `done by ${fmtTime(settings.bedtime)}` : null,
  ].filter(Boolean).join(", ");

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      {/* ---- who ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-3xl ring-1 ring-sand sm:h-16 sm:w-16 sm:text-4xl" aria-hidden>{kid.avatar}</span>
          <div>
            <h1 className="text-title sm:text-display">{kid.name}</h1>
            <p className="text-sm text-muted sm:text-base">
              {setup.charAt(0).toUpperCase() + setup.slice(1)}. <Link href={`/parent/settings?kid=${kidId}`} className="font-bold text-forest underline decoration-sand underline-offset-4 hover:decoration-forest">Change</Link>
            </p>
          </div>
        </div>
        {profiles.length > 1 && (
          <nav aria-label="Switch child" className="flex gap-1.5 lg:hidden">
            {profiles.map((p) => (
              <Link key={p.id} href={`/parent?kid=${p.id}`} aria-current={p.id === kidId ? "true" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${p.id === kidId ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink"}`}>
                <span aria-hidden>{p.avatar}</span>{p.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* ---- account notices ---- */}
      {!billing.ok && (
        <Notice tone="bad" className="mt-5">
          <b>{billing.state === "past_due" ? "There's a payment problem." : "Your free trial has ended."}</b> The kid screen keeps playing what&apos;s already allowed. New approvals and searches are paused. <Link href="/parent/billing" className="font-bold underline">Subscribe</Link>
        </Notice>
      )}
      {billing.ok && billing.state === "trial" && (billing.daysLeft ?? 99) <= 7 && (
        <Notice className="mt-5">{billing.daysLeft} day{billing.daysLeft === 1 ? "" : "s"} left in your free trial. <Link href="/parent/billing" className="font-bold text-forest underline">Keep Brightframe going</Link></Notice>
      )}
      {moreAsk && (
        <Card raised className="mt-5 flex flex-wrap items-center gap-3 border-apricot/60 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-apricot-soft text-apricot-ink"><IconClock /></span>
          <p className="flex-1 font-bold text-forest">{moreAsk.name} is asking for more time today</p>
          <div className="flex flex-wrap gap-2">
            {[15, 30, 60].map((m) => (
              <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={moreAsk.id} /><input type="hidden" name="minutes" value={m} /><Button type="submit" size="sm">+{m} min</Button></form>
            ))}
            <Link href={`/parent?kid=${kidId}`} className={buttonClass("quiet", "sm")}>Not today</Link>
          </div>
        </Card>
      )}

      {/* ---- four counts, each a door ---- */}
      <section aria-label={`${kid.name} at a glance`} className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile href={libHref("visible")} icon={<IconPlayCircle />} tone="ok" value={ready.length} label="Ready to watch" sub="Reviewed and within the rules" />
        <StatTile href={libHref("unreviewed")} icon={<IconClock />} tone="pending" value={reviewing.length} label="Awaiting review" sub="Won't play until an AI review passes" />
        <StatTile href={`/parent/review?kid=${kidId}`} icon={<IconAlert />} tone={needsYou ? "warn" : "quiet"} value={needsYou} label="Needs your decision" sub={requests.length ? `Asked for by ${kid.name}` : `Nothing ${kid.name} asked for`} />
        <StatTile href={`/parent/stats?kid=${kidId}`} icon={<IconTv />} tone="forest" value={`${usedToday}`} unit="min" label={limit ? `of ${limit} min today` : "watched today"} meter={limit ? { value: usedToday, max: limit } : undefined} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {/* ---- the decision waiting on you ---- */}
          {needsYou > 0 ? (
            <Card as="section" raised className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-sand px-5 py-4">
                <SectionHeader icon={<IconAlert />} title="Needs your decision" sub={`${kid.name} asked to watch ${requests.length === 1 ? "this video" : `${requests.length} videos`}.`} />
              </div>
              {requests.slice(0, 2).map((r) => {
                const v = byId.get(r.videoId)!;
                const who = profiles.find((p) => p.id === r.profileId);
                const { status, reasons } = playStatus(v, settings);
                const eligible = reviewEligibility(v.card).eligible;
                return (
                  <article key={r.id} className="grid gap-4 border-b border-sand px-5 py-5 last:border-b-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
                    <Link href={`/parent/video/${v.id}`} className="relative block overflow-hidden rounded-xl bg-sand-soft">
                      <Image src={thumb(v)} alt="" width={320} height={180} unoptimized className="aspect-video w-full object-cover" />
                      {v.durationSeconds ? <span className="absolute bottom-2 right-2 rounded-md bg-forest-900/85 px-1.5 py-0.5 text-xs font-bold text-ivory">{Math.floor(v.durationSeconds / 60)}:{String(v.durationSeconds % 60).padStart(2, "0")}</span> : null}
                    </Link>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-apricot-ink"><IconHand size={16} />{who ? `${who.name} asked for this` : "A child asked for this (which one wasn't recorded)"}</p>
                      <Link href={`/parent/video/${v.id}`} className="mt-1 block text-lg font-bold leading-snug text-forest hover:underline line-clamp-2">{v.title}</Link>
                      <p className="text-sm text-muted">{v.channel?.title ?? v.channelId}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={status} />
                        {eligible && v.card && <Tag>AI review: ages {v.card.ageFit.min}–{v.card.ageFit.max}</Tag>}
                        {reasons.filter((x) => x !== "Not in this child's library").slice(0, 3).map((x) => <Tag key={x} className="border-warn/30 bg-warn-soft text-warn">{x}</Tag>)}
                      </div>
                      <form action={resolveWatchRequest} className="mt-4 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="next" value={`/parent?kid=${kidId}`} />
                        {who ? (
                          <Button type="submit" name="decision" value="approve">Allow for {who.name}{eligible ? "" : " (not reviewed)"}</Button>
                        ) : (
                          <Link href={`/parent/review?kid=${kidId}`} className={buttonClass("primary")}>Choose a child</Link>
                        )}
                        <Button type="submit" name="decision" value="deny" variant="secondary">Not now</Button>
                        <Link href={`/parent/video/${v.id}`} className={buttonClass("quiet", "md")}>See the full review</Link>
                      </form>
                      {!eligible && who && <p className="mt-2 text-xs text-muted">Not reviewed yet: you&apos;ll be asked to confirm before it plays for {who.name}.</p>}
                    </div>
                  </article>
                );
              })}
              {requests.length > 2 && (
                <Link href={`/parent/review?kid=${kidId}`} className="flex items-center gap-4 px-5 py-4 hover:bg-sand-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-forest">
                      {`${requests.length - 2} more request${requests.length - 2 === 1 ? "" : "s"}`}
                    </span>
                    <span className="block text-sm text-muted">Allow or say not now, in Review.</span>
                  </span>
                  <IconChevron className="text-muted" />
                </Link>
              )}
            </Card>
          ) : (
            <Notice tone="ok" className="flex items-center gap-2 font-bold"><IconPlayCircle size={18} />Nothing needs your decision for {kid.name} right now.</Notice>
          )}

          {/* ---- the kid screen, in miniature ---- */}
          <section aria-labelledby="screen-h">
            <SectionHeader id="screen-h" title={`On ${kid.name}'s screen`} sub="The shelves your child sees right now." action={<Link href="/watch" className="inline-flex items-center gap-1 text-forest hover:underline">Open the kid screen<IconChevron size={16} /></Link>} />
            <div className="mt-3 rounded-[var(--radius-panel)] bg-forest-900 p-4 text-ivory ring-1 ring-forest sm:p-5" style={{ backgroundImage: "radial-gradient(110% 90% at 85% -10%, rgb(255 159 110 / 0.16) 0%, transparent 55%)" }}>
              {tvShelves.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-bold">Nothing on the screen yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ivory/70">Add a channel. Its videos appear here once they&apos;re reviewed and fit {kid.name}&apos;s rules.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {tvShelves.map((s) => (
                    <div key={s.id}>
                      <p className="mb-2 text-sm font-bold text-ivory/90">{s.title}</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {s.videos.slice(0, 4).map((v, i) => (
                          <Link key={v.id} href={`/parent/video/${v.id}`} className={`group overflow-hidden rounded-xl bg-forest ring-1 ring-ivory/10 hover:ring-2 hover:ring-apricot ${i >= 2 ? "hidden sm:block" : ""}`}>
                            <Image src={thumb(v)} alt="" width={240} height={135} unoptimized className="aspect-video w-full object-cover" />
                            <p className="truncate px-2.5 py-2 text-xs font-semibold text-ivory/85">{v.title}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-ivory/65">The first {tvShelves.length === 1 ? "shelf" : `${tvShelves.length} shelves`} of {home.shelves.length}, as {kid.name} sees them. {ready.length} video{ready.length === 1 ? "" : "s"} ready across {readyChannels} channel{readyChannels === 1 ? "" : "s"}.</p>
            </div>
          </section>

          {/* ---- channels ---- */}
          <section id="channels" aria-labelledby="channels-h" className="scroll-mt-20">
            <SectionHeader id="channels-h" icon={<IconChannels />} title="Channels" sub={`Your family's channels, in ${kid.name}'s order. A channel brings videos in; each one still needs a review.`} action={<Link href={`/parent/library?kid=${kidId}`} className="text-sm text-forest hover:underline">Library</Link>} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <nav aria-label="Filter videos" className="flex flex-wrap gap-1.5">
                <FilterChip href={`/parent?kid=${kidId}#channels`} active={!view}>All channels</FilterChip>
                {(["visible", "unreviewed", "hidden"] as View[]).map((w) => (
                  <FilterChip key={w} href={libHref(w)} active={view === w}>{VIEW_LABEL[w]} <span className="opacity-70">{w === "visible" ? ready.length : w === "unreviewed" ? reviewing.length : mine.length - ready.length - reviewing.length}</span></FilterChip>
                ))}
              </nav>
              <form action="/parent" className="ml-auto w-full sm:w-64">
                <input type="hidden" name="kid" value={kidId} />
                {view && <input type="hidden" name="view" value={view} />}
                <label className="sr-only" htmlFor="find">Find a video</label>
                <input id="find" name="q" defaultValue={q} type="search" placeholder="Find a video" className="w-full rounded-full border border-sand bg-surface px-4 py-2 text-sm outline-none focus:border-forest" />
              </form>
            </div>
            {(view || q) && <p className="mt-2 text-sm text-muted">Showing {view ? VIEW_LABEL[view].toLowerCase() : "all"} videos{q ? ` matching “${q}”` : ""}. <Link href={`/parent?kid=${kidId}#channels`} className="font-bold text-forest underline">Clear</Link></p>}

            {filtered ? (
              <div className="mt-4 space-y-6">
                {filtered.length === 0 && <Card><EmptyState title="No videos match">Try another word, or clear the filter.</EmptyState></Card>}
                {filtered.map((g) => (
                  <div key={g.id}>
                    <p className="flex items-center gap-2 font-bold text-forest"><ChannelAvatar channel={g.channel} name={g.title} size={24} />{g.title}</p>
                    <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {g.shown.slice(0, 12).map((v) => <VideoTile key={v.id} v={v} st={stat.get(v.id)!.status} why={stat.get(v.id)!.reasons} />)}
                    </ul>
                    {g.shown.length > 12 && <p className="mt-2 text-sm"><Link href={`/parent/channel/${g.id}`} className="font-bold text-forest underline">{g.shown.length - 12} more on the channel page</Link></p>}
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <Card className="mt-3"><EmptyState icon={<IconChannels />} title="No channels yet">Search for a channel or add a starter pack. New videos are reviewed before they can play.</EmptyState></Card>
            ) : (
              <Card as="section" className="mt-3 overflow-hidden">
                <ul className="divide-y divide-sand">
                  {orderedGroups.map((g, idx) => (
                    <li key={g.id} className="flex items-center gap-1 pl-2">
                      <div className="flex flex-col text-muted">
                        <form action={moveChannel}><input type="hidden" name="profileId" value={kidId} /><input type="hidden" name="channelId" value={g.id} /><input type="hidden" name="dir" value="up" /><button type="submit" disabled={idx === 0} aria-label={`Move ${g.title} up`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand-soft hover:text-forest disabled:opacity-25 sm:h-7 sm:w-7"><IconArrowUp size={18} /></button></form>
                        <form action={moveChannel}><input type="hidden" name="profileId" value={kidId} /><input type="hidden" name="channelId" value={g.id} /><input type="hidden" name="dir" value="down" /><button type="submit" disabled={idx === orderedGroups.length - 1} aria-label={`Move ${g.title} down`} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand-soft hover:text-forest disabled:opacity-25 sm:h-7 sm:w-7"><IconArrowDown size={18} /></button></form>
                      </div>
                      <Link href={`/parent/channel/${g.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 hover:bg-sand-soft">
                        <ChannelAvatar channel={g.channel} name={g.title} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-forest">{g.title}</span>
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {g.ready > 0 && <StatusBadge status="plays" className="py-0.5">{g.ready} ready</StatusBadge>}
                            {g.reviewing > 0 && <StatusBadge status="reviewing" className="py-0.5">{g.reviewing} awaiting review</StatusBadge>}
                            {g.held > 0 && <StatusBadge status="held" className="py-0.5">{g.held} held back</StatusBadge>}
                            {!g.ready && !g.reviewing && !g.held && <span className="text-xs text-muted">No videos yet</span>}
                          </span>
                        </span>
                        <span className="hidden -space-x-3 sm:flex">
                          {g.videos.slice(0, 3).map((v) => <Image key={v.id} src={thumb(v)} alt="" width={64} height={36} unoptimized className="h-9 w-16 rounded-md object-cover ring-2 ring-surface" />)}
                        </span>
                        <IconChevron className="text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {backlog > 0 && (
              <form action={reviewNextBatch} className="mt-3 text-sm text-muted">
                <input type="hidden" name="n" value={10} />
                {backlog} more video{backlog === 1 ? "" : "s"} will be reviewed overnight.{" "}
                {batchStarted ? <span className="font-bold text-ok">Reviewing {batchStarted} now. Check back in a few minutes.</span> : <button type="submit" className="font-bold text-forest underline">Review 10 now</button>}
              </form>
            )}
          </section>
        </div>

        {/* ---- side column ---- */}
        <aside className="space-y-6">
          <Card as="section" className="p-5">
            <SectionHeader icon={<IconTv />} title="Today" action={<Link href={`/parent/stats?kid=${kidId}`} className="text-forest hover:underline">Viewing stats</Link>} />
            <p className="mt-4 text-3xl font-extrabold tracking-tight text-forest">{usedToday} min <span className="text-base font-semibold text-muted">{limit ? `of ${limit}` : "watched"}</span></p>
            {limit ? <div className="mt-2"><Meter value={usedToday} max={limit} label={`${usedToday} of ${limit} minutes watched today`} /></div> : <p className="mt-1 text-sm text-muted">No daily limit set. <Link href={`/parent/settings?kid=${kidId}`} className="font-bold text-forest underline">Add one</Link></p>}
            {keepWatching.length > 0 && (
              <>
                <p className="mt-5 text-sm font-semibold text-muted">Recently watched</p>
                <ul className="mt-2 space-y-2">
                  {keepWatching.slice(0, 3).map((v) => (
                    <li key={v.id}>
                      <Link href={`/parent/video/${v.id}`} className="flex items-center gap-3 rounded-xl p-1 hover:bg-sand-soft">
                        <Image src={thumb(v)} alt="" width={96} height={54} unoptimized className="aspect-video w-20 shrink-0 rounded-lg object-cover" />
                        <span className="min-w-0 text-sm font-semibold leading-snug text-ink line-clamp-2">{v.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card as="section" className="p-5">
            <SectionHeader title="Library" sub={`What it means for ${kid.name}.`} action={<Link href={`/parent/library?kid=${kidId}`} className="text-forest hover:underline">Open Library</Link>} />
            <ul className="mt-3 divide-y divide-sand text-sm">
              <SummaryRow href={`/parent/library?kid=${kidId}&tab=sources`} icon={<IconChannels size={18} />} label="Family sources" value={approvedChannels.size} />
              <SummaryRow href={`/parent/library?kid=${kidId}&status=plays`} icon={<IconPlayCircle size={18} />} label={`Ready for ${kid.name}`} value={ready.length} />
              <SummaryRow href={`/parent/library?kid=${kidId}&status=reviewing`} icon={<IconClock size={18} />} label="Awaiting review" value={reviewing.length} />
              <SummaryRow href={`/parent/library?kid=${kidId}&status=held`} icon={<IconAlert size={18} />} label="Held back by settings" value={mine.length - ready.length - reviewing.length} />
            </ul>
          </Card>

          <AddPanel approvedChannels={approvedChannels} lib={lib} packAdded={typeof sp.pack === "string" ? sp.pack : undefined} next="/parent" />

          {channels.some((c) => !approvedChannels.has(c.id)) && (
            <Card as="section" className="p-5">
              <SectionHeader title="Reviewed for other families" sub="Channels Brightframe already reviews. Adding one brings its videos in; each still has to fit your child's rules." />
              <ul className="mt-3 space-y-2">
                {channels.filter((c) => !approvedChannels.has(c.id)).slice(0, 8).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <ChannelAvatar channel={c} name={c.title} size={28} />
                    <Link href={`/parent/channel/${c.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{c.title}</Link>
                    <form action={toggleWhitelist}>
                      <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={c.id} /><input type="hidden" name="on" value="1" />
                      <Button type="submit" variant="secondary" size="sm">Add</Button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}

function StatTile({ href, icon, tone, value, unit, label, sub, meter }: {
  href: string; icon: ReactNode; tone: "ok" | "pending" | "warn" | "quiet" | "forest"; value: number | string; unit?: string; label: string; sub?: string; meter?: { value: number; max: number };
}) {
  const t = { ok: "bg-ok-soft text-ok", pending: "bg-pending-soft text-pending", warn: "bg-warn-soft text-warn", quiet: "bg-sand-soft text-muted", forest: "bg-sage-soft text-forest" }[tone];
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-[var(--radius-card)] border border-sand bg-surface p-3.5 hover:border-forest/40 sm:p-5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${t}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-extrabold leading-none tracking-tight text-forest sm:text-[1.75rem]">{value}{unit && <span className="ml-1 text-base font-bold">{unit}</span>}</span>
        <span className="mt-1 block text-[0.8125rem] font-bold leading-tight text-ink sm:text-sm">{label}</span>
        {sub && <span className="hidden text-xs text-muted sm:block">{sub}</span>}
        {meter && <span className="mt-2 block"><Meter value={meter.value} max={meter.max} label={`${meter.value} of ${meter.max} minutes`} /></span>}
      </span>
    </Link>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${active ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink hover:border-forest/40"}`}>
      {children}
    </Link>
  );
}

function SummaryRow({ href, icon, label, value }: { href: string; icon: ReactNode; label: string; value: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 py-2.5 hover:text-forest">
        <span className="text-muted">{icon}</span>
        <span className="flex-1 font-semibold">{label}</span>
        <span className="font-extrabold text-forest">{value}</span>
        <IconChevron size={16} className="text-muted" />
      </Link>
    </li>
  );
}

function VideoTile({ v, st, why }: { v: VideoWithCard; st: PlayStatus; why: string[] }) {
  return (
    <li>
      <Link href={`/parent/video/${v.id}`} className="block overflow-hidden rounded-[var(--radius-card)] border border-sand bg-surface hover:border-forest/40">
        <Image src={thumb(v)} alt="" width={320} height={180} unoptimized className={`aspect-video w-full object-cover ${st === "plays" || st === "allowed" ? "" : "opacity-75"}`} />
        <div className="space-y-1.5 p-2.5">
          <p className="text-sm font-semibold leading-snug text-ink line-clamp-2">{v.title}</p>
          <StatusBadge status={st} className="py-0.5" />
          {(st === "held" || st === "blocked") && why[0] && <p className="text-xs text-muted line-clamp-1">{why.join(", ")}</p>}
        </div>
      </Link>
    </li>
  );
}
