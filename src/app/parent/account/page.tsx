import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { billingStatus, PRICE_DISPLAY } from "@/lib/billing";
import { countSubscriptions, pushEnabled } from "@/lib/push";
import { listDevices } from "@/lib/family";
import { pinIsSet } from "@/lib/pin";
import { Button, Card, PAGE, PageHeader, SectionHeader } from "@/components/ui";
import { IconChevron, IconShield, IconSparkle, IconTv, IconUser } from "@/components/icons";
import { lock, sendTestPush, signOut } from "@/app/actions";
import { NotifyButton } from "../notify-button";

export const dynamic = "force-dynamic";

/**
 * Account: the family account itself — who's signed in, notifications, screens, the plan — plus, folded
 * away, how the shared AI reviewer is doing. Children's settings live on Kids; the family PIN is there too.
 */
export default async function AccountPage(props: PageProps<"/parent/account">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/account" : "/unlock?next=/parent/account");
  const [family, subs, devices, settings, profiles] = await Promise.all([
    db.getFamily(v.familyId), countSubscriptions(v.familyId), supabaseEnabled ? listDevices(v.familyId) : Promise.resolve([]), db.getSettings(v.familyId), db.listProfiles(v.familyId),
  ]);
  const billing = billingStatus(family);
  const active = devices.filter((d) => !d.revoked_at).length;
  const pushTest = typeof sp.push === "string" ? Number(sp.push) : null;
  const planLine =
    billing.state === "trial" ? `Free trial, ${billing.daysLeft} day${billing.daysLeft === 1 ? "" : "s"} left`
    : billing.state === "active" ? `Subscribed, ${PRICE_DISPLAY}`
    : billing.state === "free" ? "Free while Brightframe is in testing"
    : billing.state === "past_due" ? "Payment problem: needs your attention"
    : "Not subscribed";

  return (
    <main className={PAGE}>
      <PageHeader title="Account" sub="Your family account, notifications, screens and plan." />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card as="section" className="p-5">
          <SectionHeader icon={<IconUser />} title="Family account" />
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted">Signed in as</dt><dd className="font-bold text-ink">{v.email ?? "Local mode (no account)"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted">Children</dt><dd className="font-bold text-ink">{profiles.length ? profiles.map((p) => p.name).join(", ") : "None yet"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted">Family PIN</dt><dd className="font-bold text-ink">{pinIsSet(settings.pinHash) ? "Set" : "Not set"} · <Link href="/parent/kids#family" className="text-forest underline decoration-sand underline-offset-4">Family settings</Link></dd></div>
          </dl>
          <div className="mt-5 border-t border-sand pt-4">
            {supabaseEnabled
              ? <form action={signOut}><Button variant="secondary" size="sm" type="submit">Sign out</Button></form>
              : <form action={lock}><Button variant="secondary" size="sm" type="submit">Lock the parent area</Button></form>}
          </div>
        </Card>

        <Card as="section" className="p-5" >
          <SectionHeader icon={<IconSparkle />} title="Notifications" sub="When a child asks for a video or more time, and the evening check-in." />
          <div className="mt-4">
            {!supabaseEnabled ? (
              <p className="text-sm text-muted">Notifications need a family account, so they aren&apos;t available in this local mode.</p>
            ) : pushEnabled ? (
              <div className="flex flex-wrap items-center gap-3">
                <NotifyButton vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} registered={subs} />
                {subs > 0 && (
                  <form action={sendTestPush} className="flex items-center gap-2">
                    <Button variant="quiet" size="sm" type="submit">Send a test</Button>
                    {pushTest !== null && <span className="text-xs text-muted">{pushTest ? `Sent to ${pushTest} phone${pushTest > 1 ? "s" : ""}.` : "No phone is registered."}</span>}
                  </form>
                )}
              </div>
            ) : <p className="text-sm text-muted">Notifications aren&apos;t switched on for this deployment.</p>}
          </div>
        </Card>
      </div>

      <Card as="section" className="mt-6 overflow-hidden">
        <ul className="divide-y divide-sand">
          <Row href="/parent/devices" icon={<IconTv />} title="Screens" sub={supabaseEnabled ? `${active} connected · pairing, shared and personal screens` : "TVs and tablets connect with a family account"} />
          <Row href="/parent/billing" icon={<IconShield />} title="Plan" sub={planLine} />
        </ul>
      </Card>

      <details className="mt-6 rounded-[var(--radius-card)] border border-sand bg-surface">
        <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-forest">More: how the AI reviewer is doing</summary>
        <div className="border-t border-sand px-5 py-4 text-sm text-muted">
          <p>Brightframe&apos;s reviewer is shared by every family. You can see how parents rate its reviews and the disputes it&apos;s learning from.</p>
          <Link href="/parent/reviewer" className="mt-3 inline-flex items-center gap-1 font-bold text-forest underline decoration-sand underline-offset-4">Reviewer accuracy<IconChevron size={16} /></Link>
        </div>
      </details>
    </main>
  );
}

function Row({ href, icon, title, sub }: { href: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-5 py-4 hover:bg-sand-soft">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage-soft text-forest">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block font-bold text-forest">{title}</span><span className="block text-sm text-muted">{sub}</span></span>
        <IconChevron className="text-muted" />
      </Link>
    </li>
  );
}
