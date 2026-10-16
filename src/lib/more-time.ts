import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { localTimeRequests } from "@/lib/db/local";
import { localDay } from "@/lib/checkin";
import { pushToFamily } from "@/lib/push";
import { assertPermissionWritesOpen, permissionWritesPaused } from "@/lib/maintenance";
import { bedtimeNow, clockTime, extensionChoices, extensionCutoff, isExtensionMinutes, nightOf, type BedtimeExtension } from "@/lib/bedtime";
import { approveBedtimeAsk, approveMinutesAsk, cancelExtension, grantExtension, grantMinutesToday, listExtensions } from "@/lib/bedtime-store";
import { serverNow } from "@/lib/clock";
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
export async function listTimeRequests(familyId: string, sinceDay?: string, now = serverNow()): Promise<TimeRequest[]> {
  const day = sinceDay ?? yesterday(localDay(await tzOf(familyId), now));
  if (local()) return (await localTimeRequests.list(familyId)).filter((r) => r.day >= day);
  if (!on()) return [];
  const { data, error } = await supabaseAdmin().from("time_requests").select("*").eq("family_id", familyId).gte("day", day).order("created_at");
  if (error) throw new Error(`Could not load time requests: ${error.message}`);
  return ((data ?? []) as Row[]).map(toReq);
}

/** A parent's answer targets ONE request in their own family, not a broad historical date range.
 * A query error is not the same as a missing request: never silently report "already answered".
 */
async function getTimeRequest(familyId: string, requestId: string): Promise<TimeRequest | undefined> {
  if (local()) return (await localTimeRequests.list(familyId)).find((r) => r.id === requestId);
  if (!on()) throw new Error("Time requests need the family database.");
  const { data, error } = await supabaseAdmin().from("time_requests").select("*")
    .eq("family_id", familyId).eq("id", requestId).maybeSingle();
  if (error) throw new Error(`Could not load time request: ${error.message}`);
  return data ? toReq(data as Row) : undefined;
}

/** Pending asks a parent can act on now (today's minutes, tonight's bedtime). */
export async function pendingTimeRequests(familyId: string, now = serverNow()): Promise<TimeRequest[]> {
  const tz = await tzOf(familyId);
  return liveTimeRequests(await listTimeRequests(familyId, undefined, now), localDay(tz, now), nightOf(now, tz));
}

export type AskOutcome = "created" | "pending" | "declined" | "fulfilled" | "not-offered" | "unavailable";
/**
 * The kid asks. Daily minutes: at most one pending ask per child per day. Bedtime: one ask per child per
 * night, whatever becomes of it (the database enforces both, across every screen). Only a NEW record tries
 * to notify. The answer reflects the stored state.
 */
export async function askForMoreTime(familyId: string, profileId: string, reason: TimeRequestKind, deviceId?: string, now = serverNow()): Promise<AskOutcome> {
  if (permissionWritesPaused()) return "unavailable";
  const tz = await tzOf(familyId);
  const today = localDay(tz, now), night = nightOf(now, tz);
  // A child must never create an unapprovable bedtime ask: the maximum is 60 minutes past the configured bedtime.
  if (reason === "bedtime") {
    const profile = await db.getProfile(profileId);
    if (!profile || profile.familyId !== familyId || !extensionChoices(now, profile.bedtime, tz).some((choice) => !choice.passed)) return "not-offered";
  }
  const ext = reason === "bedtime" ? (await listExtensions(familyId, night)).find((e) => e.profileId === profileId && e.night === night && !e.cancelledAt) : undefined;
  const state = timeAskState(reason, await listTimeRequests(familyId, undefined, now), profileId, { today, night, extensionMinutes: ext?.extraMinutes });
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
    const again = timeAskState(reason, await listTimeRequests(familyId, undefined, now), profileId, { today, night });
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

/**
 * A parent grants or changes tonight's extension directly: the cutoff is computed from tonight's scheduled
 * bedtime and, in the same transaction, tonight's pending bedtime ask (if any) is answered with it.
 */
export async function grantBedtimeExtension(familyId: string, profileId: string, minutes: number, opts: { grantedBy?: string; now?: Date } = {}): Promise<{ cutoffAt: string; night: string }> {
  assertPermissionWritesOpen();
  if (!isExtensionMinutes(minutes)) throw new Error("Pick 15, 30, 45 or 60 minutes.");
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== familyId) throw new Error("That isn't one of your children.");
  if (!p.bedtime) throw new Error(`${p.name} has no bedtime set.`);
  const tz = await tzOf(familyId);
  const now = opts.now ?? serverNow();
  const night = nightOf(now, tz);
  const cutoff = extensionCutoff(night, p.bedtime, minutes, tz);
  if (!cutoff) throw new Error("That bedtime isn't valid.");
  if (cutoff <= now) throw new Error(`${clockTime(cutoff, tz)} has already passed tonight.`);
  await grantExtension({ familyId, profileId, night, baseBedtime: p.bedtime, extraMinutes: minutes, cutoffAt: cutoff.toISOString(), grantedBy: opts.grantedBy });
  return { cutoffAt: cutoff.toISOString(), night };
}

