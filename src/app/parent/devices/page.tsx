import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveCodes, listDevices, resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { Button, Card, Notice, PAGE, PageHeader, SectionHeader } from "@/components/ui";
import { IconTv } from "@/components/icons";
import { assignDeviceAction, newPairingCode, unpairDevice } from "@/app/actions";
import { db } from "@/lib/db";
import { pinIsSet } from "@/lib/pin";

export const dynamic = "force-dynamic";

/** Screens: pair a TV or tablet, make it one child's own or shared, disconnect it. Needs a family account. */
export default async function DevicesPage(props: PageProps<"/parent/devices">) {
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/devices" : "/unlock?next=/parent/devices");
  if (!supabaseEnabled) {
    return (
      <main className={PAGE}>
        <PageHeader title="Screens" sub="TVs and tablets your children watch on." back={{ href: "/parent/account", label: "Account" }} />
        <Card className="mt-6 p-5 text-sm text-muted">Connecting TVs and tablets needs a family account. In this local mode, this browser is the kid screen: <Link href="/watch" className="font-bold text-forest underline">open it</Link>.</Card>
      </main>
    );
  }
  const [codes, devices, profiles, fam] = await Promise.all([listActiveCodes(v.familyId), listDevices(v.familyId), db.listProfiles(v.familyId), db.getSettings(v.familyId)]);
  const active = devices.filter((d) => !d.revoked_at);
  const sp = await props.searchParams;
  const multi = profiles.length > 1;
  const pinReady = pinIsSet(fam.pinHash);

  return (
    <main className={PAGE}>
      <PageHeader title="Screens" sub="TVs and tablets your children watch on." back={{ href: "/parent/account", label: "Account" }} />
      <div className="mt-4 space-y-3">
        {sp.saved && <Notice tone="ok">Saved.</Notice>}
        {typeof sp.error === "string" && <Notice tone="bad">{sp.error}</Notice>}
        {multi && !pinReady && <Notice tone="warn"><b>Shared screens are locked</b> until you set a family PIN. <Link href="/parent/kids#family" className="font-bold text-forest underline">Set it on Kids</Link></Notice>}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card as="section" className="overflow-hidden">
          <div className="border-b border-sand px-5 py-4">
            <SectionHeader icon={<IconTv />} title="Connected screens" sub={multi ? "A child's own screen always opens as that child. A shared screen (like the living-room TV) asks for the family PIN to choose or switch children." : undefined} />
          </div>
          {active.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No screens connected yet. Make a code to pair one.</p> : (
            <ul className="divide-y divide-sand">
              {active.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-forest">{d.name}</p>
                    <p className="text-xs text-muted">
                      {d.last_seen_at ? `Last used ${new Date(d.last_seen_at).toLocaleDateString()}` : "Not used yet"}
                      {!d.assigned_profile_id && multi && d.active_profile_id ? ` · watching as ${profiles.find((p) => p.id === d.active_profile_id)?.name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {multi && (
                      <form action={assignDeviceAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="deviceId" value={d.id} />
                        <label className="sr-only" htmlFor={`who-${d.id}`}>Who uses {d.name}</label>
                        <select id={`who-${d.id}`} name="profileId" defaultValue={d.assigned_profile_id ?? ""} className="h-9 rounded-full border border-sand bg-surface px-3 text-sm font-semibold">
                          <option value="">Shared (PIN to switch)</option>
                          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s own</option>)}
                        </select>
                        <Button type="submit" variant="secondary" size="sm">Save</Button>
                      </form>
                    )}
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-full px-3 py-2 text-sm font-bold text-muted hover:bg-sand-soft hover:text-bad">Disconnect</summary>
                      <div className="absolute right-0 z-10 mt-1 w-60 space-y-2 rounded-[var(--radius-card)] border border-sand bg-surface p-3 shadow-[var(--shadow-raised)]">
                        <p>Disconnect <b>{d.name}</b>? It stops working until it&apos;s paired again.</p>
                        <form action={unpairDevice}><input type="hidden" name="deviceId" value={d.id} /><Button type="submit" variant="danger" size="sm">Disconnect</Button></form>
                      </div>
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" className="p-5">
          <SectionHeader title="Connect a screen" sub="On the TV or tablet, open Brightframe and go to /pair, then type a code. Codes last 10 minutes and work once." />
          {codes.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {codes.map((c) => <li key={c.code} className="rounded-xl bg-apricot-soft px-4 py-2.5 font-mono text-2xl font-extrabold tracking-[0.2em] text-forest">{c.code}</li>)}
            </ul>
          )}
          <form action={newPairingCode} className="mt-4"><Button type="submit">{codes.length ? "Make another code" : "Make a code"}</Button></form>
        </Card>
      </div>
    </main>
  );
}
