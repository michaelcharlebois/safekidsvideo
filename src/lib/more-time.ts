import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { localTimeRequests } from "@/lib/db/local";
import { localDay } from "@/lib/checkin";
import { pushToFamily } from "@/lib/push";
import { grantBonusMinutes } from "@/lib/screentime";
import { assertPermissionWritesOpen, permissionWritesPaused } from "@/lib/maintenance";
import { bedtimeNow, clockTime, extensionCutoff, isExtensionMinutes, nightOf, type BedtimeExtension } from "@/lib/bedtime";
import { cancelExtension, listExtensions, setExtension } from "@/lib/bedtime-store";
import { isGrant, liveTimeRequests, timeAskState, type TimeRequest, type TimeRequestKind } from "@/lib/time-requests";

/*
 * Asks for more time, stored (migrations 0022/0023, or the local store): daily minutes ("limit") and a
 * one-night bedtime extension ("bedtime"). The record is what the kid screen and the parent's Review show;
 * push is a best-effort heads-up whose failure changes nothing. Only a parent adds minutes or extends
 * bedtime: by answering an ask, or directly.
 */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const local = () => !supabaseEnabled;

type Row = { id: string; family_id: string; profile_id: string; kind: TimeRequestKind; day: string; status: TimeRequest["status"]; granted_minutes: number | null; device_id: string | null; created_at: string; resolved_at: string | null };
const toReq = (r: Row): TimeRequest => ({
  id: r.id, familyId: r.family_id, profileId: r.profile_id, kind: r.kind, day: r.day, status: r.status,
  grantedMinutes: r.granted_minutes && [15, 30, 45, 60].includes(r.granted_minutes) ? (r.granted_minutes as 15 | 30 | 45 | 60) : undefined,
  deviceId: r.device_id ?? undefined, createdAt: r.created_at, resolvedAt: r.resolved_at ?? undefined,
});

const tzOf = async (familyId: string) => (await db.getFamily(familyId)).timezone;
const yesterday = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** A family's asks from `sinceDay` on (default: last night onward, so tonight's bedtime asks after midnight count). */
export async function listTimeRequests(familyId: string, sinceDay?: string): Promise<TimeRequest[]> {
  const day = sinceDay ?? yesterday(localDay(await tzOf(familyId)));
  if (local()) return (await localTimeRequests.list(familyId)).filter((r) => r.day >= day);
  if (!on()) return [];
  const { data } = await supabaseAdmin().from("time_requests").select("*").eq("family_id", familyId).gte("day", day).order("created_at");
  return ((data ?? []) as Row[]).map(toReq);
}

/** Pending asks a parent can act on now (today's minutes, tonight's bedtime). */
export async function pendingTimeRequests(familyId: string): Promise<TimeRequest[]> {
  const tz = await tzOf(familyId);
  const now = new Date();
  return liveTimeRequests(await listTimeRequests(familyId), localDay(tz, now), nightOf(now, tz));
}

export type AskOutcome = "created" | "pending" | "declined" | "fulfilled" | "not-offered" | "unavailable";
/**
 * The kid asks. Daily minutes: at most one pending ask per child per day. Bedtime: one ask per child per
 * night, whatever becomes of it (the database enforces both, across every screen). Only a NEW record tries
 * to notify. The answer reflects the stored state.
 */
export async function askForMoreTime(familyId: string, profileId: string, reason: TimeRequestKind, deviceId?: string): Promise<AskOutcome> {
  if (permissionWritesPaused()) return "unavailable";
  const tz = await tzOf(familyId);
  const now = new Date();
  const today = localDay(tz, now), night = nightOf(now, tz);
  const ext = reason === "bedtime" ? (await listExtensions(familyId, night)).find((e) => e.profileId === profileId && e.night === night && !e.cancelledAt) : undefined;
  const state = timeAskState(reason, await listTimeRequests(familyId), profileId, { today, night, extensionMinutes: ext?.extraMinutes });
  if (state !== "can-ask") return state;
  const day = reason === "bedtime" ? night : today;
  const dev = deviceId && deviceId !== "local" ? deviceId : undefined;
  let made: "created" | "exists";
  if (local()) made = await localTimeRequests.create({ familyId, profileId, kind: reason, day, deviceId: dev });
  else if (!on()) return "unavailable";
  else {
    const { error } = await supabaseAdmin().from("time_requests").insert({ family_id: familyId, profile_id: profileId, kind: reason, day, device_id: dev ?? null });
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    made = error ? "exists" : "created"; // another screen asked a moment ago
  }
  if (made === "exists") {
    const again = timeAskState(reason, await listTimeRequests(familyId), profileId, { today, night });
    return again === "can-ask" ? "pending" : again;
  }
  try {
    const p = await db.getProfile(profileId);
    const name = p?.name ?? "Your child";
    await pushToFamily(familyId, reason === "bedtime"
      ? { title: `${name} is asking to stay up a little later`, body: "Open Review to let them watch a bit longer tonight, or say not tonight.", url: "/parent/review", tag: `bedtime-${profileId}` }
      : { title: `${name} is asking for more time`, body: "Open Review to add 15, 30 or 60 minutes for today, or say not today.", url: "/parent/review", tag: `more-time-${profileId}` });
  } catch (e) {
    console.error("time-request push failed (the request is stored)", (e as Error).message);
  }
  return "created";
}

