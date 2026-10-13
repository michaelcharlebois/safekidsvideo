import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db, STORE_KIND } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { CONCERN_LABELS, CONCERN_TAGS, FORMATS, FORMAT_LABELS, MODE_LABELS, type FamilyMode } from "@/lib/types";
import { Button, Card, CardSummary, Pill, TopBar } from "@/components/ui";
import { approvePack, grantMoreTime, lock, resolveWatchRequest, saveSettings, signOut, toggleWhitelist } from "@/app/actions";
import { listPendingRequests } from "@/lib/activity";
import { countSubscriptions, pushEnabled } from "@/lib/push";
import { NotifyButton } from "./notify-button";
import { reviewNextBatch, sendTestPush } from "@/app/actions";
import { AddForm } from "./add-form";
import { SearchAdd } from "./search-add";
import { PACKS } from "@/lib/packs";
import { billingStatus } from "@/lib/billing";
import { minutesUsedToday } from "@/lib/screentime";
import { localDay } from "@/lib/checkin";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // background batch reviews run within this budget

export default async function ParentPage(props: PageProps<"/parent">) {
  const sp = await props.searchParams;
  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = sp.saved === "1";
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent");
  const fid = viewer.familyId;
  const family = await db.getFamily(fid);
  if (!family.onboardedAt) redirect("/start");
  const billing = billingStatus(family);
  const profiles = await db.listProfiles(fid);
  const kidParam = typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined;
  const kidId = kidParam ?? viewer.profileId ?? profiles[0]?.id;
  const [lib, settings, channels, requests, subs] = await Promise.all([getLibrary(fid), db.getSettings(fid, kidId), db.listChannels(), listPendingRequests(fid), countSubscriptions(fid)]);
  const kid = profiles.find((p) => p.id === kidId);
  const moreAsk = typeof sp.more === "string" ? profiles.find((p) => p.id === sp.more) : undefined;
  const usedToday = kid ? await minutesUsedToday(fid, kid.id, family.timezone) : 0;
  const bonusToday = kid && settings.bonusDay === localDay(family.timezone) ? settings.bonusMinutes ?? 0 : 0;
  const pushTest = typeof sp.push === "string" ? Number(sp.push) : null;
  const batchStarted = sp.batch === "1";
  const approvedChannelIds = new Set((await db.listWhitelist(fid)).filter((w) => w.kind === "channel").map((w) => w.targetId));
  const backlog = lib.filter((v) => approvedChannelIds.has(v.channelId) && (!v.card || v.card.reviewer.model === "sample") && (v.durationSeconds ?? 0) <= 20 * 60).length;
  const byId = new Map(lib.map((v) => [v.id, v]));
  const approvedChannels = new Set((await db.listWhitelist(fid)).filter((w) => w.kind === "channel").map((w) => w.targetId));

  const rows = lib
    .map((v) => ({ v, blocked: blockedReasons(v, settings) }))
    .filter(({ v, blocked }) =>
      filter === "approved" ? v.whitelisted && !blocked.length
      : filter === "hidden" ? v.whitelisted && blocked.length > 0
      : filter === "unreviewed" ? !v.card
      : true,
    );

  const kidVisible = lib.filter((v) => v.whitelisted && !blockedReasons(v, settings).length).length;

  return (
    <>
      <TopBar
        title="Parent dashboard"
        right={
          <>
            <Link href="/watch" className="text-sm font-bold text-muted hover:text-ink">Preview kid mode →</Link>
            {supabaseEnabled ? (
              <>
                <Link href="/parent/billing" className="text-sm font-bold text-muted hover:text-ink">{billing.state === "trial" ? `Trial · ${billing.daysLeft}d` : "Billing"}</Link>
                <Link href="/parent/checkin" className="text-sm font-bold text-muted hover:text-ink">Check-in</Link>
                <Link href="/parent/kids" className="text-sm font-bold text-muted hover:text-ink">Kids</Link>
                <Link href="/parent/devices" className="text-sm font-bold text-muted hover:text-ink">Devices</Link>
                <Link href="/parent/reviewer" className="text-sm font-bold text-muted hover:text-ink">Reviewer</Link>
                <form action={signOut}><Button variant="ghost" type="submit">Sign out</Button></form>
              </>
            ) : (
              <form action={lock}><Button variant="ghost" type="submit">Lock</Button></form>
            )}
          </>
        }
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          {moreAsk && (
            <Card className="p-3 border-sun/60 bg-sun/20 text-sm">
              <b>{moreAsk.avatar} {moreAsk.name} is asking for more time.</b>
              <div className="mt-2 flex flex-wrap gap-2">
                {[15, 30, 60].map((m) => (
                  <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={moreAsk.id} /><input type="hidden" name="minutes" value={m} /><Button type="submit" className="text-xs px-3 py-1.5">+{m} min</Button></form>
                ))}
                <Link href={`/parent?kid=${moreAsk.id}`} className="self-center text-xs font-bold text-muted hover:text-ink">Not today</Link>
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
          {error && <Card className="p-3 border-bad/40 bg-bad/5 text-sm"><b className="text-bad">Couldn&apos;t save:</b> {error}</Card>}
          {saved && <Card className="p-3 border-ok/40 bg-ok/5 text-sm font-bold text-ok">Settings saved.</Card>}
          {requests.length > 0 && (
            <Card className="p-4 border-sun bg-sun/30">
              <h2 className="font-extrabold">🙋 Asked for ({requests.length})</h2>
              <ul className="mt-2 space-y-3">
                {requests.map((r) => {
                  const v = byId.get(r.videoId);
                  if (!v) return null;
                  const why = blockedReasons(v, settings);
                  return (
                    <li key={r.id} className="flex gap-3 rounded-xl bg-surface p-3">
                      <Link href={`/parent/video/${v.id}`} className="shrink-0">
                        <Image src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" width={160} height={90} unoptimized className="rounded-lg w-28 aspect-video object-cover bg-line" />
                      </Link>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Link href={`/parent/video/${v.id}`} className="font-extrabold leading-snug hover:underline line-clamp-2">{v.title}</Link>
                        <p className="text-xs text-muted">{v.channel?.title ?? v.channelId} · asked {new Date(r.createdAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</p>
                        <CardSummary v={v} blocked={why} />
                        {why.length > 0 && <p className="text-xs text-bad font-bold">Hidden because: {why.join(", ")}</p>}
                        <form action={resolveWatchRequest} className="flex gap-2 pt-1">
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="videoId" value={v.id} />
                          <Button type="submit" name="decision" value="approve" className="text-xs px-3 py-1.5">✓ Approve</Button>
                          <Button type="submit" name="decision" value="deny" variant="ghost" className="text-xs px-3 py-1.5">Not now</Button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="font-extrabold">Approve a channel or video</h2>
            <p className="text-sm text-muted">Search YouTube and approve from the results. Approving a channel pulls its recent uploads; videos get a content card once the reviewer runs.</p>
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

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[["all", "All"], ["approved", "Kid can see"], ["hidden", "Approved but hidden"], ["unreviewed", "Unreviewed"]].map(([k, label]) => (
              <Link key={k} href={`/parent?filter=${k}`} className={`rounded-full px-3 py-1 font-bold border ${filter === k ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>
                {label}
              </Link>
            ))}
            <span className="ml-auto text-muted">{kidVisible} visible in kid mode</span>
          </div>

          {rows.length === 0 && <Card className="p-6 text-center text-muted">Nothing here yet.</Card>}

          <ul className="space-y-3">
            {rows.map(({ v, blocked }) => (
              <li key={v.id}>
                <Card className="p-3 flex gap-3">
                  <Link href={`/parent/video/${v.id}`} className="shrink-0">
                    <Image src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" width={160} height={90} unoptimized className="rounded-lg w-32 sm:w-40 aspect-video object-cover bg-line" />
                  </Link>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/parent/video/${v.id}`} className="font-extrabold leading-snug hover:underline line-clamp-2">{v.title}</Link>
                        <p className="text-xs text-muted">{v.channel?.title ?? v.channelId}</p>
                      </div>
                      <form action={toggleWhitelist} className="shrink-0">
                        <input type="hidden" name="kind" value="video" />
                        <input type="hidden" name="targetId" value={v.id} />
                        <input type="hidden" name="on" value={v.whitelisted ? "0" : "1"} />
                        <Button type="submit" variant={v.whitelisted ? "ghost" : "primary"} className="text-xs px-3 py-1.5">
                          {v.overridden ? "✓ Approved (override)" : v.autoApproved ? "✓ AI-checked" : v.whitelisted ? "✓ Approved" : "Approve"}
                        </Button>
                      </form>
                    </div>
                    <CardSummary v={v} blocked={blocked} />
                    {blocked.length > 0 && (
                      <p className="text-xs text-bad font-bold">Hidden because: {blocked.join(", ")}</p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-4">
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
          <Card className="p-4 space-y-2">
            <h2 className="font-extrabold">Pipeline</h2>
            <p className="text-xs text-muted">
              Approved channels are refreshed and pre-reviewed every night.{" "}
              {backlog > 0 ? <b className="text-ink">{backlog} video{backlog === 1 ? "" : "s"} waiting for a card.</b> : "Everything short is reviewed."}
            </p>
            {backlog > 0 && (
              <form action={reviewNextBatch}>
                <Button type="submit" variant="ghost" className="text-xs px-3 py-1">Review next 5 now</Button>
                {batchStarted && <span className="ml-2 text-xs text-ok font-bold">Started — a few minutes.</span>}
              </form>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="font-extrabold">Approved channels</h2>
            <p className="text-xs text-muted mb-2">Every video from these channels is allowed unless a filter hides it.</p>
            <ul className="space-y-2">
              {channels.map((c) => {
                const on = approvedChannels.has(c.id);
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{c.title}</span>
                    <form action={toggleWhitelist}>
                      <input type="hidden" name="kind" value="channel" />
                      <input type="hidden" name="targetId" value={c.id} />
                      <input type="hidden" name="on" value={on ? "0" : "1"} />
                      <Button type="submit" variant={on ? "ghost" : "primary"} className="text-xs px-3 py-1">{on ? "✓ On" : "Allow"}</Button>
                    </form>
                  </li>
                );
              })}
              {channels.length === 0 && <li className="text-sm text-muted">No channels yet.</li>}
            </ul>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {profiles.map((p) => (
                <Link key={p.id} href={`/parent?kid=${p.id}`} className={`rounded-full px-3 py-1 text-sm font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>
                  {p.avatar} {p.name}
                </Link>
              ))}
              <Link href="/parent/kids" className="rounded-full px-3 py-1 text-sm font-bold border border-dashed border-line text-muted hover:bg-surface">+ Add a kid</Link>
            </div>
            <form action={saveSettings} className="mt-3 space-y-3">
              <input type="hidden" name="profileId" value={kidId ?? ""} />
              <h2 className="font-extrabold">What can {kid?.name ?? "the kid"} reach?</h2>
              <div className="space-y-1.5">
                {(Object.keys(MODE_LABELS) as FamilyMode[]).map((m) => (
                  <label key={m} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="mode" value={m} defaultChecked={settings.mode === m} className="mt-1 accent-accent" />
                    <span><b>{MODE_LABELS[m].title}</b> — <span className="text-muted">{MODE_LABELS[m].blurb}</span></span>
                  </label>
                ))}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="kidsOnlySearch" defaultChecked={settings.kidsOnlySearch} className="mt-1 accent-accent" />
                <span>Only show YouTube&apos;s &quot;made for kids&quot; videos in search <span className="text-muted">(narrower — hides MrBeast, cooking channels, etc. The AI check still screens everything either way.)</span></span>
              </label>
              <label className="flex items-center justify-between text-sm gap-2">
                Kid-triggered AI checks per day
                <input type="number" name="dailyCheckLimit" min={0} max={200} defaultValue={settings.dailyCheckLimit} className="w-16 rounded-lg border border-line px-2 py-1" />
              </label>
              <h2 className="font-extrabold pt-2">Filters</h2>
              <p className="text-xs text-muted">Hide any approved video where the AI found one of these at moderate strength or more, or where enough parents flagged it.</p>
              <div className="grid grid-cols-1 gap-1">
                {CONCERN_TAGS.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`block:${t}`} defaultChecked={settings.blockedTags.includes(t)} className="accent-accent" />
                    {CONCERN_LABELS[t]}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm pt-1">
                <input type="checkbox" name="hideUnreviewed" defaultChecked={settings.hideUnreviewed} className="accent-accent" />
                Hide videos until they have a content card
              </label>
              <p className="text-xs text-muted pt-1">Hide these kinds of videos entirely:</p>
              <div className="grid grid-cols-1 gap-1">
                {FORMATS.filter((f) => f !== "other").map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`blockfmt:${f}`} defaultChecked={settings.blockedFormats.includes(f)} className="accent-accent" />
                    {FORMAT_LABELS[f]}
                  </label>
                ))}
              </div>
              <label className="flex items-center justify-between text-sm gap-2">
                Parent flags to hide
                <input type="number" name="flagThreshold" min={1} max={50} defaultValue={settings.flagThreshold} className="w-16 rounded-lg border border-line px-2 py-1" />
              </label>
              <label className="flex items-center justify-between text-sm gap-2">
                {kid?.name ?? "Kid"}&apos;s age
                <input type="number" name="kidAge" min={1} max={17} defaultValue={settings.kidAge} className="w-16 rounded-lg border border-line px-2 py-1" />
              </label>
              <h2 className="font-extrabold pt-2">Screen time</h2>
              <p className="text-xs text-muted">Today: ~{usedToday} min{settings.dailyMinutes ? ` of ${settings.dailyMinutes + bonusToday}` : ""}{bonusToday ? ` (incl. +${bonusToday} bonus)` : ""}.</p>
              <label className="flex items-center justify-between text-sm gap-2">
                Minutes per day <span className="text-muted text-xs ml-auto mr-2">blank = no limit</span>
                <input type="number" name="dailyMinutes" min={5} max={600} step={5} defaultValue={settings.dailyMinutes ?? ""} className="w-20 rounded-lg border border-line px-2 py-1" />
              </label>
              <label className="flex items-center justify-between text-sm gap-2">
                Done for the day at <span className="text-muted text-xs ml-auto mr-2">TV&apos;s local time</span>
                <input type="time" name="bedtime" defaultValue={settings.bedtime ?? ""} className="rounded-lg border border-line px-2 py-1" />
              </label>
              <label className="flex items-center justify-between text-sm gap-2">
                New PIN
                <input type="password" name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="••••" className="w-20 rounded-lg border border-line px-2 py-1" />
              </label>
              <Button type="submit" className="w-full">Save</Button>
              {saved && <p className="text-center text-sm font-bold text-ok">✓ Settings saved</p>}
              {error && <p className="text-sm font-bold text-bad">Couldn&apos;t save: {error}</p>}
            </form>
            {kid && settings.dailyMinutes ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                <span className="font-bold text-muted">Give {kid.name} extra today:</span>
                {[15, 30].map((m) => (
                  <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={kid.id} /><input type="hidden" name="minutes" value={m} /><Button type="submit" variant="ghost" className="text-xs px-3 py-1">+{m} min</Button></form>
                ))}
                {bonusToday > 0 && <form action={grantMoreTime}><input type="hidden" name="profileId" value={kid.id} /><input type="hidden" name="minutes" value={-1000} /><button type="submit" className="font-bold text-muted hover:text-ink">clear bonus</button></form>}
              </div>
            ) : null}
          </Card>

          <p className="text-xs text-muted px-1">
            Storage: <Pill className="bg-line">{STORE_KIND}</Pill>{" "}
            {STORE_KIND === "local" ? "— data/db.json. Set Supabase env vars to go multi-family." : viewer.email ? `— signed in as ${viewer.email}` : ""}
          </p>
        </aside>
      </main>
    </>
  );
}
