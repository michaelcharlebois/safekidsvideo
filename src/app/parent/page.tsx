import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { MODE_LABELS, type VideoWithCard } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { approvePack, grantMoreTime, moveChannel, resolveWatchRequest, reviewNextBatch, toggleWhitelist } from "@/app/actions";
import { watchEventsSince } from "@/lib/checkin";
import { forKid, orderShelves, tasteFrom } from "@/lib/arrange";
import { listPendingRequests, recentWatchIds } from "@/lib/activity";
import { AddForm } from "./add-form";
import { SearchAdd } from "./search-add";
import { PACKS } from "@/lib/packs";
import { billingStatus } from "@/lib/billing";
import { ChannelAvatar } from "@/app/watch/kid-ui";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background batch reviews run within this budget

type View = "visible" | "hidden" | "unreviewed";
const thumb = (v: { id: string; thumbnailUrl?: string }) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

/**
 * Home. Phone-first. In order: anything that needs you (only if non-zero), what the kid actually sees
 * right now (a miniature of their TV), the library by channel, and a way to add more.
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
  const [lib, settings, channels, requests, wl, recent, events] = await Promise.all([
    getLibrary(fid), db.getSettings(fid, kidId), db.listChannels(), listPendingRequests(fid), db.listWhitelist(fid), recentWatchIds(fid, 6, kidId),
    watchEventsSince(fid, new Date(Date.now() - 30 * 86_400_000).toISOString()), // eslint-disable-line react-hooks/purity -- server component
  ]);
  const approvedChannels = new Set(wl.filter((w) => w.kind === "channel").map((w) => w.targetId));
  const moreAsk = typeof sp.more === "string" ? profiles.find((p) => p.id === sp.more) : undefined;
  const batchStarted = typeof sp.batch === "string" ? Number(sp.batch) : 0;
  const view: View | undefined = (["visible", "hidden", "unreviewed"] as View[]).includes(sp.view as View) ? (sp.view as View) : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const byId = new Map(lib.map((v) => [v.id, v]));

  const mine = lib.filter((v) => v.whitelisted);
  const reviewed = (v: VideoWithCard) => !!v.card && v.card.reviewer.model !== "sample";
  const status = (v: VideoWithCard): View => (!reviewed(v) ? "unreviewed" : blockedReasons(v, settings).length ? "hidden" : "visible");
  const visible = mine.filter((v) => status(v) === "visible");
  const undecided = mine.filter((v) => status(v) === "hidden" && !v.dismissed && !v.overridden);
  const backlog = mine.filter((v) => status(v) === "unreviewed" && (v.durationSeconds ?? 0) <= 20 * 60).length;
  const needsYou = requests.length + undecided.length + (moreAsk ? 1 : 0);

  // The TV, in miniature: the same shelves the kid sees.
  const keepWatching = recent.map((id) => byId.get(id)).filter((v): v is VideoWithCard => !!v && status(v) === "visible");
  const byChannel = new Map<string, VideoWithCard[]>();
  for (const v of visible) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  const taste = tasteFrom(events.filter((e) => !kidId || e.profileId === kidId || !e.profileId), byId);
  const forYou = visible.length >= 6 ? forKid(visible, settings, taste, 8) : [];
  const tvShelves = [
    ...(forYou.length ? [{ id: "for-you", title: `For ${kid?.name ?? "you"}`, videos: forYou }] : []),
    ...(keepWatching.length ? [{ id: "recent", title: "Keep watching", videos: keepWatching }] : []),
    ...orderShelves([...byChannel.entries()].map(([id, vids]) => ({ id, title: vids[0].channel?.title ?? id, videos: vids.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) })), settings.channelOrder),
  ].slice(0, 3);

  // Library by channel.
  const groups = [...approvedChannels].map((id) => {
    const vids = mine.filter((v) => v.channelId === id);
    const channel = channels.find((c) => c.id === id);
    return { id, title: channel?.title ?? vids[0]?.channel?.title ?? id, channel, vids, visible: vids.filter((v) => status(v) === "visible").length, hidden: vids.filter((v) => status(v) === "hidden").length, unreviewed: vids.filter((v) => status(v) === "unreviewed").length };
  });
  const orderedGroups = orderShelves(groups.map((g) => ({ ...g, videos: g.vids.filter((v) => status(v) === "visible") })), settings.channelOrder);
  const filtered = (view || q)
    ? groups.map((g) => ({ ...g, shown: g.vids.filter((v) => (!view || status(v) === view) && (!q || v.title.toLowerCase().includes(q))).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) })).filter((g) => g.shown.length)
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-4 lg:grid lg:grid-cols-[1fr_22rem] lg:gap-8">
      <section className="space-y-6">
        {/* ---- who ---- */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl">{kid ? `${kid.name}'s Sift` : "Sift"}</h1>
            {kid && <p className="text-sm text-muted">{MODE_LABELS[settings.mode].title}{settings.dailyMinutes ? `, ${settings.dailyMinutes} min a day` : ""}{settings.bedtime ? `, done at ${settings.bedtime}` : ""} — <Link href={`/parent/settings?kid=${kidId}`} className="underline">change</Link></p>}
          </div>
          {profiles.length > 1 && (
            <div className="flex -space-x-2">
              {profiles.map((p) => (
                <Link key={p.id} href={`/parent?kid=${p.id}`} title={p.name} className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-surface text-xl ${p.id === kidId ? "border-ink z-10" : "border-bg opacity-60 hover:opacity-100"}`}>{p.avatar}</Link>
              ))}
            </div>
          )}
        </div>

        {/* ---- needs you (only when it does) ---- */}
        {!billing.ok && (
          <Card className="p-4 border-bad/40">
            <p className="font-extrabold">{billing.state === "past_due" ? "There's a payment problem." : "Your free trial has ended."}</p>
            <p className="mt-1 text-sm text-muted">The TV keeps playing what&apos;s already approved. New approvals and searches are paused.</p>
            <Link href="/parent/billing" className="mt-3 inline-block"><Button>Subscribe</Button></Link>
          </Card>
        )}
        {billing.ok && billing.state === "trial" && (billing.daysLeft ?? 99) <= 7 && (
          <p className="text-sm text-muted">{billing.daysLeft} day{billing.daysLeft === 1 ? "" : "s"} left in your trial. <Link href="/parent/billing" className="font-bold underline">Keep Sift going</Link></p>
        )}

        {needsYou > 0 ? (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg"><span className="inline-block h-2.5 w-2.5 rounded-full bg-sun" />Needs you</h2>
            {moreAsk && (
              <Card className="p-4">
                <p className="font-extrabold">{moreAsk.avatar} {moreAsk.name} is asking for more time today</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[15, 30, 60].map((m) => (
                    <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={moreAsk.id} /><input type="hidden" name="minutes" value={m} /><Button type="submit" className="px-4">+{m} min</Button></form>
                  ))}
                  <Link href="/parent" className="self-center text-sm font-bold text-muted hover:text-ink">Not today</Link>
                </div>
              </Card>
            )}
            {requests.map((r) => {
              const v = byId.get(r.videoId);
              if (!v) return null;
              const why = blockedReasons(v, settings);
              const who = profiles.find((p) => p.id === r.profileId);
              return (
                <Card key={r.id} className="overflow-hidden">
                  <div className="flex gap-3 p-3">
                    <Link href={`/parent/video/${v.id}`} className="shrink-0"><Image src={thumb(v)} alt="" width={160} height={90} unoptimized className="w-32 rounded-lg aspect-video object-cover bg-line" /></Link>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-muted">{who?.avatar ?? "🙋"} {who?.name ?? "Your kid"} asked for</p>
                      <Link href={`/parent/video/${v.id}`} className="font-extrabold leading-snug hover:underline line-clamp-2">{v.title}</Link>
                      <p className="text-xs text-muted">{v.channel?.title}{v.card ? ` — rated ${v.card.rating}/5 for ages ${v.card.ageFit.min}–${v.card.ageFit.max}` : " — not reviewed yet"}</p>
                      {why.length > 0 && <p className="text-xs font-bold text-bad">Hidden: {why.join(", ")}</p>}
                    </div>
                  </div>
                  <form action={resolveWatchRequest} className="flex gap-2 border-t border-line px-3 py-2">
                    <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="videoId" value={v.id} /><input type="hidden" name="next" value="/parent" />
                    <Button type="submit" name="decision" value="approve" className="px-4">Allow</Button>
                    <Button type="submit" name="decision" value="deny" variant="ghost">Not now</Button>
                    <Link href={`/parent/review`} className="ml-auto self-center text-xs font-bold text-muted hover:text-ink">See the card</Link>
                  </form>
                </Card>
              );
            })}
            {undecided.length > 0 && (
              <Link href={`/parent/review?kid=${kidId ?? ""}`} className="block">
                <Card className="flex items-center gap-3 p-3 hover:bg-surface/60">
                  <div className="flex -space-x-6">
                    {undecided.slice(0, 3).map((v) => <Image key={v.id} src={thumb(v)} alt="" width={96} height={54} unoptimized className="w-20 rounded-lg aspect-video object-cover bg-line ring-2 ring-surface" />)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{undecided.length} video{undecided.length === 1 ? "" : "s"} your filters are hiding</p>
                    <p className="text-sm text-muted">Reviewed and waiting on your call. Allow, keep hidden, or never.</p>
                  </div>
                  <span className="text-muted">›</span>
                </Card>
              </Link>
            )}
          </section>
        ) : (
          <p className="inline-flex items-center gap-2 rounded-full bg-grass/70 px-3 py-1.5 text-sm font-bold text-ink"><span className="h-2 w-2 rounded-full bg-ok" />All clear — nothing needs you</p>
        )}

        {/* ---- the TV ---- */}
        <section>
          <h2 className="text-lg">What {kid?.name ?? "your kid"} sees right now</h2>
          <div className="mt-2 rounded-[1.5rem] bg-[#0b1020] p-3 text-white shadow-[0_24px_60px_-24px_rgba(20,26,58,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10 sm:p-4" style={{ backgroundImage: "radial-gradient(120% 80% at 50% -10%, #223064 0%, #0b1020 55%)" }}>
            {tvShelves.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-3xl">📺</p>
                <p className="mt-2 font-extrabold">Nothing here yet</p>
                <p className="text-sm text-white/60">Approve a channel below and the first videos appear after they&apos;re reviewed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {tvShelves.map((s) => (
                  <div key={s.id}>
                    <p className="mb-1.5 text-xs font-extrabold text-white/80">{s.title}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {s.videos.slice(0, 4).map((v, i) => (
                        <Link key={v.id} href={`/parent/video/${v.id}`} className={`overflow-hidden rounded-xl bg-[#141b33] ring-1 ring-white/5 transition hover:ring-[#ffcf3f] ${i === 3 ? "hidden sm:block" : ""}`}>
                          <Image src={thumb(v)} alt="" width={160} height={90} unoptimized className="aspect-video w-full object-cover" />
                          <p className="truncate px-2 py-1.5 text-[11px] font-bold text-white/75">{v.title}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-white/60">
              <span>{visible.length} video{visible.length === 1 ? "" : "s"} across {byChannel.size} channel{byChannel.size === 1 ? "" : "s"}</span>
              <Link href="/watch" className="font-bold text-white/80 hover:text-white">Open the kid screen →</Link>
            </div>
          </div>
        </section>

        {/* ---- library ---- */}
        <section id="channels">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg">Channels <span className="text-sm font-normal text-muted">in {kid?.name ?? "the kid"}&apos;s order</span></h2>
            <form action="/parent" className="flex-1 max-w-xs">
              <input type="hidden" name="kid" value={kidId ?? ""} />
              <input name="q" defaultValue={q} type="search" placeholder="Find a video" className="w-full rounded-full border border-line bg-surface px-4 py-1.5 text-sm outline-none focus:border-ink" />
            </form>
          </div>
          {(view || q) && (
            <p className="mt-2 text-sm text-muted">
              Showing {view ?? "all"}{q ? ` matching “${q}”` : ""}. <Link href={`/parent?kid=${kidId ?? ""}`} className="font-bold underline">Clear</Link>
            </p>
          )}
          {filtered ? (
            <ul className="mt-3 space-y-4">
              {filtered.length === 0 && <li className="text-sm text-muted">Nothing matches.</li>}
              {filtered.map((g) => (
                <li key={g.id}>
                  <p className="flex items-center gap-2 font-extrabold"><ChannelAvatar channel={g.channel} name={g.title} size={24} />{g.title}</p>
                  <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {g.shown.slice(0, 12).map((v) => <VideoTile key={v.id} v={v} st={status(v)} why={blockedReasons(v, settings)} />)}
                  </ul>
                  {g.shown.length > 12 && <p className="mt-1 text-xs text-muted"><Link href={`/parent/channel/${g.id}`} className="underline">{g.shown.length - 12} more on the channel page</Link></p>}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
              {groups.length === 0 && <li className="p-4 text-sm text-muted">No channels yet. Add a starter pack below.</li>}
              {orderedGroups.map((g, idx) => (
                <li key={g.id} className="flex items-center">
                  <div className="flex flex-col pl-2 text-muted">
                    <form action={moveChannel}><input type="hidden" name="profileId" value={kidId ?? ""} /><input type="hidden" name="channelId" value={g.id} /><input type="hidden" name="dir" value="up" /><button type="submit" disabled={idx === 0} aria-label="Move up" className="block px-1 text-xs leading-none hover:text-ink disabled:opacity-20">▲</button></form>
                    <form action={moveChannel}><input type="hidden" name="profileId" value={kidId ?? ""} /><input type="hidden" name="channelId" value={g.id} /><input type="hidden" name="dir" value="down" /><button type="submit" disabled={idx === orderedGroups.length - 1} aria-label="Move down" className="block px-1 text-xs leading-none hover:text-ink disabled:opacity-20">▼</button></form>
                  </div>
                  <Link href={`/parent/channel/${g.id}`} className="flex flex-1 items-center gap-3 px-3 py-2.5 hover:bg-bg/60">
                    <ChannelAvatar channel={g.channel} name={g.title} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-extrabold">{g.title}</span>
                      <span className="block text-xs text-muted">
                        {g.visible ? `${g.visible} ready` : "nothing ready yet"}{g.hidden ? `, ${g.hidden} hidden` : ""}{g.unreviewed ? `, ${g.unreviewed} being reviewed` : ""}
                      </span>
                    </span>
                    <span className="hidden sm:flex -space-x-3">
                      {g.vids.filter((v) => status(v) === "visible").slice(0, 3).map((v) => (
                        <Image key={v.id} src={thumb(v)} alt="" width={64} height={36} unoptimized className="h-9 w-16 rounded-md object-cover ring-2 ring-surface" />
                      ))}
                    </span>
                    <span className="text-muted">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!view && !q && (
            <p className="mt-2 text-xs text-muted">
              Browse every video:{" "}
              <Link href={`/parent?kid=${kidId ?? ""}&view=visible`} className="font-bold underline">ready</Link>,{" "}
              <Link href={`/parent?kid=${kidId ?? ""}&view=hidden`} className="font-bold underline">hidden</Link>,{" "}
              <Link href={`/parent?kid=${kidId ?? ""}&view=unreviewed`} className="font-bold underline">being reviewed</Link>
            </p>
          )}
        </section>

        {/* ---- add ---- */}
        <section id="add" className="lg:hidden"><AddPanel approvedChannels={approvedChannels} lib={lib} packAdded={typeof sp.pack === "string" ? sp.pack : undefined} /></section>

        {/* ---- pipeline, demoted ---- */}
        {backlog > 0 && (
          <form action={reviewNextBatch} className="text-xs text-muted">
            <input type="hidden" name="n" value={10} />
            {backlog} more video{backlog === 1 ? "" : "s"} will be reviewed overnight.{" "}
            {batchStarted ? <span className="font-bold text-ok">Reviewing {batchStarted} now — give it a few minutes.</span> : <button type="submit" className="font-bold underline hover:text-ink">Review 10 now</button>}
          </form>
        )}
      </section>

      <aside className="hidden lg:block space-y-4">
        <AddPanel approvedChannels={approvedChannels} lib={lib} packAdded={typeof sp.pack === "string" ? sp.pack : undefined} />
        {channels.some((c) => !approvedChannels.has(c.id)) && (
          <Card className="p-4">
            <h2 className="font-extrabold">Also in the shared library</h2>
            <p className="text-xs text-muted">Reviewed by Sift for other families. One tap to allow.</p>
            <ul className="mt-2 space-y-1.5">
              {channels.filter((c) => !approvedChannels.has(c.id)).slice(0, 12).map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <ChannelAvatar channel={c} name={c.title} size={24} />
                  <Link href={`/parent/channel/${c.id}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">{c.title}</Link>
                  <form action={toggleWhitelist}>
                    <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={c.id} /><input type="hidden" name="on" value="1" />
                    <Button type="submit" variant="ghost" className="text-xs px-2.5 py-0.5">Allow</Button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </main>
  );
}

function VideoTile({ v, st, why }: { v: VideoWithCard; st: View; why: string[] }) {
  return (
    <li>
      <Link href={`/parent/video/${v.id}`} className="block overflow-hidden rounded-xl bg-surface border border-line hover:border-ink/30">
        <Image src={thumb(v)} alt="" width={320} height={180} unoptimized className={`aspect-video w-full object-cover ${st !== "visible" ? "opacity-70" : ""}`} />
        <div className="p-2">
          <p className="text-xs font-bold leading-snug line-clamp-2">{v.title}</p>
          <p className={`mt-0.5 text-[11px] ${st === "hidden" ? "text-bad" : "text-muted"}`}>{st === "visible" ? (v.card ? `★ ${v.card.rating}` : "ready") : st === "hidden" ? (v.dismissed ? "kept hidden" : why.join(", ")) : "being reviewed"}</p>
        </div>
      </Link>
    </li>
  );
}

function AddPanel({ approvedChannels, lib, packAdded }: { approvedChannels: Set<string>; lib: VideoWithCard[]; packAdded?: string }) {
  return (
    <Card className="p-4">
      <h2 className="font-extrabold">Add a channel</h2>
      <p className="text-sm text-muted">Search YouTube and approve from the results. Sift pulls the channel&apos;s best videos and reviews them.</p>
      <SearchAdd approvedChannels={[...approvedChannels]} approvedVideos={lib.filter((v) => v.whitelisted).map((v) => v.id)} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-bold text-muted">Paste a link instead</summary>
        <AddForm />
      </details>
      <details className="mt-2 text-sm" open={approvedChannels.size === 0}>
        <summary className="cursor-pointer font-bold text-muted">Starter packs</summary>
        <div className="mt-2 space-y-2">
          {PACKS.map((p) => (
            <form key={p.id} action={approvePack} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <input type="hidden" name="pack" value={p.id} />
              <input type="hidden" name="next" value="/parent" />
              <span className="text-2xl">{p.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">{p.title} <span className="text-muted font-bold text-xs">ages {p.ages}</span></span>
                <span className="block text-xs text-muted">{p.blurb}</span>
              </span>
              <Button type="submit" variant={packAdded === p.id ? "ghost" : "primary"} className="text-xs px-3 py-1.5">{packAdded === p.id ? "Added" : "Add"}</Button>
            </form>
          ))}
        </div>
      </details>
    </Card>
  );
}
