import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { CONCERN_LABELS, CONCERN_TAGS, FORMATS, FORMAT_LABELS, type ConcernTag } from "@/lib/types";
import { MODE_ORDER, MODE_UI, whenSentence } from "@/lib/modes";
import { ModePicker } from "./mode-picker";
import { SectionNav } from "./section-nav";
import { loadChildFacts } from "@/lib/kid-facts";
import { localDay } from "@/lib/checkin";
import { pinIsSet } from "@/lib/pin";
import { Button, buttonClass, Card, EmptyState, Notice } from "@/components/ui";
import { IconChevron, IconClock, IconKids, IconPlayCircle, IconShield, IconTv } from "@/components/icons";
import { assignDeviceAction, grantMoreTime, saveSettings } from "@/app/actions";
import { ChildSummary } from "@/app/parent/kids/child-summary";
import { KidForm } from "@/app/parent/kids/kid-form";

export const dynamic = "force-dynamic";

// Concern groups, so twelve checkboxes read as three decisions.
const CONCERN_GROUPS: { title: string; tags: ConcernTag[] }[] = [
  { title: "Scary or upsetting", tags: ["violence", "scary_imagery", "monsters", "sad_themes"] },
  { title: "Behaviour and language", tags: ["yelling_or_meanness", "unsafe_behavior", "inappropriate_language", "romance", "potty_humor"] },
  { title: "Overstimulating or commercial", tags: ["loud_or_jarring", "fast_paced", "ads_or_toys"] },
];

// Any tag added to the taxonomy later still gets a checkbox.
const UNGROUPED = CONCERN_TAGS.filter((t) => !CONCERN_GROUPS.some((g) => g.tags.includes(t)));
if (UNGROUPED.length) CONCERN_GROUPS.push({ title: "Other", tags: UNGROUPED });

const SECTIONS = [
  { id: "viewing", label: "Viewing mode" },
  { id: "content", label: "Content" },
  { id: "time", label: "Screen time" },
  { id: "screens", label: "Screens" },
  { id: "home", label: "Home screen" },
  { id: "profile", label: "Profile" },
] as const;

/**
 * One child's page (route kept: /parent/settings?kid=). Starts with the answers — what they can watch,
 * when, how they ask, where — then one section per decision, each saved on its own. Advanced options
 * (search filter, AI checks per day, skip limits, home-screen tuning) are folded away.
 */
