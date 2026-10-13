import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/db";
import type { Family } from "@/lib/types";

/**
 * Subscription plumbing. Env-gated: with no STRIPE_SECRET_KEY nobody is ever locked out,
 * so local dev and early testers just see "trial".
 */
export const billingEnabled = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
export const PRICE_DISPLAY = process.env.STRIPE_PRICE_DISPLAY ?? "$7.99 / month";
export const TRIAL_DAYS = 30;
const GRACE_DAYS = 7; // past_due keeps working this long

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export type BillingStatus = {
  state: "trial" | "active" | "past_due" | "expired" | "canceled" | "free";
  /** can the parent use the dashboard / can the kid search & approve? */
  ok: boolean;
  daysLeft?: number;
  plan: Family["plan"];
};

export function billingStatus(f: Family, now = Date.now()): BillingStatus {
  if (!billingEnabled || f.plan === "free") return { state: "free", ok: true, plan: f.plan };
  if (f.plan === "active") return { state: "active", ok: true, plan: f.plan };
  if (f.plan === "past_due") {
    const since = f.trialEndsAt ? Date.parse(f.trialEndsAt) : now; // best effort
    return { state: "past_due", ok: now - since < GRACE_DAYS * 86_400_000, plan: f.plan };
  }
  if (f.plan === "canceled") return { state: "canceled", ok: false, plan: f.plan };
  // trial
  const ends = f.trialEndsAt ? Date.parse(f.trialEndsAt) : now + TRIAL_DAYS * 86_400_000;
  const daysLeft = Math.ceil((ends - now) / 86_400_000);
  return daysLeft > 0 ? { state: "trial", ok: true, daysLeft, plan: f.plan } : { state: "expired", ok: false, daysLeft: 0, plan: f.plan };
}

export async function familyStatus(familyId: string): Promise<{ family: Family; status: BillingStatus }> {
  const family = await db.getFamily(familyId);
  return { family, status: billingStatus(family) };
}

async function customerFor(family: Family, email?: string): Promise<string> {
  if (family.stripeCustomerId) return family.stripeCustomerId;
  const c = await stripe().customers.create({ email, metadata: { family_id: family.id } });
  await db.updateFamily(family.id, { stripeCustomerId: c.id });
  return c.id;
}

/** Checkout for the subscription. Remaining trial days carry over so nobody is charged early. */
export async function createCheckoutUrl(familyId: string, email: string | undefined, origin: string): Promise<string> {
  const family = await db.getFamily(familyId);
  const customer = await customerFor(family, email);
  const trialEnd = family.trialEndsAt ? Math.floor(Date.parse(family.trialEndsAt) / 1000) : 0;
  const carryTrial = family.plan === "trial" && trialEnd > Math.floor(Date.now() / 1000) + 48 * 3600; // Stripe needs ≥48h
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { metadata: { family_id: familyId }, ...(carryTrial ? { trial_end: trialEnd } : {}) },
    allow_promotion_codes: true,
    success_url: `${origin}/parent/billing?ok=1`,
    cancel_url: `${origin}/parent/billing`,
  });
  return session.url!;
}

export async function createPortalUrl(familyId: string, origin: string): Promise<string | null> {
  const family = await db.getFamily(familyId);
  if (!family.stripeCustomerId) return null;
  const s = await stripe().billingPortal.sessions.create({ customer: family.stripeCustomerId, return_url: `${origin}/parent/billing` });
  return s.url;
}

/** Apply a Stripe subscription object to the family row. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const familyId = sub.metadata?.family_id || (await familyIdForCustomer(typeof sub.customer === "string" ? sub.customer : sub.customer.id));
  if (!familyId) return;
  const plan: Family["plan"] =
    sub.status === "active" || sub.status === "trialing" ? "active"
    : sub.status === "past_due" || sub.status === "unpaid" ? "past_due"
    : "canceled";
  await db.updateFamily(familyId, {
    plan,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    ...(sub.trial_end ? { trialEndsAt: new Date(sub.trial_end * 1000).toISOString() } : {}),
  });
}

async function familyIdForCustomer(customerId: string): Promise<string | undefined> {
  const c = await stripe().customers.retrieve(customerId);
  return c.deleted ? undefined : c.metadata?.family_id;
}
