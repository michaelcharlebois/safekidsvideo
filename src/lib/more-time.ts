import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { localTimeRequests } from "@/lib/db/local";
import { localDay } from "@/lib/checkin";
import { pushToFamily } from "@/lib/push";
import { grantBonusMinutes } from "@/lib/screentime";
import { isGrant, liveTimeRequests, timeAskState, type TimeRequest } from "@/lib/time-requests";

/*
 * "More time" requests, stored (migration 0022, or the local store in local mode). The record is what the
 * kid screen and the parent's Review show; push is a best-effort heads-up whose failure changes nothing.
 * Time is only ever added by a parent answering a request (or granting from Settings).
 */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const local = () => !supabaseEnabled;

type Row = { id: string; family_id: string; profile_id: string; kind: "limit"; day: string; status: TimeRequest["status"]; granted_minutes: number | null; device_id: string | null; created_at: string; resolved_at: string | null };
const toReq = (r: Row): TimeRequest => ({
  id: r.id, familyId: r.family_id, profileId: r.profile_id, kind: r.kind, day: r.day, status: r.status,
  grantedMinutes: r.granted_minutes && isGrant(r.granted_minutes) ? r.granted_minutes : undefined,
  deviceId: r.device_id ?? undefined, createdAt: r.created_at, resolvedAt: r.resolved_at ?? undefined,
});

/** A family's more-time requests from `sinceDay` on (default: today in the family's time zone). */
export async function listTimeRequests(familyId: string, sinceDay?: string): Promise<TimeRequest[]> {
  const day = sinceDay ?? localDay((await db.getFamily(familyId)).timezone);
  if (local()) return (await localTimeRequests.list(familyId)).filter((r) => r.day >= day);
  if (!on()) return [];
  const { data } = await supabaseAdmin().from("time_requests").select("*").eq("family_id", familyId).gte("day", day).order("created_at");
  return ((data ?? []) as Row[]).map(toReq);
}

/** Today's pending asks (the parent's inbox). */
export async function pendingTimeRequests(familyId: string): Promise<TimeRequest[]> {
  const tz = (await db.getFamily(familyId)).timezone;
  return liveTimeRequests(await listTimeRequests(familyId), localDay(tz));
}

export type AskOutcome = "created" | "pending" | "declined" | "not-offered" | "unavailable";
/**
 * The kid asks. Records at most one pending ask per child per day (any screen; the database enforces it),
 * then — only for a NEW record — tries to notify. The answer reflects the stored state.
 */
export async function askForMoreTime(familyId: string, profileId: string, reason: "limit" | "bedtime", deviceId?: string): Promise<AskOutcome> {
  const tz = (await db.getFamily(familyId)).timezone;
  const today = localDay(tz);
  const state = timeAskState(reason, await listTimeRequests(familyId, today), profileId, today);
  if (state !== "can-ask") return state;
  const dev = deviceId && deviceId !== "local" ? deviceId : undefined;
  let made: "created" | "exists";
  if (local()) made = await localTimeRequests.create({ familyId, profileId, kind: "limit", day: today, deviceId: dev });
  else if (!on()) return "unavailable";
  else {
    const { error } = await supabaseAdmin().from("time_requests").insert({ family_id: familyId, profile_id: profileId, kind: "limit", day: today, device_id: dev ?? null });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    made = error ? "exists" : "created"; // another screen asked a moment ago
  }
  if (made === "exists") return "pending";
  try {
    const p = await db.getProfile(profileId);
    await pushToFamily(familyId, {
      title: `${p?.name ?? "Your child"} is asking for more time`,
      body: "Open Review to add 15, 30 or 60 minutes for today, or say not today.",
      url: "/parent/review", tag: `more-time-${profileId}`,
    });
  } catch (e) {
    console.error("more-time push failed (the request is stored)", (e as Error).message);
  }
  return "created";
}

/**
 * A parent answers. Claims the pending request first (only one answer wins, so a double tap can't add time
 * twice), then adds the minutes. An earlier day's request has expired and can't be approved.
 */
export async function answerTimeRequest(familyId: string, requestId: string, decision: "approve" | "deny", minutes?: number): Promise<"done" | "gone" | "expired"> {
  const tz = (await db.getFamily(familyId)).timezone;
  const today = localDay(tz);
  if (decision === "approve" && (minutes == null || !isGrant(minutes))) throw new Error("Pick 15, 30 or 60 minutes.");
  const req = (await listTimeRequests(familyId, "0000-01-01")).find((r) => r.id === requestId);
  if (!req || req.status !== "pending") return "gone";
  if (req.day !== today) return "expired";
  const status = decision === "approve" ? "approved" : "denied";
  const granted = decision === "approve" && minutes != null && isGrant(minutes) ? minutes : undefined;
  let claimed: TimeRequest | undefined;
  if (local()) claimed = await localTimeRequests.resolve(familyId, requestId, status, granted);
  else {
    const { data } = await supabaseAdmin().from("time_requests")
      .update({ status, granted_minutes: granted ?? null, resolved_at: new Date().toISOString() })
      .match({ id: requestId, family_id: familyId, status: "pending" }).select("*").maybeSingle();
    claimed = data ? toReq(data as Row) : undefined;
  }
  if (!claimed) return "gone";
  if (granted) await grantBonusMinutes(claimed.profileId, granted, tz);
  return "done";
}

/** Settings → "extra time today" granted directly: answer today's pending ask for that child too. */
export async function settlePendingWithGrant(familyId: string, profileId: string, minutes: number) {
  if (!isGrant(minutes)) return;
  const live = (await pendingTimeRequests(familyId)).filter((r) => r.profileId === profileId);
  for (const r of live) {
    if (local()) await localTimeRequests.resolve(familyId, r.id, "approved", minutes);
    else if (on()) await supabaseAdmin().from("time_requests").update({ status: "approved", granted_minutes: minutes, resolved_at: new Date().toISOString() }).match({ id: r.id, family_id: familyId, status: "pending" });
  }
}
