import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { billingStatus, PRICE_DISPLAY } from "@/lib/billing";
import { countSubscriptions, pushEnabled } from "@/lib/push";
import { listDevices } from "@/lib/family";
import { Button, Card, TopBar } from "@/components/ui";
import { lock, sendTestPush, signOut } from "@/app/actions";
import { NotifyButton } from "../notify-button";

export const dynamic = "force-dynamic";

/** Everything that isn't about a kid or a video: screens, notifications, plan, the reviewer, sign out. */
export default async function AccountPage(props: PageProps<"/parent/account">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/account" : "/unlock?next=/parent/account");
  const [family, subs, devices] = await Promise.all([db.getFamily(v.familyId), countSubscriptions(v.familyId), supabaseEnabled ? listDevices(v.familyId) : Promise.resolve([])]);
  const billing = billingStatus(family);
  const active = devices.filter((d) => !d.revoked_at).length;
  const pushTest = typeof sp.push === "string" ? Number(sp.push) : null;
  const planLine = billing.state === "trial" ? `Free trial, ${billing.daysLeft} day${billing.daysLeft === 1 ? "" : "s"} left` : billing.state === "active" ? `Subscribed, ${PRICE_DISPLAY}` : billing.state === "free" ? "Free while we test" : "Needs attention";
  return (
    <>
      <TopBar title="Account" />
      <main className="mx-auto w-full max-w-xl px-4 py-5 space-y-3">
        {supabaseEnabled && (
          <Card className="p-4 space-y-3">
            <div>
              <h2 className="font-extrabold">Notifications</h2>
              <p className="text-sm text-muted">When a kid asks for a video or more time, and the evening check-in.</p>
            </div>
            {pushEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <NotifyButton vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} registered={subs} />
                {subs > 0 && (
                  <form action={sendTestPush}>
                    <Button variant="ghost" type="submit" className="text-xs px-3 py-1">Send a test</Button>
                    {pushTest !== null && <span className="ml-2 text-xs text-muted">{pushTest ? `sent to ${pushTest} phone${pushTest > 1 ? "s" : ""}` : "nothing registered"}</span>}
                  </form>
                )}
              </div>
            ) : <p className="text-xs text-muted">Not available on this deployment.</p>}
          </Card>
        )}
        <Row href="/parent/devices" title="Screens" sub={supabaseEnabled ? `${active} connected` : "Local mode"} />
        <Row href="/parent/billing" title="Plan" sub={planLine} />
        <Row href="/parent/reviewer" title="The reviewer" sub="How accurate it's been, and what it's learned from parents" />
        <Row href="/parent/insights" title="Insights" sub="Mood vs. what they watched" />
        <div className="pt-4 flex items-center justify-between text-sm">
          <span className="text-muted">{v.email ?? "Local mode"}</span>
          {supabaseEnabled ? <form action={signOut}><Button variant="ghost" type="submit">Sign out</Button></form> : <form action={lock}><Button variant="ghost" type="submit">Lock</Button></form>}
        </div>
      </main>
    </>
  );
}

function Row({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="block">
      <Card className="flex items-center justify-between p-4 hover:bg-surface/60">
        <span><span className="block font-extrabold">{title}</span><span className="block text-sm text-muted">{sub}</span></span>
        <span className="text-muted">›</span>
      </Card>
    </Link>
  );
}