export default async function ChildSettingsPage(props: PageProps<"/parent/settings">) {
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/settings" : "/unlock?next=/parent/settings");
  const fid = viewer.familyId;
  const { facts, devices, timezone } = await loadChildFacts(fid);
  const kidId = (facts.some((f) => f.profile.id === str("kid")) ? str("kid") : undefined) ?? viewer.profileId ?? facts[0]?.profile.id;
  const f = facts.find((x) => x.profile.id === kidId);
  if (!f) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-10"><Card><EmptyState icon={<IconKids />} title="Add a child first" action={<Link href="/parent/kids#add" className={buttonClass("primary")}>Add a child</Link>} /></Card></main>;
  }
  const { profile: kid, settings: s } = f;
  const here = `/parent/settings?kid=${kid.id}`;
  const saved = str("saved");
  const error = str("error");
  const failed = str("failed");
  const bonusToday = s.bonusDay === localDay(timezone) ? s.bonusMinutes ?? 0 : 0;
  const multi = facts.length > 1;
  const pinSet = pinIsSet(s.pinHash);
  const childDevices = devices?.filter((d) => d.assigned_profile_id === kid.id) ?? [];
  const sharedDevices = devices?.filter((d) => !d.assigned_profile_id) ?? [];
  // A save comes back to its own section, so its outcome is shown there (not only at the top of the page).
  const savedNote = (section: string, text = "Saved.") =>
    error && failed === section ? <Notice tone="bad" className="mt-3"><b>Not saved:</b> {error}</Notice>
    : saved === section ? <Notice tone="ok" className="mt-3">{text}</Notice> : null;
  const changedScreen = saved === "screens" ? devices?.find((d) => d.id === str("screen")) : undefined;

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-8">
      <Link href="/parent/kids" className="inline-flex items-center gap-1 text-sm font-bold text-muted hover:text-forest"><IconChevron size={16} className="rotate-180" />Kids</Link>

      <header className="mt-2 flex flex-wrap items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-4xl ring-1 ring-sand" aria-hidden>{kid.avatar}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title sm:text-display">{kid.name}</h1>
          <p className="text-sm text-muted sm:text-base">{kid.age ? `${kid.age} years old` : "Age not set"}, {MODE_UI[s.mode].title} mode</p>
        </div>
        {multi && (
          <nav aria-label="Switch child" className="flex basis-full flex-wrap gap-1.5 sm:basis-auto">
            {facts.map((x) => (
              <Link key={x.profile.id} href={`/parent/settings?kid=${x.profile.id}`} aria-current={x.profile.id === kid.id ? "true" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${x.profile.id === kid.id ? "border-forest bg-forest text-ivory" : "border-sand bg-surface text-ink hover:border-forest/40"}`}>
                <span aria-hidden>{x.profile.avatar}</span>{x.profile.name}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <p className="mt-3 text-xs text-muted sm:text-sm">Settings here are {kid.name}&apos;s own. <span className="hidden sm:inline">The family PIN and parent-report threshold apply to everyone and are on </span><Link href="/parent/kids#family" className="font-bold text-forest underline"><span className="sm:hidden">Family settings</span><span className="hidden sm:inline">Kids</span></Link>.</p>
      {error && !failed && <Notice tone="bad" className="mt-4"><b>Couldn&apos;t save:</b> {error}</Notice>}

      <section aria-label={`${kid.name} at a glance`} className="mt-4 sm:mt-5">
        {/* Phone: one line per answer, each a jump to its section. Wider: the full four answers. */}
        <ul className="divide-y divide-sand overflow-hidden rounded-[var(--radius-card)] border border-sand bg-surface text-sm sm:hidden">
          {[
            { href: "#viewing", q: "Watch", a: `${MODE_UI[s.mode].title}, ${f.ready} ready` },
            { href: "#time", q: "When", a: whenSentence(s) },
            { href: "#viewing", q: "Asking", a: f.pending ? `${f.pending} waiting in Review` : s.mode === "locked" ? "Can't ask (Locked)" : "Nothing waiting" },
            { href: "#screens", q: "Where", a: f.screens === undefined ? "This browser" : f.screens.length ? f.screens.map((x) => x.name).join(", ") : "No screens yet" },
          ].map((r) => (
            <li key={r.q}>
              <a href={r.href} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-14 shrink-0 font-bold text-muted">{r.q}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-forest">{r.a}</span>
                <IconChevron size={16} className="text-muted" />
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block"><ChildSummary f={f} link={(sec) => `#${sec}`} /></div>
      </section>

      {/* section index: sticky pills on wide screens, a scrollable row on phones */}
      <SectionNav sections={SECTIONS.map((x) => ({ ...x }))} />

      <div className="mt-4 space-y-6">
        {/* ---- viewing mode ---- */}
        <Section id="viewing" icon={<IconPlayCircle />} title="Viewing mode" sub={`How ${kid.name} finds videos, and what happens when ${kid.name} wants something new.`}>
          <form action={saveSettings} className="space-y-4">
            <Hidden kid={kid.id} section="access" next={`${here}#viewing`} />
            <ModePicker current={s.mode} modes={MODE_ORDER.map((m) => ({ mode: m, title: MODE_UI[m].title, tagline: MODE_UI[m].tagline, watch: MODE_UI[m].watch(kid.name), ask: MODE_UI[m].ask(kid.name) }))} />
            <p className="text-sm text-muted">In every mode, a video plays only after its AI review passes {kid.name}&apos;s content settings, or when you allow that video for {kid.name}.</p>
            <details className="rounded-xl border border-sand bg-surface text-sm">
              <summary className="cursor-pointer px-4 py-3 font-bold text-forest">Search options (Ask first and Open)</summary>
              <div className="space-y-3 border-t border-sand px-4 py-3">
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="kidsOnlySearch" defaultChecked={s.kidsOnlySearch} className="mt-1 accent-[var(--forest)]" />
                  <span>Only show YouTube&apos;s &ldquo;made for kids&rdquo; videos in search <span className="block text-muted">Narrower results. Every video still needs its AI review either way.</span></span>
                </label>
                <label className="flex flex-wrap items-center justify-between gap-2">
                  <span>AI checks {kid.name} can start per day <span className="block text-muted">Each search find {kid.name} opens is checked by the AI review.</span></span>
                  <input type="number" name="dailyCheckLimit" min={1} max={200} defaultValue={s.dailyCheckLimit} className="w-20 rounded-xl border border-sand bg-surface px-3 py-2 outline-none focus:border-forest" />
                </label>
              </div>
            </details>
            <Button type="submit">Save viewing mode</Button>
          </form>
          {savedNote("access", "Viewing mode saved.")}
        </Section>

        {/* ---- content ---- */}
        <Section id="content" icon={<IconShield />} title="Content" sub={`What the AI review must not find for a video to play for ${kid.name}.`}>
          <form action={saveSettings} className="space-y-5">
            <Hidden kid={kid.id} section="content" next={`${here}#content`} />
            <p className="rounded-xl bg-sand-soft px-4 py-3 text-sm">
              <b className="text-forest">Age {s.kidAge ?? "not set"}.</b>{" "}
              {s.kidAge ? `Videos the AI review rates for children older than ${s.kidAge} are held back.` : "Until an age is set, every video is held back."}{" "}
              <a href="#profile" className="font-bold text-forest underline">Change age</a>
            </p>
            <fieldset className="space-y-3">
              <legend className="font-bold text-forest">Hold back videos with…</legend>
              <p className="text-sm text-muted">…a moderate or strong finding in the AI review, or enough reports from other parents (a family-wide setting on Kids).</p>
              <div className="grid gap-4 md:grid-cols-3">
                {CONCERN_GROUPS.map((g) => (
                  <div key={g.title} className="rounded-[var(--radius-card)] border border-sand bg-surface p-3">
                    <p className="mb-1.5 text-sm font-bold text-ink">{g.title}</p>
                    <ul className="space-y-1">
                      {g.tags.map((t) => (
                        <li key={t}><Check name={`block:${t}`} label={CONCERN_LABELS[t]} on={s.blockedTags.includes(t)} /></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-bold text-forest">Hold back these kinds of videos</legend>
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {FORMATS.filter((x) => x !== "other").map((x) => <Check key={x} name={`blockfmt:${x}`} label={FORMAT_LABELS[x]} on={s.blockedFormats.includes(x)} />)}
              </div>
            </fieldset>
            <p className="text-sm text-muted">To make an exception for one video, use &ldquo;Allow for {kid.name}&rdquo; on that video. Videos without an AI review never play unless you allow them.</p>
            <Button type="submit">Save content settings</Button>
          </form>
          {savedNote("content", "Content settings saved.")}
        </Section>

        {/* ---- screen time ---- */}
        <Section id="time" icon={<IconClock />} title="Screen time" sub="Limits use your family's time zone.">
          <form action={saveSettings} className="space-y-4">
            <Hidden kid={kid.id} section="time" next={`${here}#time`} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="font-bold text-forest">Minutes per day</span>
                <span className="block text-muted">Leave empty for no limit.</span>
                <input type="number" name="dailyMinutes" min={5} max={600} step={5} defaultValue={s.dailyMinutes ?? ""} className="w-32 rounded-xl border border-sand bg-surface px-3 py-2.5 outline-none focus:border-forest" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-bold text-forest">Done for the day at</span>
                <span className="block text-muted">The kid screen stops until 4 am. Leave empty for none.</span>
                <input type="time" name="bedtime" defaultValue={s.bedtime ?? ""} className="rounded-xl border border-sand bg-surface px-3 py-2.5 outline-none focus:border-forest" />
              </label>
            </div>
            <Button type="submit">Save screen time</Button>
          </form>
          {savedNote("time", "Screen time saved.")}
          {s.dailyMinutes ? (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-sand pt-4 text-sm">
              <span className="font-bold text-forest">Today: {f.usedToday} of {s.dailyMinutes + bonusToday} min{bonusToday ? ` (includes +${bonusToday} extra)` : ""}.</span>
              <span className="text-muted">Give {kid.name} extra today:</span>
              {[15, 30].map((m) => (
                <form key={m} action={grantMoreTime}><input type="hidden" name="profileId" value={kid.id} /><input type="hidden" name="minutes" value={m} /><input type="hidden" name="next" value={`${here}#time`} /><Button type="submit" variant="secondary" size="sm">+{m} min</Button></form>
              ))}
              {bonusToday > 0 && <form action={grantMoreTime}><input type="hidden" name="profileId" value={kid.id} /><input type="hidden" name="minutes" value={-1000} /><input type="hidden" name="next" value={`${here}#time`} /><Button type="submit" variant="quiet" size="sm">Remove extra time</Button></form>}
            </div>
          ) : null}
          <details className="mt-5 rounded-xl border border-sand bg-surface text-sm">
            <summary className="cursor-pointer px-4 py-3 font-bold text-forest">Limit skipping {s.skipLimit ? `(on: ${s.skipLimit} per sitting)` : "(off)"}</summary>
            <form action={saveSettings} className="space-y-3 border-t border-sand px-4 py-3">
              <Hidden kid={kid.id} section="skips" next={`${here}#time`} />
              <p className="text-muted">A few skips per sitting, earned back by finishing videos. When they run out, the current video keeps playing and Next becomes a short countdown. Leaving in the first seconds is always free.</p>
              <Check name="skipsOn" label={`Limit skipping for ${kid.name}`} on={!!s.skipLimit} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Num name="skipLimit" label="Skips per sitting" min={1} max={20} value={s.skipLimit ?? 3} />
                <Num name="skipRegen" label="Skips earned per finished video" min={0} max={5} value={s.skipRegen ?? 1} />
                <Num name="skipCooldownMin" label="Countdown when out of skips (minutes)" min={1} max={15} value={Math.round((s.skipCooldownSec ?? 120) / 60)} />
                <Num name="freePeekSec" label="Free first seconds" min={0} max={120} step={5} value={s.freePeekSec ?? 30} />
              </div>
              <Button type="submit" size="sm">Save skip limits</Button>
            </form>
          </details>
          {savedNote("skips", "Skip limits saved.")}
        </Section>

        {/* ---- screens ---- */}
        <Section id="screens" icon={<IconTv />} title="Screens" sub={`Where ${kid.name} watches.`}>
          {error && failed === "screens" && <Notice tone="bad" className="mb-3"><b>Not changed:</b> {error}</Notice>}
          {saved === "screens" && (
            <Notice tone="ok" className="mb-3">
              {changedScreen ? <><b>{changedScreen.name}</b> is now {changedScreen.assigned_profile_id === kid.id ? `${kid.name}'s own` : changedScreen.assigned_profile_id ? "another child's own" : "shared"}.</> : "Screen updated."}
            </Notice>
          )}
          {devices === null ? (
            <p className="text-sm text-muted">Connecting TVs and tablets needs a family account. In this local mode, this browser is the kid screen.</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted">No screens connected yet. <Link href="/parent/devices" className="font-bold text-forest underline">Connect a TV or tablet</Link></p>
          ) : (
            <div className="space-y-4 text-sm">
              {multi && <p className="text-muted">A screen can be <b className="text-ink">{kid.name}&apos;s own</b> (always opens as {kid.name}) or <b className="text-ink">shared</b> (anyone picks themselves with the family PIN).{!pinSet && <> <Link href="/parent/kids#family" className="font-bold text-bad underline">Set a family PIN</Link> so shared screens can switch.</>}</p>}
              <ul className="divide-y divide-sand rounded-[var(--radius-card)] border border-sand bg-surface">
                {[...childDevices, ...sharedDevices].map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1"><b className="text-forest">{d.name}</b> <span className="text-muted">{d.assigned_profile_id ? `${kid.name}'s own` : "Shared"}</span></span>
                    {multi && (
                      <form action={assignDeviceAction} className="flex items-center gap-2">
                        <input type="hidden" name="deviceId" value={d.id} /><input type="hidden" name="next" value={`${here}#screens`} />
                        <input type="hidden" name="profileId" value={d.assigned_profile_id ? "" : kid.id} />
                        <Button type="submit" variant="secondary" size="sm">{d.assigned_profile_id ? "Make shared" : `Make it ${kid.name}'s own`}</Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              <p><Link href="/parent/devices" className="font-bold text-forest underline">All screens, pairing and disconnecting</Link> <span className="text-muted">(family-wide)</span></p>
            </div>
          )}
        </Section>

        {/* ---- home screen ---- */}
        <Section id="home" icon={<IconPlayCircle />} title="Home screen" sub={`Which allowed videos ${kid.name} sees first. This never changes what's allowed.`}>
          <details className="rounded-xl border border-sand bg-surface text-sm">
            <summary className="cursor-pointer px-4 py-3 font-bold text-forest">Fine-tune the &ldquo;For {kid.name}&rdquo; row</summary>
            <form action={saveSettings} className="space-y-3 border-t border-sand px-4 py-3">
              <Hidden kid={kid.id} section="arrange" next={`${here}#home`} />
              <p className="text-muted">The row learns from what {kid.name} finishes. These nudge it.{kid.interests.length ? ` Also boosting ${kid.name}'s interests: ${kid.interests.join(", ")}.` : ""}</p>
              <div className="space-y-2">
                {FORMATS.filter((x) => x !== "other").map((x) => <Slider key={x} name={`boost:${x}`} label={FORMAT_LABELS[x]} value={s.boosts?.formats?.[x] ?? 0} />)}
                <Slider name="boost:pace" label="Calmer or livelier" value={s.boosts?.pace ?? 0} />
                <Slider name="boost:learning" label="Fun or learning" value={s.boosts?.learning ?? 0} />
              </div>
              <Button type="submit" size="sm">Save home screen</Button>
            </form>
          </details>
          <p className="mt-3 text-sm text-muted">Channel order is on <Link href={`/parent?kid=${kid.id}#channels`} className="font-bold text-forest underline">Home</Link>.</p>
          {savedNote("arrange", "Home screen saved.")}
        </Section>

        {/* ---- profile ---- */}
        <Section id="profile" icon={<IconKids />} title="Profile" sub="Name, age and picture.">
          <KidForm key={kid.id} profile={kid} canDelete={facts.length > 1} />
          <p className="mt-4 text-sm"><Link href={`/parent/stats?kid=${kid.id}`} className="font-bold text-forest underline">Viewing history and stats</Link></p>
        </Section>
      </div>
    </main>
  );
}

function Section({ id, icon, title, sub, children }: { id: string; icon: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <div id={`sec-${id}`}>
      <Card as="section" className="p-5 sm:p-6">
        <div id={id} className="relative -top-32" aria-hidden />
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest">{icon}</span>
          <div>
            <h2 className="text-lg leading-tight">{title}</h2>
            {sub && <p className="text-sm text-muted">{sub}</p>}
          </div>
        </div>
        {children}
      </Card>
    </div>
  );
}

function Hidden({ kid, section, next }: { kid: string; section: string; next: string }) {
  return <><input type="hidden" name="profileId" value={kid} /><input type="hidden" name="section" value={section} /><input type="hidden" name="next" value={next} /></>;
}

function Check({ name, label, on }: { name: string; label: string; on: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} className="h-4 w-4 accent-[var(--forest)]" />
      {label}
    </label>
  );
}

function Num({ name, label, min, max, step = 1, value }: { name: string; label: string; min: number; max: number; step?: number; value: number }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <input type="number" name={name} min={min} max={max} step={step} defaultValue={value} className="w-20 rounded-xl border border-sand bg-surface px-3 py-2 outline-none focus:border-forest" />
    </label>
  );
}

function Slider({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label className="grid grid-cols-[1fr_9rem] items-center gap-3">
      <span>{label}</span>
      <input type="range" name={name} min={-2} max={2} step={1} defaultValue={value} className="accent-[var(--forest)]" aria-label={`${label}: less to more`} />
    </label>
  );
}
