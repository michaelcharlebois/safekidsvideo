import "server-only";
import webpush from "web-push";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";

/* Web push to parent phones. Needs VAPID keys in env; silently off without them. */

const PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIV = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@siftkids.com";

export const pushEnabled = !!(PUB && PRIV && supabaseEnabled);

let configured = false;
function ensure() {
  if (!configured && PUB && PRIV) {
    webpush.setVapidDetails(SUBJECT, PUB, PRIV);
    configured = true;
  }
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

export async function saveSubscription(
  familyId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
) {
  if (!supabaseEnabled) return;
  // Never transfer an existing notification endpoint to a different family.
  const admin = supabaseAdmin();
  const { data: existing, error: lookupError } = await admin.from("push_subscriptions")
    .select("family_id").eq("endpoint", sub.endpoint).maybeSingle();
  if (lookupError) throw new Error("Could not verify notification ownership");
  if (existing && existing.family_id !== familyId) throw new Error("Notification subscription belongs to another family");
  if (existing) {
    const { error } = await admin.from("push_subscriptions")
      .update({ p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent })
      .eq("endpoint", sub.endpoint).eq("family_id", familyId);
    if (error) throw new Error("Could not update notification subscription");
    return;
  }
  // A duplicate created concurrently must fail rather than overwrite another family's row.
  const { error } = await admin.from("push_subscriptions").insert({
    family_id: familyId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh,
    auth: sub.keys.auth, user_agent: userAgent,
  });
  if (error) throw new Error("Could not save notification subscription");
}

export async function removeSubscription(familyId: string, endpoint: string) {
  if (!supabaseEnabled) return;
  await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("family_id", familyId);
}

export async function countSubscriptions(familyId: string): Promise<number> {
  if (!supabaseEnabled) return 0;
  const { count } = await supabaseAdmin()
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId);
  return count ?? 0;
}

/** Send to every phone registered for the family. Dead subscriptions are pruned. */
export async function pushToFamily(familyId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled) return 0;
  ensure();
  const { data } = await supabaseAdmin().from("push_subscriptions").select("endpoint,p256dh,auth").eq("family_id", familyId);
  let sent = 0;
  for (const s of data ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 6, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await removeSubscription(familyId, s.endpoint);
      else console.error("push failed", status, (e as Error).message);
    }
  }
  return sent;
}
