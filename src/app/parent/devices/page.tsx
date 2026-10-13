import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveCodes, listDevices, resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { Button, Card, Pill, TopBar } from "@/components/ui";
import { assignDeviceAction, newPairingCode, unpairDevice } from "@/app/actions";
import { db } from "@/lib/db";
import { pinIsSet } from "@/lib/pin";

export const dynamic = "force-dynamic";

export default async function DevicesPage(props: PageProps<"/parent/devices">) {
  if (!supabaseEnabled) redirect("/parent");
  const v = await resolveViewer();
  if (v.role !== "parent") redirect("/login?next=/parent/devices");
  const [codes, devices, profiles, fam] = await Promise.all([listActiveCodes(v.familyId), listDevices(v.familyId), db.listProfiles(v.familyId), db.getSettings(v.familyId)]);
  const active = devices.filter((d) => !d.revoked_at);
  const sp = await props.searchParams;
  const multi = profiles.length > 1;
  const pinReady = pinIsSet(fam.pinHash);

  return (
    <>
      <TopBar title="Devices" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Library</Link>} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        <Card className="p-4">
          <h2 className="font-extrabold">Connect a kid&apos;s device</h2>
          <p className="text-sm text-muted">
            On the tablet or TV, open this site and go to <b>/pair</b>. Then type one of these codes. Codes last 10 minutes and work once.
          </p>
          {codes.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-3">
              {codes.map((c) => (
                <li key={c.code} className="rounded-xl bg-sun px-5 py-3 text-2xl sm:text-3xl font-extrabold tracking-[0.2em]">{c.code}</li>
              ))}
            </ul>
          )}
          <form action={newPairingCode} className="mt-3">
            <Button type="submit">{codes.length ? "Make another code" : "Make a code"}</Button>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="font-extrabold">Connected devices</h2>
          {multi && <p className="text-sm text-muted">A <b>personal</b> device always shows one child&apos;s screen. A <b>shared</b> screen (like the living-room TV) needs your PIN to choose or switch kids.</p>}
          {multi && !pinReady && <p className="mt-2 rounded-xl bg-sun/40 p-2 text-sm font-bold">Shared screens are locked until you set a PIN in <Link href="/parent/settings" className="underline">Settings</Link>.</p>}
          {sp.saved === "1" && <p className="mt-2 text-sm font-bold text-ok">Saved.</p>}
          {active.length === 0 && <p className="text-sm text-muted mt-1">None yet.</p>}
          <ul className="mt-2 divide-y divide-line">
            {active.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-bold">{d.name}</span>{" "}
                  <Pill className="bg-line">
                    {d.last_seen_at ? `seen ${new Date(d.last_seen_at).toLocaleDateString()}` : "not used yet"}
                  </Pill>
                  {!d.assigned_profile_id && multi && d.active_profile_id && (
                    <span className="ml-1 text-xs text-muted">watching as {profiles.find((p) => p.id === d.active_profile_id)?.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {multi && (
                    <form action={assignDeviceAction} className="flex items-center gap-1">
                      <input type="hidden" name="deviceId" value={d.id} />
                      <select name="profileId" defaultValue={d.assigned_profile_id ?? ""} className="rounded-full border border-line bg-bg px-2 py-1 text-xs">
                        <option value="">Shared (PIN to switch)</option>
                        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s device</option>)}
                      </select>
                      <Button type="submit" variant="ghost" className="text-xs px-2.5 py-1">Save</Button>
                    </form>
                  )}
                  <form action={unpairDevice}>
                    <input type="hidden" name="deviceId" value={d.id} />
                    <Button type="submit" variant="danger" className="text-xs px-3 py-1">Disconnect</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
