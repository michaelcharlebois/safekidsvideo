import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { CONCERN_LABELS, CONCERN_TAGS, FORMATS, FORMAT_LABELS, MODE_LABELS, type FamilyMode } from "@/lib/types";
import { Button, Card, TopBar } from "@/components/ui";
import { grantMoreTime, saveSettings } from "@/app/actions";
import { minutesUsedToday } from "@/lib/screentime";
import { localDay } from "@/lib/checkin";
import { pinIsSet } from "@/lib/pin";

export const dynamic = "force-dynamic";

/** Per-kid settings: what they can reach, filters, screen time; plus the family PIN. */
export default async function SettingsPage(props: PageProps<"/parent/settings">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = sp.saved === "1";
  const viewer = await resolveViewer();
  if (viewer.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/settings" : "/unlock?next=/parent/settings");
  const fid = viewer.familyId;
  const [family, profiles] = await Promise.all([db.getFamily(fid), db.listProfiles(fid)]);
  const kidParam = typeof sp.kid === "string" && profiles.some((p) => p.id === sp.kid) ? sp.kid : undefined;
  const kidId = kidParam ?? viewer.profileId ?? profiles[0]?.id;
  const settings = await db.getSettings(fid, kidId);
  const kid = profiles.find((p) => p.id === kidId);
  const usedToday = kid ? await minutesUsedToday(fid, kid.id, family.timezone) : 0;
  const bonusToday = kid && settings.bonusDay === localDay(family.timezone) ? settings.bonusMinutes ?? 0 : 0;

  return (
    <>
      <TopBar title="Settings" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Dashboard</Link>} />
      <main className="mx-auto w-full max-w-xl px-4 py-6 space-y-4">
        {error && <Card className="p-3 border-bad/40 bg-bad/5 text-sm"><b className="text-bad">Couldn&apos;t save:</b> {error}</Card>}
        {saved && <Card className="p-3 border-ok/40 bg-ok/5 text-sm font-bold text-ok">Settings saved.</Card>}
          <Card className="p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {profiles.map((p) => (
              <Link key={p.id} href={`/parent/settings?kid=${p.id}`} className={`rounded-full px-3 py-1 text-sm font-bold border ${p.id === kidId ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface"}`}>
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
            <p className="text-xs text-muted pt-1">Videos never play until they&apos;ve been reviewed — unless you use &ldquo;Allow for {kid?.name ?? "this child"}&rdquo; on a specific video.</p>
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
            <h2 className="font-extrabold pt-2">What shows up first</h2>
            <p className="text-xs text-muted">The &ldquo;For {kid?.name ?? "them"}&rdquo; row learns from what {kid?.name ?? "they"} finishes. These nudge it. Filters above still hide things outright.</p>
            <div className="space-y-1.5 text-sm">
              {FORMATS.filter((f) => f !== "other").map((f) => (
                <Slider key={f} name={`boost:${f}`} label={FORMAT_LABELS[f]} value={settings.boosts?.formats?.[f] ?? 0} />
              ))}
              <Slider name="boost:pace" label="Calmer ↔ livelier" value={settings.boosts?.pace ?? 0} />
              <Slider name="boost:learning" label="Fun ↔ learning" value={settings.boosts?.learning ?? 0} />
            </div>
            {kid?.interests.length ? <p className="text-xs text-muted">Also boosting {kid.name}&apos;s interests: {kid.interests.join(", ")} — edit under <Link href="/parent/kids" className="underline">Kids</Link>.</p> : null}
            <h2 className="font-extrabold pt-2">Skipping</h2>
            <p className="text-xs text-muted">Like Pandora: a few skips per sitting, earned back by finishing videos. When they&apos;re out, the current video keeps playing and Next becomes a short countdown. Leaving in the first half-minute is always free.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="skipsOn" defaultChecked={!!settings.skipLimit} className="accent-accent" />
              Limit skipping for {kid?.name ?? "this kid"}
            </label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center justify-between gap-2">Skips per sitting<input type="number" name="skipLimit" min={1} max={20} defaultValue={settings.skipLimit ?? 3} className="w-16 rounded-lg border border-line px-2 py-1" /></label>
              <label className="flex items-center justify-between gap-2">Earned per finish<input type="number" name="skipRegen" min={0} max={5} defaultValue={settings.skipRegen ?? 1} className="w-16 rounded-lg border border-line px-2 py-1" /></label>
              <label className="flex items-center justify-between gap-2">Wait (minutes)<input type="number" name="skipCooldownMin" min={1} max={15} defaultValue={Math.round((settings.skipCooldownSec ?? 120) / 60)} className="w-16 rounded-lg border border-line px-2 py-1" /></label>
              <label className="flex items-center justify-between gap-2">Free peek (seconds)<input type="number" name="freePeekSec" min={0} max={120} step={5} defaultValue={settings.freePeekSec ?? 30} className="w-16 rounded-lg border border-line px-2 py-1" /></label>
            </div>
            <h2 className="font-extrabold pt-2">Family PIN</h2>
            <p className="text-xs text-muted">Used to pick or switch kids on a shared screen{pinIsSet(settings.pinHash) ? "." : " — shared screens stay locked until you set one."} Any 4 digits except 1234.</p>
            <label className="flex items-center justify-between text-sm gap-2">
              {pinIsSet(settings.pinHash) ? "Change PIN" : "Set a PIN"}
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

      </main>
    </>
  );
}

function Slider({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-3">
      <span>{label}</span>
      <input type="range" name={name} min={-2} max={2} step={1} defaultValue={value} className="accent-ink" aria-label={`${label}: less to more`} />
    </label>
  );
}