/** Cancel tonight's extension. Takes effect at the child's next server check (pages, next video, the player's check). */
export async function cancelBedtimeExtension(familyId: string, profileId: string, now = serverNow()): Promise<boolean> {
  assertPermissionWritesOpen();
  return cancelExtension(familyId, profileId, nightOf(now, await tzOf(familyId)));
}

/** Tonight's live extension for a child, if any. */
export async function tonightsExtension(familyId: string, profileId: string, bedtime?: string, now = serverNow()): Promise<BedtimeExtension | null> {
  const tz = await tzOf(familyId);
  const night = nightOf(now, tz);
  return bedtimeNow(now, bedtime, tz, (await listExtensions(familyId, night)).filter((e) => e.profileId === profileId)).extension;
}

/**
 * A parent answers an ask. Approving and granting are ONE transaction (0023's approve_* functions; one store
 * write in local mode): an approved ask always has its minutes or extension, and a failure leaves the ask
 * pending. Of two simultaneous answers exactly one wins; a retry or stale page gets "gone". Declining only
 * changes the ask. Never reports a grant that didn't happen.
 */
export async function answerTimeRequest(familyId: string, requestId: string, decision: "approve" | "deny", minutes?: number, now = serverNow()): Promise<"done" | "gone" | "expired"> {
  assertPermissionWritesOpen();
  const tz = await tzOf(familyId);
  const req = await getTimeRequest(familyId, requestId);
  if (!req || req.status !== "pending") return "gone";
  const today = localDay(tz, now), night = nightOf(now, tz);
  if (req.day !== (req.kind === "bedtime" ? night : today)) return "expired";
  if (decision === "deny") {
    const ok = local()
      ? !!(await localTimeRequests.resolve(familyId, requestId, "denied"))
      : !!(await supabaseAdmin().from("time_requests").update({ status: "denied", resolved_at: new Date().toISOString() }).match({ id: requestId, family_id: familyId, status: "pending" }).select("id").maybeSingle()).data;
    return ok ? "done" : "gone";
  }
  if (req.kind === "limit") {
    if (minutes == null || !isGrant(minutes)) throw new Error("Pick 15, 30 or 60 minutes.");
    return approveMinutesAsk(familyId, requestId, minutes, today);
  }
  if (minutes == null || !isExtensionMinutes(minutes)) throw new Error("Pick 15, 30, 45 or 60 minutes.");
  const p = await db.getProfile(req.profileId);
  if (!p?.bedtime) throw new Error(`${p?.name ?? "This child"} has no bedtime set.`);
  const cutoff = extensionCutoff(night, p.bedtime, minutes, tz);
  if (!cutoff || cutoff <= now) throw new Error(`${cutoff ? clockTime(cutoff, tz) : "That time"} has already passed tonight. Pick a later time.`);
  return approveBedtimeAsk(familyId, requestId, minutes, cutoff.toISOString(), p.bedtime, night);
}

/** A parent adds minutes for today directly (Settings, Home, a bedtime card): one transaction that also answers today's pending ask. */
export async function grantMinutes(familyId: string, profileId: string, minutes: number, now = serverNow()): Promise<void> {
  assertPermissionWritesOpen();
  if (!isGrant(minutes)) throw new Error("Pick 15, 30 or 60 minutes.");
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== familyId) throw new Error("That isn't one of your children.");
  await grantMinutesToday(familyId, profileId, minutes, localDay(await tzOf(familyId), now));
}
