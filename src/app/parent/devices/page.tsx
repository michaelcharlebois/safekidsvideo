import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveCodes, listDevices, resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { Button, Card, Pill, TopBar } from "@/components/ui";
import { newPairingCode, unpairDevice } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  if (!supabaseEnabled) redirect("/parent");
  const v = await resolveViewer();
  if (v.role !== "parent") redirect("/login?next=/parent/devices");
  const [codes, devices] = await Promise.all([listActiveCodes(v.familyId), listDevices(v.familyId)]);
  const active = devices.filter((d) => !d.revoked_at);

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
          {active.length === 0 && <p className="text-sm text-muted mt-1">None yet.</p>}
          <ul className="mt-2 space-y-2">
            {active.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <span className="font-bold">{d.name}</span>{" "}
                  <Pill className="bg-line">
                    {d.last_seen_at ? `seen ${new Date(d.last_seen_at).toLocaleDateString()}` : "not used yet"}
                  </Pill>
                </div>
                <form action={unpairDevice}>
                  <input type="hidden" name="deviceId" value={d.id} />
                  <Button type="submit" variant="danger" className="text-xs px-3 py-1">Disconnect</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
