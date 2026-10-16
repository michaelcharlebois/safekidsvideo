import Link from "next/link";
import { VideoThumb } from "@/components/video-thumb";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { getLibrary } from "@/lib/queries";
import { reviewEligibility } from "@/lib/gate";
import { holdExplanation } from "@/lib/explain";
import { filterLibrary, GROUP_LABEL, groupByChannel, isLibraryFilter, LIBRARY_FILTERS, LIBRARY_GROUPS, libraryCounts, libraryFor, statusesOf, type LibraryFilter, type LibraryItem } from "@/lib/library";
import { STATUS_LABEL, type PlayStatus } from "@/lib/status";
import { listPendingRequests } from "@/lib/activity";
import { detailHref } from "@/lib/back";
import type { FamilySettings, Profile } from "@/lib/types";
import { Button, buttonClass, Card, EmptyState, Notice, SectionHeader, StatusBadge, Tag } from "@/components/ui";
import { IconArrowDown, IconArrowUp, IconChannels, IconChevron, IconHand, IconKids, IconPlayCircle, IconSearch } from "@/components/icons";
import { ScrollRow } from "@/components/scroll-row";
import { decideVideo, moveChannel, reviewNextBatch, toggleWhitelist } from "@/app/actions";
import { UnreviewedConfirm } from "@/app/parent/unreviewed-confirm";
import { ChannelAvatar } from "@/app/watch/kid-ui";
import { AddPanel } from "./sources";
import { EvidenceList } from "@/app/parent/evidence";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Review 10 now" runs in the background within this budget

const PAGE = 30;
const PER_GROUP = 4;
const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
const FILTER_LABEL = { all: "All", ...Object.fromEntries(LIBRARY_FILTERS.slice(1).map((f) => [f, STATUS_LABEL[f as PlayStatus]])), ...GROUP_LABEL } as Record<LibraryFilter, string>;

/** What a filter means, in one or two sentences, shown above its list. */
function filterNote(f: LibraryFilter, name: string): string | null {
  switch (f) {
    case "plays": return `These pass the AI review and ${name}'s settings, so they're on ${name}'s screen.`;
    case "allowed": return `You allowed these for ${name}. They play for ${name} even if the review or ${name}'s settings would hold them back.`;
    case "held": return `${name}'s settings hold these back. That's Brightframe working as intended, so there's nothing you need to do. Each video lists what the review found; you can make an exception for ${name} after reading it.`;
    case "uncertain": return `These have an AI review that can't be relied on (not confident enough, or incomplete). They stay off ${name}'s screen unless you allow them.`;
    case "reviewing": return `No AI review is stored for these yet. They won't play for ${name} until a review passes, or until you allow one.`;
    case "hidden": return `You chose Keep hidden for these. Unlike a filter, it stays even if ${name}'s settings or the review change later. ${name} can still ask for them.`;
    case "blocked": return `You chose Never for these. ${name} can't watch them or ask for them.`;
    case "ready": return `Everything on ${name}'s screen: videos that pass the AI review and ${name}'s settings, and videos you allowed for ${name}.`;
    case "held_any": return `Everything ${name}'s settings hold back automatically, including videos whose AI review couldn't be relied on. Nothing here needs you; each video says why, and you can make an exception after reading it.`;
    default: return null;
  }
}

/**
 * Library: everything in the family's sources and what each video's status is for ONE child (statuses come
 * from the gate, via lib/library.ts). Filter, search, group by channel; make a per-child exception (Allow),
 * a standing restriction (Keep hidden / Never) or undo one. "Family sources" manages the channels and
 * videos every child shares. Nothing here is a task: automatically held videos are browsed, not cleared.
 */
