import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { getLibrary } from "@/lib/queries";
import { reviewEligibility } from "@/lib/gate";
import { playStatus } from "@/lib/status";
import { libraryCounts, libraryFor } from "@/lib/library";
import { MODE_UI, whenSentence } from "@/lib/modes";
import { detailHref } from "@/lib/back";
import { Button, buttonClass, Card, EmptyState, Meter, Notice, SectionHeader, StatusBadge, Tag } from "@/components/ui";
import { IconAlert, IconChannels, IconChevron, IconClock, IconHand, IconPlayCircle, IconPlus, IconTv } from "@/components/icons";
import { grantMoreTime, resolveWatchRequest } from "@/app/actions";
import { localDay, watchEventsSince } from "@/lib/checkin";
import { tasteFrom } from "@/lib/arrange";
import { kidHome } from "@/lib/kid-home";
import { forChild, pendingDecisions } from "@/lib/inbox";
import { listPendingRequests, recentlyApprovedIds, recentWatchIds } from "@/lib/activity";
import { minutesUsedToday } from "@/lib/screentime";
import { billingStatus } from "@/lib/billing";

export const dynamic = "force-dynamic";

const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
/** Old Home filters (?view=) now live in Library; their links still land in the right place. */
const OLD_VIEW: Record<string, string> = { visible: "plays", unreviewed: "reviewing", hidden: "held" };

