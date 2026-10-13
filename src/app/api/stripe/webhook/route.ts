import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { billingEnabled, stripe, syncSubscription } from "@/lib/billing";

export const dynamic = "force-dynamic";

/** Stripe → us. Verified with STRIPE_WEBHOOK_SECRET. Subscribe to customer.subscription.* and checkout.session.completed. */
export async function POST(req: NextRequest) {
  if (!billingEnabled || !process.env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "billing disabled" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "no signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return NextResponse.json({ error: `bad signature: ${(e as Error).message}` }, { status: 400 });
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.subscription) await syncSubscription(await stripe().subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
  }
  return NextResponse.json({ received: true });
}