/** Grant or change tonight's bedtime extension for a child, directly or from an ask. The cutoff is computed from tonight's scheduled bedtime. */
export async function grantBedtimeExtension(familyId: string, profileId: string, minutes: number, opts: { requestId?: string; grantedBy?: string; now?: Date } = {}): Promise<BedtimeExtension> {
  assertPermissionWritesOpen();
  if (!isExtensionMinutes(minutes)) throw new Error("Pick 15, 30, 45 or 60 minutes.");
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== familyId) throw new Error("That isn't one of your children.");
  if (!p.bedtime) throw new Error(`${p.name} has no bedtime set.`);
  const tz = await tzOf(familyId);
  const now = opts.now ?? new Date();
  const night = nightOf(now, tz);
  const cutoff = extensionCutoff(night, p.bedtime, minutes, tz);
  if (!cutoff) throw new Error("That bedtime isn't valid.");
  if (cutoff <= now) throw new Error(`${clockTime(cutoff, tz)} has already passed tonight.`);
  return setExtension({ familyId, profileId, night, baseBedtime: p.bedtime, extraMinutes: minutes, cutoffAt: cutoff.toISOString(), requestId: opts.requestId, grantedBy: opts.grantedBy });
}

/** Cancel tonight's extension. Takes effect at the child's next server check (pages, next video, the player's check). */
export async function cancelBedtimeExtension(familyId: string, profileId: string): Promise<boolean> {
  assertPermissionWritesOpen();
  return cancelExtension(familyId, profileId, nightOf(new Date(), await tzOf(familyId)));
}

/** Tonight's live extension for a child, if any. */
export async function tonightsExtension(familyId: string, profileId: string, bedtime?: string): Promise<BedtimeExtension | null> {
  const tz = await tzOf(familyId);
  const night = nightOf(new Date(), tz);
  return bedtimeNow(new Date(), bedtime, tz, (await listExtensions(familyId, night)).filter((e) => e.profileId === profileId)).extension;
}

/**
 * A parent answers an ask. Validates first, then claims the pending request (only one answer wins, so a
 * double tap can't add time twice), then applies it: minutes for today, or tonight's extension.
 */
export async function answerTimeRequest(familyId: string, requestId: string, decision: "approve" | "deny", minutes?: number, grantedBy?: string): Promise<"done" | "gone" | "expired"> {
  assertPermissionWritesOpen();
  const tz = await tzOf(familyId);
  const now = new Date();
  const req = (await listTimeRequests(familyId, "0000-01-01")).find((r) => r.id === requestId);
  if (!req || req.status !== "pending") return "gone";
  if (req.day !== (req.kind === "bedtime" ? nightOf(now, tz) : localDay(tz, now))) return "expired";
  if (decision === "approve") {
    if (req.kind === "limit" && (minutes == null || !isGrant(minutes))) throw new Error("Pick 15, 30 or 60 minutes.");
    if (req.kind === "bedtime") {
      if (minutes == null || !isExtensionMinutes(minutes)) throw new Error("Pick 15, 30, 45 or 60 minutes.");
      const p = await db.getProfile(req.profileId);
      if (!p?.bedtime) throw new Error(`${p?.name ?? "This child"} has no bedtime set.`);
      const cutoff = extensionCutoff(nightOf(now, tz), p.bedtime, minutes, tz);
      if (!cutoff || cutoff <= now) throw new Error(`${cutoff ? clockTime(cutoff, tz) : "That time"} has already passed tonight. Pick a later time.`);
    }
  }
  const status = decision === "approve" ? "approved" : "denied";
  const granted = decision === "approve" ? (minutes as 15 | 30 | 45 | 60) : undefined;
  let claimed: TimeRequest | undefined;
  if (local()) claimed = await localTimeRequests.resolve(familyId, requestId, status, granted);
  else {
    const { data } = await supabaseAdmin().from("time_requests")
      .update({ status, granted_minutes: granted ?? null, resolved_at: new Date().toISOString() })
      .match({ id: requestId, family_id: familyId, status: "pending" }).select("*").maybeSingle();
    claimed = data ? toReq(data as Row) : undefined;
  }
  if (!claimed) return "gone";
  if (granted && claimed.kind === "limit") await grantBonusMinutes(claimed.profileId, granted, tz);
  if (granted && claimed.kind === "bedtime") await grantBedtimeExtension(familyId, claimed.profileId, granted, { requestId, grantedBy });
  return "done";
}

/** Settings → "extra time today" granted directly: answer today's pending minutes ask for that child too. */
export async function settlePendingWithGrant(familyId: string, profileId: string, minutes: number) {
  if (!isGrant(minutes)) return;
  const live = (await pendingTimeRequests(familyId)).filter((r) => r.profileId === profileId && r.kind === "limit");
  for (const r of live) {
    if (local()) await localTimeRequests.resolve(familyId, r.id, "approved", minutes);
    else if (on()) await supabaseAdmin().from("time_requests").update({ status: "approved", granted_minutes: minutes, resolved_at: new Date().toISOString() }).match({ id: r.id, family_id: familyId, status: "pending" });
  }
}

/** A direct extension also answers tonight's pending bedtime ask for that child (as fulfilled). */
export async function settlePendingBedtimeWithGrant(familyId: string, profileId: string, minutes: number) {
  if (!isExtensionMinutes(minutes)) return;
  const live = (await pendingTimeRequests(familyId)).filter((r) => r.profileId === profileId && r.kind === "bedtime");
  for (const r of live) {
    if (local()) await localTimeRequests.resolve(familyId, r.id, "approved", minutes);
    else if (on()) await supabaseAdmin().from("time_requests").update({ status: "approved", granted_minutes: minutes, resolved_at: new Date().toISOString() }).match({ id: r.id, family_id: familyId, status: "pending" });
  }
}