/**
 * Home: a short overview of one child. Who they are and their rules; what's ready and what's awaiting
 * review; real requests waiting on you (never automatic filter holds); today's viewing; and the child's
 * actual home screen in miniature. Managing content happens in Library. Everything comes from the gate.
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
  // Deep links to the old Home library filters go to Library.
  if (typeof sp.view === "string" || typeof sp.q === "string") {
    const q = new URLSearchParams({ ...(kidId ? { kid: kidId } : {}), ...(OLD_VIEW[String(sp.view)] ? { status: OLD_VIEW[String(sp.view)] } : {}), ...(typeof sp.q === "string" && sp.q ? { q: sp.q } : {}) });
    redirect(`/parent/library?${q}`);
  }
  const kid = profiles.find((p) => p.id === kidId);
  if (!kid) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Card><EmptyState icon={<IconPlus />} title="Add your first child" action={<Link href="/parent/kids#add" className={buttonClass("primary")}>Add a child</Link>}>Each child gets their own viewing mode, content rules and screen-time limits.</EmptyState></Card>
      </main>
    );
  }
  const [lib, settings, allRequests, wl, recent, approvedIds, events, usedToday] = await Promise.all([
    getLibrary(fid, kid.id), db.getSettings(fid, kid.id), listPendingRequests(fid), db.listWhitelist(fid), recentWatchIds(fid, 8, kid.id), recentlyApprovedIds(fid, kid.id),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
    minutesUsedToday(fid, kid.id, family.timezone),
  ]);
  const moreAsk = typeof sp.more === "string" ? profiles.find((p) => p.id === sp.more) : undefined;
  const byId = new Map(lib.map((v) => [v.id, v]));

  // The kid screen, from the SAME selector the kid home uses (lib/kid-home.ts); counts from Library's.
  const home = kidHome({
    lib, settings, recentIds: recent, approvedIds, now: Date.now(), // eslint-disable-line react-hooks/purity -- server component
    taste: tasteFrom(events.filter((e) => e.profileId === kid.id || !e.profileId), byId),
  });
  const counts = libraryCounts(libraryFor(lib, settings));
  const ready = home.playable.length; // = plays + allowed
  const heldBack = counts.held + counts.uncertain;
  // Requests: this child's, plus older ones that never recorded a child. Never automatic holds.
  const decisions = forChild(pendingDecisions({ requests: allRequests, childIds: [kid.id], legacy: [] }), kid.id);
  const requests = allRequests.filter((r) => decisions.some((d) => d.kind === "request" && d.requestId === r.id) && byId.has(r.videoId));
  const limit = settings.dailyMinutes ? settings.dailyMinutes + (settings.bonusDay === localDay(family.timezone) ? settings.bonusMinutes ?? 0 : 0) : undefined;
  const sources = wl.filter((w) => (w.kind === "channel" || w.kind === "video") && w.profileId == null).length;
  const tvShelves = home.shelves.slice(0, 2);
  const lib_ = (q = "") => `/parent/library?kid=${kid.id}${q}`;
  const mode = MODE_UI[settings.mode];

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      {/* ---- who, and their rules ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface text-3xl ring-1 ring-sand sm:h-16 sm:w-16 sm:text-4xl" aria-hidden>{kid.avatar}</span>
          <div className="min-w-0">
            <h1 className="text-title sm:text-display">{kid.name}</h1>
            <p className="text-sm text-muted sm:text-base">
              <b className="text-ink">{mode.title}</b> ({mode.tagline}). {whenSentence(settings)}.{" "}
              <Link href={`/parent/settings?kid=${kid.id}`} className="font-bold text-forest underline decoration-sand underline-offset-4 hover:decoration-forest">Rules</Link>
            </p>
          </div>
        </div>
        {profiles.length > 1 && (
          <nav aria-label="Switch child" className="flex gap-1.5 lg:hidden">
            {profiles.map((p) => (
              <Link key={p.id} href={`/parent?kid=${p.id}`} aria-current={p.id === kid.id ? "true" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${p.id === kid.id ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink"}`}>
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
            <Link href={`/parent?kid=${kid.id}`} className={buttonClass("quiet", "sm")}>Not today</Link>
          </div>
        </Card>
      )}

      {/* ---- counts, each a door ---- */}
      <section aria-label={`${kid.name} at a glance`} className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-3">
        <StatTile href={lib_("&status=plays")} icon={<IconPlayCircle />} tone="ok" value={ready} label="Ready to watch" sub="Reviewed and within the rules" />
        <StatTile href={lib_("&status=reviewing")} icon={<IconClock />} tone="pending" value={counts.reviewing} label="Awaiting review" sub="No AI review stored yet" />
        <StatTile href={`/parent/review?kid=${kid.id}`} icon={<IconHand />} tone={requests.length ? "warn" : "quiet"} value={requests.length} label={requests.length === 1 ? "Request" : "Requests"} sub={requests.length ? "Waiting on you" : `Nothing ${kid.name} asked for`} />
      </section>
      {heldBack > 0 && (
        <p className="mt-2 text-sm text-muted">
          {heldBack} video{heldBack === 1 ? " is" : "s are"} held back by {kid.name}&apos;s settings, as intended. <Link href={lib_("&status=held")} className="font-bold text-forest underline decoration-sand underline-offset-4">See them in Library</Link>
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {/* ---- requests waiting on you ---- */}
          {requests.length > 0 && (
            <Card as="section" raised className="overflow-hidden">
              <div className="border-b border-sand px-5 py-4">
                <SectionHeader icon={<IconHand />} title={`${kid.name} asked`} sub={`${requests.length === 1 ? "A video is" : `${requests.length} videos are`} waiting for your answer.`} />
              </div>
              {requests.slice(0, 2).map((r) => {
                const v = byId.get(r.videoId)!;
                const who = profiles.find((p) => p.id === r.profileId);
                const { status, reasons } = playStatus(v, settings);
                const eligible = reviewEligibility(v.card).eligible;
                return (
                  <article key={r.id} className="grid gap-4 border-b border-sand px-5 py-5 last:border-b-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
                    <Link href={detailHref(`/parent/video/${v.id}`, "home", kid.id)} className="relative block overflow-hidden rounded-xl bg-sand-soft">
                      <Image src={thumb(v)} alt="" width={320} height={180} unoptimized className="aspect-video w-full object-cover" />
                      {v.durationSeconds ? <span className="absolute bottom-2 right-2 rounded-md bg-forest-900/85 px-1.5 py-0.5 text-xs font-bold text-ivory">{Math.floor(v.durationSeconds / 60)}:{String(v.durationSeconds % 60).padStart(2, "0")}</span> : null}
                    </Link>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-apricot-ink"><IconHand size={16} />{who ? `${who.name} asked for this` : "A child asked for this (which one wasn't recorded)"}</p>
                      <Link href={detailHref(`/parent/video/${v.id}`, "home", kid.id)} className="mt-1 block text-lg font-bold leading-snug text-forest hover:underline line-clamp-2">{v.title}</Link>
                      <p className="text-sm text-muted">{v.channel?.title ?? v.channelId}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={status} />
                        {eligible && v.card && <Tag>AI review: ages {v.card.ageFit.min}–{v.card.ageFit.max}</Tag>}
                        {reasons.filter((x) => x !== "Not in this child's library").slice(0, 3).map((x) => <Tag key={x} className="border-warn/30 bg-warn-soft text-warn">{x}</Tag>)}
                      </div>
                      <form action={resolveWatchRequest} className="mt-4 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="next" value={`/parent?kid=${kid.id}`} />
                        {who ? (
                          <Button type="submit" name="decision" value="approve">Allow for {who.name}{eligible ? "" : " (not reviewed)"}</Button>
                        ) : (
                          <Link href={`/parent/review?kid=${kid.id}`} className={buttonClass("primary")}>Choose a child</Link>
                        )}
                        <Button type="submit" name="decision" value="deny" variant="secondary">Not now</Button>
                        <Link href={detailHref(`/parent/video/${v.id}`, "home", kid.id)} className={buttonClass("quiet", "md")}>See the full review</Link>
                      </form>
                      {!eligible && who && <p className="mt-2 text-xs text-muted">Not reviewed yet: you&apos;ll be asked to confirm before it plays for {who.name}.</p>}
                    </div>
                  </article>
                );
              })}
              {requests.length > 2 && (
                <Link href={`/parent/review?kid=${kid.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-sand-soft">
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
          )}

          {/* ---- the kid screen, in miniature ---- */}
          <section aria-labelledby="screen-h">
            <SectionHeader id="screen-h" title={`On ${kid.name}'s screen`} sub="The first shelves, exactly as they appear right now." action={<Link href="/watch" className="inline-flex items-center gap-1 text-forest hover:underline">Open<IconChevron size={16} /></Link>} />
            <div className="mt-3 rounded-[var(--radius-panel)] bg-forest-900 p-4 text-ivory ring-1 ring-forest sm:p-5" style={{ backgroundImage: "radial-gradient(110% 90% at 85% -10%, rgb(255 159 110 / 0.16) 0%, transparent 55%)" }}>
              {tvShelves.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="font-bold">Nothing on the screen yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-ivory/70">{sources ? `Videos appear here once they're reviewed and fit ${kid.name}'s rules.` : "Add a channel in Library. Its videos appear here once they're reviewed and fit the rules."}</p>
                  {!sources && <Link href={lib_("&tab=sources")} className={buttonClass("warm", "md", "mt-4")}>Add a channel</Link>}
                </div>
              ) : (
                <div className="space-y-4">
                  {tvShelves.map((sh) => (
                    <div key={sh.id}>
                      <p className="mb-2 text-sm font-bold text-ivory/90">{sh.title}</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {sh.videos.slice(0, 4).map((v, i) => (
                          <Link key={v.id} href={detailHref(`/parent/video/${v.id}`, "home", kid.id)} className={`group overflow-hidden rounded-xl bg-forest ring-1 ring-ivory/10 hover:ring-2 hover:ring-apricot ${i >= 2 ? "hidden sm:block" : ""}`}>
                            <Image src={thumb(v)} alt="" width={240} height={135} unoptimized className="aspect-video w-full object-cover" />
                            <p className="truncate px-2.5 py-2 text-xs font-semibold text-ivory/85">{v.title}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tvShelves.length > 0 && <p className="mt-4 text-xs text-ivory/65">{tvShelves.length === 1 ? "1 shelf" : `${tvShelves.length} shelves`} of {home.shelves.length}. {ready} video{ready === 1 ? "" : "s"} ready.</p>}
            </div>
          </section>
        </div>

        {/* ---- side column ---- */}
        <aside className="space-y-6">
          <Card as="section" className="p-5">
            <SectionHeader icon={<IconTv />} title="Today" action={<Link href={`/parent/activity?kid=${kid.id}`} className="text-forest hover:underline">Activity</Link>} />
            <p className="mt-4 text-3xl font-extrabold tracking-tight text-forest">{usedToday} min <span className="text-base font-semibold text-muted">{limit ? `of ${limit}` : "watched"}</span></p>
            {limit ? <div className="mt-2"><Meter value={usedToday} max={limit} label={`${usedToday} of ${limit} minutes watched today`} /></div> : <p className="mt-1 text-sm text-muted">No daily limit. <Link href={`/parent/settings?kid=${kid.id}#time`} className="font-bold text-forest underline">Add one</Link></p>}
            {home.keepWatching.length > 0 ? (
              <>
                <p className="mt-5 text-sm font-semibold text-muted">Recently watched</p>
                <ul className="mt-2 space-y-2">
                  {home.keepWatching.slice(0, 3).map((v) => (
                    <li key={v.id}>
                      <Link href={detailHref(`/parent/video/${v.id}`, "home", kid.id)} className="flex items-center gap-3 rounded-xl p-1 hover:bg-sand-soft">
                        <Image src={thumb(v)} alt="" width={96} height={54} unoptimized className="aspect-video w-20 shrink-0 rounded-lg object-cover" />
                        <span className="min-w-0 text-sm font-semibold leading-snug text-ink line-clamp-2">{v.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-4 text-sm text-muted">Nothing watched recently.</p>}
          </Card>

          <Card as="section" className="p-5">
            <SectionHeader icon={<IconChannels />} title="Library" sub={`${counts.all} video${counts.all === 1 ? "" : "s"} from ${sources} family source${sources === 1 ? "" : "s"}.`} />
            <ul className="mt-3 divide-y divide-sand text-sm">
              <SummaryRow href={lib_("&status=plays")} icon={<IconPlayCircle size={18} />} label={`Ready for ${kid.name}`} value={ready} />
              <SummaryRow href={lib_("&status=reviewing")} icon={<IconClock size={18} />} label="Awaiting review" value={counts.reviewing} />
              <SummaryRow href={lib_("&status=held")} icon={<IconAlert size={18} />} label="Held back by settings" value={heldBack} />
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={lib_()} className={buttonClass("secondary", "sm")}>Open Library</Link>
              <Link href={lib_("&tab=sources")} className={buttonClass("quiet", "sm")}><IconPlus size={14} />Add a channel</Link>
            </div>
          </Card>
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
      <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-full sm:flex sm:h-11 sm:w-11 ${t}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-extrabold leading-none tracking-tight text-forest sm:text-[1.75rem]">{value}{unit && <span className="ml-1 text-base font-bold">{unit}</span>}</span>
        <span className="mt-1 block text-[0.8125rem] font-bold leading-tight text-ink sm:text-sm">{label}</span>
        {sub && <span className="hidden text-xs text-muted sm:block">{sub}</span>}
        {meter && <span className="mt-2 block"><Meter value={meter.value} max={meter.max} label={`${meter.value} of ${meter.max} minutes`} /></span>}
      </span>
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

