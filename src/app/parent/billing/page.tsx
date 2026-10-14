import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { billingEnabled, familyStatus, PRICE_DISPLAY, TRIAL_DAYS } from "@/lib/billing";
import { Button, Card, Notice, PAGE, PageHeader } from "@/components/ui";
import { openPortal, startCheckout } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BillingPage(props: PageProps<"/parent/billing">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/billing" : "/unlock?next=/parent/billing");
  const { family, status } = await familyStatus(v.familyId);
  const headline =
    status.state === "trial" ? `Free trial · ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left`
    : status.state === "active" ? "Subscribed"
    : status.state === "past_due" ? "Payment problem"
    : status.state === "expired" ? "Trial ended"
    : status.state === "canceled" ? "Subscription ended"
    : "Free";
  return (
      <main className={PAGE}>
      <PageHeader title="Plan" sub="One subscription covers every child and every screen." back={{ href: "/parent/account", label: "Account" }} />
      <div className="mt-6 max-w-2xl space-y-4">
        {sp.ok === "1" && <Notice tone="ok">Thanks, you&apos;re subscribed. It can take a few seconds to show here.</Notice>}
        <Card className="space-y-3 p-5">
          <p className="text-sm font-bold text-muted">Your plan</p>
          <h2 className="text-2xl">{headline}</h2>
          {!billingEnabled && <p className="text-sm text-muted">Billing isn&apos;t switched on for this deployment yet. Everything is free while Brightframe is in testing.</p>}
          {billingEnabled && (
            <>
              <p className="text-sm text-muted">
                Brightframe is <b>{PRICE_DISPLAY}</b> after a {TRIAL_DAYS}-day free trial. One subscription covers every kid and every screen in the house. Cancel any time.
                {status.state === "trial" && family.trialEndsAt ? <> Your trial runs until <b>{new Date(family.trialEndsAt).toLocaleDateString()}</b>; subscribing now doesn&apos;t charge you until then.</> : null}
                {status.state === "expired" ? <> The kid screen keeps playing what you&apos;ve already approved, but searching, checking and approving new videos are paused until you subscribe.</> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                {(status.state === "trial" || status.state === "expired" || status.state === "canceled") && (
                  <form action={startCheckout}><Button type="submit">Subscribe · {PRICE_DISPLAY}</Button></form>
                )}
                {family.stripeCustomerId && (
                  <form action={openPortal}><Button type="submit" variant="secondary">{status.state === "past_due" ? "Update payment" : "Manage subscription"}</Button></form>
                )}
              </div>
            </>
          )}
        </Card>
        <Card className="space-y-1 p-5 text-sm text-muted">
          <p><b className="text-ink">What you&apos;re paying for:</b> an AI reviewer that watches every video end to end before your kid sees it, a locked viewer for the TV, and the shared library of parent-confirmed reviews that improves as parents give feedback.</p>
          <p>Questions? <a className="font-bold text-forest underline" href="mailto:hello@siftkids.com">hello@siftkids.com</a></p>
        </Card>
      </div>
    </main>
  );
}
