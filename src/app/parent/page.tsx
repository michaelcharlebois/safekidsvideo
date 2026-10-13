import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db, STORE_KIND } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { MODE_LABELS, type VideoWithCard } from "@/lib/types";
import { Button, Card, Pill, TopBar } from "@/components/ui";
import { approvePack, grantMoreTime, lock, reviewNextBatch, sendTestPush, signOut, toggleWhitelist } from "@/app/actions";
import { listPendingRequests } from "@/lib/activity";
import { countSubscriptions, pushEnabled } from "@/lib/push";
import { NotifyButton } from "./notify-button";
import { AddForm } from "./add-form";
import { SearchAdd } from "./search-add";
import { PACKS } from "@/lib/packs";
import { billingStatus } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background batch reviews run within this budget

type View = "visible" | "hidden" | "unreviewed" | "all";

/**
 * The parent home. Three jobs, in order: what needs you, what's in the library (by channel), and adding more.
 * Settings live on their own page; the review queue is where decisions get made.
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
  const [lib, settings, channels, requests, subs, wl] = await Promise.all([
    getLibrary(fid), db.getSettings(fid, kidId), db.listChannels(), listPendingRequests(fid), countSubscriptions(fid), db.listWhitelist(fid),
  ]);
  const approvedChannels = new Set(wl.filter((w) => w.kind === "channel").map((w) => w.targetId));
  const moreAsk = typeof sp.more === "string" ? profiles.find((p) => p.id === sp.more) : undefined;
  const pushTest = typeof sp.push === "string" ? Number(sp.push) : null;
  const batchStarted = typeof sp.batch === "string" ? Number(sp.batch) : 0;
  const view: View = (["visible", "hidden", "unreviewed", "all"] as View[]).includes(sp.view as View) ? (sp.view as View) : "visible";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  // Classify every approved video for the selected kid.
  const mine = lib.filter((v) => v.whitelisted || v.blockedByParent);
  const reviewed = (v: VideoWithCard) => !!v.card && v.card.reviewer.model !== "sample";
  const status = (v: VideoWithCard): "visible" | "hidden" | "unreviewed" | "blocked" =>
    v.blockedByParent ? "blocked" : !reviewed(v) ? "unreviewed" : blockedReasons(v, settings).length ? "hidden" : "visible";
  const counts = { visible: 0, hidden: 0, unreviewed: 0, blocked: 0 };
  for (const v of mine) counts[status(v)]++;
  const decisions = mine.filter((v) => status(v) === "hidden" && !v.dismissed && !v.overridden).length;
  const backlog = mine.filter((v) => status(v) === "unreviewed" && (v.durationSeconds ?? 0) <= 20 * 60).length;

  // Library, grouped by channel, filtered by view + search.
  const matches = (v: VideoWithCard) => (view === "all" ? status(v) !== "blocked" : status(v) === view) && (!q || v.title.toLowerCase().includes(q));
  const groups = new Map<string, { title: string; videos: VideoWithCard[]; total: Record<string, number> }>();
  for (const v of mine) {
    const g = groups.get(v.channelId) ?? { title: v.channel?.title ?? v.channelId, videos: [], total: { visible: 0, hidden: 0, unreviewed: 0, blocked: 0 } };
    g.total[status(v)]++;
    if (matches(v)) g.videos.push(v);
    groups.set(v.channelId, g);
  }
  const shelves = [...groups.entries()].map(([id, g]) => ({ id, ...g, videos: g.videos.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")) }))
    .filter((g) => g.videos.length > 0 || (!q && view === "all")).sort((a, b) => b.videos.length - a.videos.length);

  return (
    <>
      <TopBar
        title="Parent dashboard"
        right={
          <>
            <Link href="/watch" className="text-sm font-bold text-muted hover:text-ink">Preview kid mode →</Link>
            <Link href="/parent/settings" className="text-sm font-bold text-muted hover:text-ink">Settings</Link>
            {supabaseEnabled ? (
              <>
                <Link href="/parent/checkin" className="text-sm font-bold text-muted hover:text-ink">Check-in</Link>
                <Link href="/parent/kids" className="text-sm font-bold text-muted hover:text-ink">Kids</Link>
                <Link href="/parent/devices" className="text-sm font-bold text-muted hover:text-ink">Devices</Link>
                <Link href="/parent/reviewer" className="text-sm font-bold text-muted hover:text-ink">Reviewer</Link>
                <Link href="/parent/billing" className="text-sm font-bold text-muted hover:text-ink">{billing.state === "trial" ? `Trial · ${billing.daysLeft}d` : "Billing"}</Link>
                <form action={signOut}><Button variant="ghost" type="submit">Sign out</Button></form>
              </>
            ) : (
              <form action={lock}><Button variant="ghost" type="submit">Lock</Button></form>
            )}
          </>
        }
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="space-y-4">
          {/* ---- alerts ---- */}
          {moreAsk && (
            <Card className="p-3 border-sun/60 bg-sun/20 text-sm">
              <b>{moreAsk.avatar} {moreAsk.name} is asking for more time.</b>
              <div className="mt-2 flex flex-wrap gap-2">
                {[15, 30, 60].map((m) => (
                  <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={moreAsk.id} /><input type="hidden" name="minutes" value={m} /><Button type="submit" className="text-xs px-3 py-1.5">+{m} min</Button></form>
                ))}
                <Link href="/parent" className="self-center text-xs font-bold text-muted hover:text-ink">Not today</Link>
              </div>
            </Card>
          )}
          {!billing.ok && (
            <Card className="p-3 border-bad/40 bg-bad/5 text-sm">
              <b className="text-bad">{billing.state === "past_due" ? "There's a payment problem." : "Your free trial has ended."}</b> The kid screen keeps playing what&apos;s already approved; new approvals and searches are paused. <Link href="/parent/billing" className="font-bold underline">Subscribe →</Link>
            </Card>
          )}
          {billing.ok && billing.state === "trial" && (billing.daysLeft ?? 99) <= 7 && (
            <Card className="p-3 border-sun/60 bg-sun/20 text-sm"><b>{billing.daysLeft} day{billing.daysLeft === 1 ? "" : "s"} left in your trial.</b> <Link href="/parent/billing" className="font-bold underline">Keep Sift going →</Link></Card>
          )}

          {/* ---- needs you ---- */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-extrabold mr-auto">Needs you</h2>
              {profiles.length > 1 && profiles.map((p) => (
                <Link key={p.id} href={`/parent?kid=${p.id}&view=${view}`} className={`rounded-full px-2.5 py-1 text-xs font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>{p.avatar} {p.name}</Link>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Tile n={requests.length} label={requests.length === 1 ? "request from the TV" : "requests from the TV"} href="/parent/review" cta="Answer" tone={requests.length ? "sun" : undefined} />
              <Tile n={decisions} label={`hidden for ${kid?.name ?? "kid"}, undecided`} href={`/parent/review?kid=${kidId ?? ""}`} cta="Review" tone={decisions ? "accent" : undefined} />
              <form action={reviewNextBatch} className="contents">
                <input type="hidden" name="n" value={10} />
                <Tile n={backlog} label="waiting for an AI card" cta={backlog ? (batchStarted ? `Reviewing ${batchStarted}…` : "Review next 10") : undefined} submit />
              </form>
            </div>
            <p className="mt-2 text-xs text-muted">
              {kid ? <>{kid.avatar} <b>{kid.name}</b> · {MODE_LABELS[settings.mode].title} · {settings.blockedTags.length} filters{settings.dailyMinutes ? ` · ${settings.dailyMinutes} min/day` : ""}{settings.bedtime ? ` · done at ${settings.bedtime}` : ""} · <Link href={`/parent/settings?kid=${kidId}`} className="underline">change</Link></> : null}
              {" · "}unreviewed videos are handled by the nightly reviewer, not you.
            </p>
          </Card>

          {/* ---- library ---- */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-extrabold mr-auto">Library <span className="text-muted font-bold text-sm">· {counts.visible} visible to {kid?.name ?? "kid"}</span></h2>
              {([["visible", `Visible (${counts.visible})`], ["hidden", `Hidden (${counts.hidden})`], ["unreviewed", `Unreviewed (${counts.unreviewed})`], ["all", "All"]] as [View, string][]).map(([k, label]) => (
                <Link key={k} href={`/parent?kid=${kidId ?? ""}&view=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full px-2.5 py-1 text-xs font-bold border ${view === k ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>{label}</Link>
              ))}
            </div>
            <form className="mt-3 flex gap-2" action="/parent">
              <input type="hidden" name="kid" value={kidId ?? ""} /><input type="hidden" name="view" value={view} />
              <input name="q" defaultValue={q} type="search" placeholder="Find a video in your library…" className="flex-1 rounded-full border border-line bg-bg px-4 py-1.5 text-sm outline-none focus:border-accent" />
            </form>
            {shelves.length === 0 && <p className="mt-4 text-sm text-muted text-center">{q ? `Nothing matching “${q}”.` : view === "visible" ? "Nothing visible yet — approve a channel or review what's hidden." : "Nothing here."}</p>}
            <ul className="mt-3 divide-y divide-line">
              {shelves.map((g) => (
                <li key={g.id} className="py-2">
                  <details open={shelves.length <= 3 || !!q}>
                    <summary className="flex cursor-pointer items-center gap-2 text-sm">
                      <span className="font-extrabold">{g.title}</span>
                      <span className="text-xs text-muted">{g.total.visible} visible · {g.total.hidden} hidden · {g.total.unreviewed} unreviewed</span>
                      <span className="ml-auto text-xs font-bold text-muted">{g.videos.length} shown</span>
                      <Link href={`/parent/channel/${g.id}`} className="text-xs font-bold text-accent hover:underline">report card</Link>
                    </summary>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {g.videos.slice(0, 12).map((v) => {
                        const st = status(v);
                        const why = st === "hidden" ? blockedReasons(v, settings) : [];
                        return (
                          <li key={v.id} className="flex gap-2 rounded-xl bg-surface p-2">
                            <Link href={`/parent/video/${v.id}`} className="shrink-0"><Image src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" width={112} height={63} unoptimized className="w-24 rounded-lg aspect-video object-cover bg-line" /></Link>
                            <div className="min-w-0 flex-1">
                              <Link href={`/parent/video/${v.id}`} className="text-sm font-bold leading-snug hover:underline line-clamp-2">{v.title}</Link>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                                {st === "visible" && <Pill className="bg-ok/10 text-ok">{v.overridden ? "allowed by you" : v.autoApproved ? "AI-checked" : "ok"}</Pill>}
                                {st === "hidden" && <Pill className="bg-bad/10 text-bad">{v.dismissed ? "kept hidden" : why.join(", ")}</Pill>}
                                {st === "unreviewed" && <Pill className="bg-line">unreviewed</Pill>}
                                {v.card && <span className="text-muted">★ {v.card.rating} · {v.card.pace}</span>}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {g.videos.length > 12 && <p className="mt-1 text-xs text-muted">…and {g.videos.length - 12} more — <Link href={`/parent/channel/${g.id}`} className="underline">see all on the channel page</Link>.</p>}
                  </details>
                </li>
              ))}
            </ul>
          </Card>

          {/* ---- add more ---- */}
          <Card className="p-4">
            <h2 className="font-extrabold">Add a channel or video</h2>
            <p className="text-sm text-muted">Search YouTube and approve from the results. Approving a channel pulls its best and newest videos and reviews them in the background.</p>
            <SearchAdd approvedChannels={[...approvedChannels]} approvedVideos={lib.filter((v) => v.whitelisted).map((v) => v.id)} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-bold text-muted">Or paste a link / @handle</summary>
              <AddForm />
            </details>
            <details className="mt-2 text-sm" open={approvedChannels.size === 0}>
              <summary className="cursor-pointer font-bold text-muted">Starter packs</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PACKS.map((p) => (
                  <form key={p.id} action={approvePack} className="rounded-xl border border-line p-3 flex flex-col gap-1.5">
                    <input type="hidden" name="pack" value={p.id} />
                    <input type="hidden" name="next" value="/parent" />
                    <p className="font-extrabold"><span className="mr-1">{p.emoji}</span>{p.title} <span className="text-muted font-bold text-xs">· ages {p.ages}</span></p>
                    <p className="text-xs text-muted flex-1">{p.blurb}</p>
                    <Button type="submit" variant={sp.pack === p.id ? "ghost" : "primary"} className="text-xs px-3 py-1.5 self-start">{sp.pack === p.id ? "✓ Added" : "Add this pack"}</Button>
                  </form>
                ))}
              </div>
            </details>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="font-extrabold">Approved channels <span className="text-muted font-bold text-sm">· {approvedChannels.size}</span></h2>
            <ul className="mt-2 space-y-1.5">
              {channels.filter((c) => approvedChannels.has(c.id)).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/parent/channel/${c.id}`} className="truncate font-semibold hover:underline">{c.title}</Link>
                  <form action={toggleWhitelist}>
                    <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={c.id} /><input type="hidden" name="on" value="0" />
                    <button type="submit" className="text-xs font-bold text-muted hover:text-bad">remove</button>
                  </form>
                </li>
              ))}
              {approvedChannels.size === 0 && <li className="text-sm text-muted">None yet — add a starter pack below.</li>}
            </ul>
            {channels.some((c) => !approvedChannels.has(c.id)) && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer font-bold text-muted">Other channels in the shared library ({channels.filter((c) => !approvedChannels.has(c.id)).length})</summary>
                <ul className="mt-1 space-y-1">
                  {channels.filter((c) => !approvedChannels.has(c.id)).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <Link href={`/parent/channel/${c.id}`} className="truncate hover:underline">{c.title}</Link>
                      <form action={toggleWhitelist}>
                        <input type="hidden" name="kind" value="channel" /><input type="hidden" name="targetId" value={c.id} /><input type="hidden" name="on" value="1" />
                        <Button type="submit" variant="ghost" className="text-[11px] px-2 py-0.5">Allow</Button>
                      </form>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          {supabaseEnabled && (
            <Card className="p-4 space-y-2">
              <h2 className="font-extrabold">Notifications</h2>
              {pushEnabled ? (
                <>
                  <NotifyButton vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} registered={subs} />
                  {subs > 0 && (
                    <form action={sendTestPush}>
                      <Button variant="ghost" type="submit" className="text-xs px-3 py-1">Send a test</Button>
                      {pushTest !== null && <span className="ml-2 text-xs text-muted">{pushTest ? `sent to ${pushTest} phone${pushTest > 1 ? "s" : ""}` : "nothing registered"}</span>}
                    </form>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted">Not configured — add VAPID keys to the environment.</p>
              )}
            </Card>
          )}

          <p className="text-xs text-muted px-1">
            Storage: <Pill className="bg-line">{STORE_KIND}</Pill>{" "}
            {STORE_KIND === "local" ? "— data/db.json. Set Supabase env vars to go multi-family." : viewer.email ? `— signed in as ${viewer.email}` : ""}
          </p>
        </aside>
      </main>
    </>
  );
}

function Tile({ n, label, href, cta, tone, submit }: { n: number; label: string; href?: string; cta?: string; tone?: "sun" | "accent"; submit?: boolean }) {
  const bg = tone === "sun" ? "bg-sun/30 border-sun" : tone === "accent" ? "bg-accent/10 border-accent/40" : "bg-surface border-line";
  const inner = (
    <div className={`flex h-full flex-col rounded-xl border p-3 ${bg}`}>
      <p className="text-3xl font-extrabold leading-none">{n}</p>
      <p className="mt-1 text-xs font-bold text-muted flex-1">{label}</p>
      {cta && <span className="mt-2 inline-block self-start rounded-full bg-ink px-3 py-1 text-xs font-extrabold text-bg">{cta}</span>}
    </div>
  );
  if (submit) return <button type="submit" disabled={!cta} className="text-left disabled:opacity-100">{inner}</button>;
  return href && cta ? <Link href={href}>{inner}</Link> : inner;
}