export default async function LibraryPage(props: PageProps<"/parent/library">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/library" : "/unlock?next=/parent/library");
  const fid = v.familyId;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const profiles = await db.listProfiles(fid);
  const kid = profiles.find((p) => p.id === str("kid")) ?? profiles.find((p) => p.id === v.profileId) ?? profiles[0];
  if (!kid) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-10"><Card><EmptyState icon={<IconKids />} title="Add a child first" action={<Link href="/parent/kids#add" className={buttonClass("primary")}>Add a child</Link>}>Library shows what each child&apos;s settings mean for your family&apos;s videos.</EmptyState></Card></main>;
  }
  const [lib, settings, wl, channels, requests] = await Promise.all([getLibrary(fid, kid.id), db.getSettings(fid, kid.id), db.listWhitelist(fid), db.listChannels(), listPendingRequests(fid)]);
  const name = kid.name;

  // ---- state from the URL ----
  const tab = str("tab") === "sources" ? "sources" : "videos";
  const filter: LibraryFilter = isLibraryFilter(str("status")) ? (str("status") as LibraryFilter) : "all";
  const q = str("q").trim();
  const channelId = channels.some((c) => c.id === str("channel")) ? str("channel") : "";
  const group = str("group") === "list" || str("group") === "channel" ? str("group") : filter === "all" && !q && !channelId ? "channel" : "list";
  const limit = Math.max(PAGE, Math.min(2000, Number(str("n")) || PAGE));
  const href = (over: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams();
    const cur = { kid: kid.id, tab: tab === "sources" ? "sources" : undefined, status: filter === "all" ? undefined : filter, q: q || undefined, channel: channelId || undefined, group: str("group") || undefined, ...over };
    for (const [k, val] of Object.entries(cur)) if (val) p.set(k, val);
    return `/parent/library?${p}`;
  };
  const here = href();

  // ---- the child's library ----
  const items = libraryFor(lib, settings);
  const counts = libraryCounts(items);
  const shown = filterLibrary(items, { filter, channelId, q });
  const familyBlocked = new Set(wl.filter((w) => w.kind === "block" && w.profileId == null).map((w) => w.targetId));
  const familyHidden = new Set(wl.filter((w) => w.kind === "dismissed" && w.profileId == null).map((w) => w.targetId));
  const asked = new Set(requests.filter((r) => r.profileId === kid.id).map((r) => r.videoId));
  const playing = counts.plays + counts.allowed;

  // ---- outcome of the last action ----
  const decidedId = str("video");
  const decidedTitle = decidedId ? lib.find((x) => x.id === decidedId)?.title : undefined;
  const decided = str("decided") && decidedTitle ? decisionNote(str("decided"), decidedTitle, name) : null;
  const confirmVideo = str("via") === "queue" && str("for") === kid.id && str("confirm") ? lib.find((x) => x.id === str("confirm")) : undefined;

  // ---- family sources ----
  const approved = wl.filter((w) => w.kind === "channel" && w.profileId == null).map((w) => w.targetId);
  const kidOrder = settings.channelOrder ?? [];
  const order = [...kidOrder.filter((id) => approved.includes(id)), ...approved.filter((id) => !kidOrder.includes(id))];
  const addedIds = wl.filter((w) => w.kind === "video" && w.profileId == null).map((w) => w.targetId);
  const addedItems = addedIds.map((id) => items.find((i) => i.v.id === id)).filter((x): x is LibraryItem => !!x);

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-display">Library</h1>
          <p className="text-sm text-muted sm:text-base">
            {counts.all ? <><b className="text-forest">{playing} of {counts.all}</b> videos play for {name}.</> : `Nothing in ${name}'s library yet.`}{" "}
            <span className="hidden sm:inline">Your family shares the sources; {name}&apos;s settings decide what plays.</span>
          </p>
        </div>
        {profiles.length > 1 && (
          <nav aria-label="Show the library for" className="flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <Link key={p.id} href={`/parent/library?kid=${p.id}${tab === "sources" ? "&tab=sources" : filter !== "all" ? `&status=${filter}` : ""}`} aria-current={p.id === kid.id ? "true" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${p.id === kid.id ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink hover:border-forest/40"}`}>
                <span aria-hidden>{p.avatar}</span>{p.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* ---- tabs ---- */}
      <nav aria-label="Library" className="mt-5 flex gap-6 border-b border-sand">
        <TabLink href={href({ tab: undefined })} active={tab === "videos"}>Videos <span className="font-semibold text-muted">{counts.all}</span></TabLink>
        <TabLink href={`/parent/library?kid=${kid.id}&tab=sources`} active={tab === "sources"}>Family sources <span className="font-semibold text-muted">{approved.length + addedIds.length}</span></TabLink>
      </nav>

      <div className="mt-4 space-y-3">
        {str("error") && <Notice tone="bad"><b>Not changed:</b> {str("error")}</Notice>}
        {confirmVideo && (
          <UnreviewedConfirm childName={name} title={confirmVideo.title} reason={str("why") || reviewEligibility(confirmVideo.card).reason}
            action={decideVideo} fields={{ videoId: confirmVideo.id, profileId: kid.id, decision: "allow", next: `${here}#v-${confirmVideo.id}` }} cancelHref={here} />
        )}
        {decided && !shown.slice(0, limit).some((i) => i.v.id === decidedId) && <Notice tone="ok">{decided}</Notice>}
        {str("pack") && <Notice tone="ok">Starter pack added to your family&apos;s sources. New videos stay off every screen until an AI review passes.</Notice>}
      </div>

      {tab === "videos" ? (
        <section aria-label={`${name}'s videos`} className="mt-4">
          {/* ---- filters ---- */}
          <ScrollRow label="Filter by status" activeKey={filter} className="-mx-4 px-4 sm:mx-0 sm:px-0">
            {LIBRARY_FILTERS.map((f) => { const on = f === filter || (f !== "all" && filter in LIBRARY_GROUPS && (statusesOf(filter) ?? []).includes(f as PlayStatus)); return (
              <li key={f} className="snap-start">
                <Link href={href({ status: f === "all" ? undefined : f, group: undefined })} data-active={on ? "" : undefined} aria-current={on ? "true" : undefined}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${on ? "border-forest bg-forest text-ivory" : counts[f] ? "border-sand bg-surface text-ink hover:border-forest/40" : "border-sand/70 bg-transparent text-muted"}`}>
                  {FILTER_LABEL[f]} <span className={on ? "opacity-80" : "text-muted"}>{counts[f]}</span>
                </Link>
              </li>
            ); })}
          </ScrollRow>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action="/parent/library" className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto" role="search">
              <input type="hidden" name="kid" value={kid.id} />
              {filter !== "all" && <input type="hidden" name="status" value={filter} />}
              {channelId && <input type="hidden" name="channel" value={channelId} />}
              <label className="sr-only" htmlFor="lib-q">Find a video or channel</label>
              <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input id="lib-q" name="q" type="search" defaultValue={q} placeholder="Find a video or channel" className="h-10 w-full rounded-full border border-sand bg-surface pl-9 pr-4 text-sm outline-none focus:border-forest" />
            </form>
            <div role="group" aria-label="Show" className="inline-flex rounded-full border border-sand bg-surface p-0.5 text-sm font-bold">
              <Link href={href({ group: "channel" })} aria-current={group === "channel" ? "true" : undefined} className={`rounded-full px-3 py-1.5 ${group === "channel" ? "bg-sage-soft text-forest" : "text-muted hover:text-forest"}`}>By channel</Link>
              <Link href={href({ group: "list" })} aria-current={group === "list" ? "true" : undefined} className={`rounded-full px-3 py-1.5 ${group === "list" ? "bg-sage-soft text-forest" : "text-muted hover:text-forest"}`}>All videos</Link>
            </div>
          </div>

          {(channelId || q) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              Showing {shown.length} {filter === "all" ? "" : `${FILTER_LABEL[filter].toLowerCase()} `}video{shown.length === 1 ? "" : "s"}
              {channelId && <> from <b className="text-ink">{channels.find((c) => c.id === channelId)?.title ?? channelId}</b></>}
              {q && <> matching <b className="text-ink">“{q}”</b></>}.
              <Link href={href({ q: undefined, channel: undefined })} className="font-bold text-forest underline">Clear</Link>
            </p>
          )}

          {filter in LIBRARY_GROUPS && <p className="mt-3 text-sm font-bold text-forest">{FILTER_LABEL[filter]}: {counts[filter]} video{counts[filter] === 1 ? "" : "s"}</p>}
          {filterNote(filter, name) && <p className="mt-3 rounded-[var(--radius-card)] bg-sand-soft px-4 py-3 text-sm text-ink">{filterNote(filter, name)}</p>}
          {filter === "reviewing" && counts.reviewing > 0 && process.env.GEMINI_API_KEY && (
            <form action={reviewNextBatch} className="mt-2 text-sm text-muted">
              <input type="hidden" name="n" value={10} /><input type="hidden" name="next" value={here} />
              {str("batch") ? <span><b className="text-ink">Review requested</b> for up to {str("batch")} videos. They show a new status here once a review is stored.</span> : <button type="submit" className="font-bold text-forest underline">Review 10 now</button>}
            </form>
          )}

          <div className="mt-4">
            {shown.length === 0 ? (
              <Card>
                <EmptyState icon={<IconPlayCircle />} title={counts.all === 0 ? `Nothing in ${name}'s library yet` : filter !== "all" && !q && !channelId ? `Nothing ${FILTER_LABEL[filter].toLowerCase()} for ${name}` : "No videos match"}
                  action={counts.all === 0 ? <Link href={`/parent/library?kid=${kid.id}&tab=sources`} className={buttonClass("primary")}>Add a channel</Link> : <Link href={href({ status: undefined, q: undefined, channel: undefined })} className={buttonClass("secondary")}>Show everything</Link>}>
                  {counts.all === 0 ? "Add a channel or a starter pack. New videos are reviewed before any can play." : "Try another filter or search."}
                </EmptyState>
              </Card>
            ) : group === "channel" ? (
              <div className="space-y-5">
                {groupByChannel(shown, items, settings.channelOrder).map((g) => {
                  const rows = channelId ? g.items.slice(0, limit) : g.items.slice(0, PER_GROUP);
                  return (
                    <Card as="section" key={g.channelId} className="overflow-hidden">
                      <div className="flex items-center gap-3 border-b border-sand px-4 py-3 sm:px-5">
                        <ChannelAvatar channel={g.channel} name={g.title} size={36} />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate text-base font-bold leading-tight text-forest">{g.title}</h2>
                          <p className="text-xs text-muted">{g.plays} of {g.total} play for {name}</p>
                        </div>
                        <Link href={detailHref(`/parent/channel/${g.channelId}`, "library", kid.id)} className="shrink-0 text-sm font-bold text-forest underline decoration-sand underline-offset-4">Channel</Link>
                      </div>
                      <ul className="divide-y divide-sand">
                        {rows.map((i) => <Row key={i.v.id} i={i} kid={kid} settings={settings} here={here} familyBlocked={familyBlocked} familyHidden={familyHidden} asked={asked} decided={decidedId === i.v.id ? decided : null} openFindings={filter === "held"} />)}
                      </ul>
                      {g.items.length > rows.length && (
                        <Link href={href({ channel: g.channelId, group: "list" })} className="flex items-center justify-between gap-2 border-t border-sand px-4 py-3 text-sm font-bold text-forest hover:bg-sand-soft sm:px-5">
                          Show all {g.items.length}{filter === "all" ? "" : ` ${FILTER_LABEL[filter].toLowerCase()}`} from {g.title}<IconChevron size={16} />
                        </Link>
                      )}
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-sand">
                  {shown.slice(0, limit).map((i) => <Row key={i.v.id} i={i} kid={kid} settings={settings} here={here} familyBlocked={familyBlocked} familyHidden={familyHidden} asked={asked} decided={decidedId === i.v.id ? decided : null} showChannel openFindings={filter === "held"} />)}
                </ul>
                {shown.length > limit && (
                  <Link href={`${href({ n: String(limit + PAGE) })}`} className="flex justify-center border-t border-sand px-4 py-3 text-sm font-bold text-forest hover:bg-sand-soft">Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}</Link>
                )}
              </Card>
            )}
          </div>
        </section>
      ) : (
        /* ---- family sources ---- */
        <section aria-label="Family sources" className="mt-4">
          <p className="rounded-[var(--radius-card)] bg-sage-soft px-4 py-3 text-sm text-ink">
            <b className="text-forest">Family sources are shared by every child.</b> Adding a channel brings its videos into each child&apos;s library, and each child&apos;s own settings decide what plays for them. Removing a source doesn&apos;t undo a video you allowed for a child.
          </p>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-6">
              <Card as="section" className="overflow-hidden">
                <div className="border-b border-sand px-4 py-4 sm:px-5">
                  <SectionHeader icon={<IconChannels />} title="Channels" sub={`In ${name}'s order: it sets the order of channel rows on ${name}'s home screen.`} />
                </div>
                {order.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted">No channels yet. Search for one, or add a starter pack.</p>
                ) : (
                  <ul className="divide-y divide-sand">
                    {order.map((id, idx) => {
                      const c = channels.find((x) => x.id === id);
                      const mine = items.filter((i) => i.v.channelId === id);
                      const title = c?.title ?? mine[0]?.v.channel?.title ?? id;
                      const plays = mine.filter((i) => i.status === "plays" || i.status === "allowed").length;
                      return (
                        <li key={id} className="flex flex-wrap items-center gap-1 py-1 pl-1 pr-3 sm:pr-4">
                          <div className="flex flex-col text-muted">
                            <MoveButton kidId={kid.id} channelId={id} dir="up" disabled={idx === 0} label={`Move ${title} up`} next={`/parent/library?kid=${kid.id}&tab=sources`} />
                            <MoveButton kidId={kid.id} channelId={id} dir="down" disabled={idx === order.length - 1} label={`Move ${title} down`} next={`/parent/library?kid=${kid.id}&tab=sources`} />
                          </div>
                          <Link href={href({ tab: undefined, channel: id, group: "list", status: undefined, q: undefined })} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sand-soft">
                            <ChannelAvatar channel={c} name={title} size={40} />
                            <span className="min-w-0">
                              <span className="block truncate font-bold text-forest">{title}</span>
                              <span className="block text-xs text-muted">{mine.length ? `${plays} of ${mine.length} play for ${name}` : "No videos yet"}</span>
                            </span>
                          </Link>
                          <details className="min-w-0 max-w-[18rem]">
                            <summary className="cursor-pointer list-none rounded-full px-3 py-2 text-sm font-bold text-muted hover:bg-sand-soft hover:text-forest">Remove</summary>
                            <div className="mt-2 space-y-2 rounded-xl border border-sand bg-sand-soft p-3 text-sm">
                              <p>Remove <b>{title}</b> for every child? Videos you allowed for a child stay allowed.</p>
                              <form action={toggleWhitelist}>
                                <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={id} /><input type="hidden" name="on" value="0" />
                                <Button type="submit" variant="danger" size="sm">Confirm removal</Button>
                              </form>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card as="section" className="overflow-hidden">
                <div className="border-b border-sand px-4 py-4 sm:px-5">
                  <SectionHeader icon={<IconPlayCircle />} title="Videos added one at a time" sub={`Shared like channels. What each means for ${name}:`} />
                </div>
                {addedItems.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted">None yet. Add a single video from search, or from a video&apos;s page.</p>
                ) : (
                  <ul className="divide-y divide-sand">
                    {addedItems.map((i) => (
                      <li key={i.v.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                        <Link href={detailHref(`/parent/video/${i.v.id}`, "library", kid.id)} className="shrink-0"><VideoThumb src={thumb(i.v)} width={128} height={72} className="aspect-video w-24 rounded-lg object-cover" /></Link>
                        <div className="min-w-0 flex-1">
                          <Link href={detailHref(`/parent/video/${i.v.id}`, "library", kid.id)} className="block text-sm font-bold leading-snug text-forest hover:underline line-clamp-2">{i.v.title}</Link>
                          <StatusBadge status={i.status} className="mt-1 py-0.5" />
                        </div>
                        <form action={toggleWhitelist}>
                          <input type="hidden" name="kind" value="video" /><input type="hidden" name="targetId" value={i.v.id} /><input type="hidden" name="on" value="0" />
                          <Button type="submit" variant="quiet" size="sm">Remove</Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <aside className="space-y-6">
              <AddPanel approvedChannels={new Set(approved)} lib={lib} packAdded={str("pack") || undefined} next={`/parent/library?kid=${kid.id}&tab=sources`} />
              {channels.some((c) => !approved.includes(c.id)) && (
                <Card as="section" className="p-5">
                  <SectionHeader title="Reviewed for other families" sub="Channels Brightframe already reviews. Adding one brings its videos into every child's library; each child's settings still decide what plays." />
                  <ul className="mt-3 space-y-2">
                    {channels.filter((c) => !approved.includes(c.id)).slice(0, 8).map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <ChannelAvatar channel={c} name={c.title} size={28} />
                        <Link href={detailHref(`/parent/channel/${c.id}`, "library", kid.id)} className="min-w-0 flex-1 truncate font-semibold hover:underline">{c.title}</Link>
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
        </section>
      )}
    </main>
  );
}

function decisionNote(d: string, title: string, name: string): string | null {
  if (d === "allow") return `Allowed for ${name}: “${title}”.`;
  if (d === "hide") return `Kept hidden for ${name}: “${title}”. It stays hidden even if ${name}'s settings change.`;
  if (d === "never") return `Never for ${name}: “${title}”. ${name} can't watch it or ask for it.`;
  if (d === "undo") return `“${title}” is back to ${name}'s normal rules.`;
  return null;
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 text-[0.95rem] font-bold ${active ? "border-forest text-forest" : "border-transparent text-muted hover:text-forest"}`}>
      {children}
    </Link>
  );
}

function MoveButton({ kidId, channelId, dir, disabled, label, next }: { kidId: string; channelId: string; dir: "up" | "down"; disabled: boolean; label: string; next: string }) {
  return (
    <form action={moveChannel}>
      <input type="hidden" name="profileId" value={kidId} /><input type="hidden" name="channelId" value={channelId} /><input type="hidden" name="dir" value={dir} /><input type="hidden" name="next" value={next} />
      <button type="submit" disabled={disabled} aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand-soft hover:text-forest disabled:opacity-25 sm:h-8 sm:w-8">
        {dir === "up" ? <IconArrowUp size={18} /> : <IconArrowDown size={18} />}
      </button>
    </form>
  );
}

/** One per-child decision about one video (existing decideVideo semantics). */
function Decide({ videoId, profileId, next, decision, children, variant = "secondary" }: {
  videoId: string; profileId: string; next: string; decision: "allow" | "hide" | "never" | "undo"; children: ReactNode; variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return (
    <form action={decideVideo}>
      <input type="hidden" name="videoId" value={videoId} /><input type="hidden" name="profileId" value={profileId} /><input type="hidden" name="next" value={next} />
      <Button type="submit" name="decision" value={decision} variant={variant} size="sm">{children}</Button>
    </form>
  );
}

/** One video and what it means for this child, with the per-child choices that fit its status. */
function Row({ i, kid, settings, here, familyBlocked, familyHidden, asked, decided, showChannel = false, openFindings = false }: {
  i: LibraryItem; kid: Profile; settings: FamilySettings; here: string; familyBlocked: Set<string>; familyHidden: Set<string>; asked: Set<string>; decided: string | null; showChannel?: boolean; openFindings?: boolean;
}) {
  const { v, status } = i;
  const name = kid.name;
  const video = detailHref(`/parent/video/${v.id}`, "library", kid.id);
  const next = `${here}#v-${v.id}`;
  const familyWide = (status === "blocked" && familyBlocked.has(v.id)) || (status === "hidden" && familyHidden.has(v.id));
  const hold = status === "held" || status === "uncertain" || status === "reviewing" ? holdExplanation(v, settings) : null;
  // The findings behind an automatic hold (AI review, other parents, settings), to read before any exception.
  const findings = status === "held" ? (hold?.evidence ?? []).filter((e) => e.source !== "review") : [];
  const why =
    hold ? hold.summary
    : status === "allowed" ? `You allowed it for ${name}. It plays even if the review or ${name}'s settings would hold it back.`
    : status === "hidden" ? (familyWide ? "Kept hidden for every child (decided before per-child permissions)." : `You chose Keep hidden for ${name}. It stays off ${name}'s screen even if the settings or review change.`)
    : status === "blocked" ? (familyWide ? "Blocked for the whole family." : `You chose Never for ${name}.`)
    : null;
  const unreviewed = !reviewEligibility(v.card).eligible;
  const at = { videoId: v.id, profileId: kid.id, next };
  const restrictions = (
    <details className="group">
      <summary className="-ml-1 cursor-pointer list-none rounded-full px-1 py-1.5 text-xs font-bold text-forest underline decoration-sand underline-offset-4 hover:bg-sand-soft">
        {status === "plays" ? `Change for ${name}` : "Other choices"}
      </summary>
      <div className="mt-2 space-y-2 rounded-xl border border-sand bg-ivory p-3 text-sm">
        <div className="flex flex-wrap items-start gap-2">
          <Decide {...at} decision="hide">Keep hidden</Decide>
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted">A standing choice for {name}, not a way to clear a notice: it stays off {name}&apos;s screen even if the settings or review change later. {name} can still ask for it.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Decide {...at} decision="never" variant="danger">Never for {name}</Decide>
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted">Blocked for {name}, who can&apos;t ask for it either.</p>
        </div>
      </div>
    </details>
  );

  return (
    <li id={`v-${v.id}`} className="scroll-mt-28 px-4 py-4 sm:px-5 sm:py-3.5">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
        <Link href={video} className="relative block self-start overflow-hidden rounded-xl bg-sand-soft sm:row-span-2" aria-label={`Open ${v.title}`}>
          <VideoThumb src={thumb(v)} width={320} height={180} className={`aspect-video w-full object-cover ${status === "plays" || status === "allowed" ? "" : "opacity-80"}`} />
          {v.durationSeconds ? <span className="absolute bottom-1 right-1 rounded bg-forest-900/85 px-1 text-[11px] font-bold text-ivory">{Math.floor(v.durationSeconds / 60)}:{String(v.durationSeconds % 60).padStart(2, "0")}</span> : null}
        </Link>
        <div className="min-w-0 space-y-1.5">
          <Link href={video} className="block font-bold leading-snug text-forest hover:underline line-clamp-2">{v.title}</Link>
          {showChannel && <p className="truncate text-xs text-muted">{v.channel?.title ?? v.channelId}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={status} className="py-0.5" />
            {asked.has(v.id) && <Link href={`/parent/review?kid=${kid.id}`}><Tag className="border-apricot/40 bg-apricot-soft text-apricot-ink"><IconHand size={12} />{name} asked · Review</Tag></Link>}
          </div>
          {/* A video that plays rarely needs changing: keep its choices tucked beside it, not in a row of their own. */}
          {status === "plays" && restrictions}
          {why && <p className="hidden text-sm text-muted sm:block">{why}</p>}
        </div>
        {/* Phone: reason and actions span the row under the thumbnail. */}
        {(status !== "plays" || decided) && <div className="col-span-2 space-y-2 sm:col-span-1 sm:col-start-2">
          {why && <p className="text-sm text-muted sm:hidden">{why}</p>}
          {findings.length > 0 && (openFindings
            ? <EvidenceList items={findings} videoId={v.id} />
            : (
              <details className="rounded-xl border border-sand">
                <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-forest">What the review found ({findings.length})</summary>
                <div className="border-t border-sand p-2"><EvidenceList items={findings} videoId={v.id} /></div>
              </details>
            ))}
          {decided && <Notice tone="ok" className="py-2 text-sm">{decided}</Notice>}
          <div className="flex flex-wrap items-center gap-2 empty:hidden">
            {(status === "held" || status === "uncertain" || status === "reviewing") && <>
              {/* An exception is deliberate: secondary, after the findings, with the full review one tap away. */}
              <Decide {...at} decision="allow">Allow exception for {name}</Decide>
              <Link href={video} className={buttonClass("quiet", "sm")}>Full review</Link>
              {restrictions}
            </>}
            {status === "allowed" && <Decide {...at} decision="undo">Undo allow</Decide>}
            {(status === "hidden" || status === "blocked") && (familyWide
              ? <Link href={video} className={buttonClass("secondary", "sm")}>Change on the video page</Link>
              : <Decide {...at} decision="undo">{status === "hidden" ? "Stop keeping hidden" : `Unblock for ${name}`}</Decide>)}
          </div>
          {unreviewed && (status === "uncertain" || status === "reviewing") && <p className="text-xs text-muted">Allowing it will ask you to confirm first, because no reliable AI review applies.</p>}
        </div>}
      </div>
    </li>
  );
}
