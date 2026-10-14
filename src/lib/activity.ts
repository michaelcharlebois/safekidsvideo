import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { pushToFamily } from "@/lib/push";
import { db } from "@/lib/db";
import type { WatchRequest } from "@/lib/types";
import { localRequests, localWatchEvents } from "@/lib/db/local";
import { assertPermissionWritesOpen } from "@/lib/maintenance";

/*
 * "Ask a grown-up" requests and watch history. Requests work in Supabase and in local mode (lib/db/local.ts
 * localRequests, same rules); watch history too (local mode keeps it in the local store, same one-start/one-end rule). Every request is child-scoped: one PENDING
 * request per child per video, and the parent's phone is only pinged when a new one is created.
 */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const local = () => !supabaseEnabled;

type Row = { id: string; family_id: string; device_id: string | null; profile_id?: string | null; video_id: string; status: WatchRequest["status"]; created_at: string };
const toReq = (r: Row): WatchRequest => ({
  id: r.id, familyId: r.family_id, deviceId: r.device_id ?? undefined, profileId: r.profile_id ?? undefined, videoId: r.video_id, status: r.status, createdAt: r.created_at,
});

export async function createRequest(
  familyId: string, videoId: string, deviceId?: string, reason?: string, profileId?: string,
): Promise<"created" | "exists" | "off"> {
  assertPermissionWritesOpen();
  if (local()) return localRequests.create({ familyId, videoId, profileId, deviceId: deviceId && deviceId !== "local" ? deviceId : undefined });
  if (!on()) return "off";
  const { error } = await supabaseAdmin()
    .from("watch_requests")
    .insert({ family_id: familyId, video_id: videoId, device_id: deviceId && deviceId !== "local" ? deviceId : null, profile_id: profileId ?? null });
  if (error) return /duplicate|unique/i.test(error.message) ? "exists" : (() => { throw new Error(error.message); })();
  // Ring the doorbell.
  const [video, profile] = await Promise.all([db.getVideo(videoId), profileId ? db.getProfile(profileId) : undefined]);
  await pushToFamily(familyId, {
    title: `${profile?.name ?? "Your kid"} asked for a video`,
    body: `${video?.title ?? videoId}${reason ? ` — ${reason}` : ""}`,
    url: `/parent/video/${videoId}`,
    tag: `request-${videoId}-${profileId ?? "family"}`, // one notification per child per video
  });
  return "created";
}

export async function listPendingRequests(familyId: string): Promise<WatchRequest[]> {
  if (local()) return (await localRequests.list(familyId)).filter((r) => r.status === "pending").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!on()) return [];
  const { data } = await supabaseAdmin()
    .from("watch_requests")
    .select("*")
    .eq("family_id", familyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map(toReq);
}

/** Video ids this child has asked for that are still pending (all children if no child given). */
export async function pendingVideoIds(familyId: string, profileId?: string): Promise<Set<string>> {
  return new Set((await listPendingRequests(familyId)).filter((r) => !profileId || r.profileId === profileId).map((r) => r.videoId));
}

export async function getRequest(familyId: string, requestId: string): Promise<WatchRequest | undefined> {
  if (local()) return (await localRequests.list(familyId)).find((r) => r.id === requestId);
  if (!on()) return undefined;
  const { data } = await supabaseAdmin().from("watch_requests").select("*").match({ id: requestId, family_id: familyId }).maybeSingle();
  return data ? toReq(data as Row) : undefined;
}

export async function resolveRequest(familyId: string, requestId: string, status: "approved" | "denied") {
  assertPermissionWritesOpen();
  if (local()) return localRequests.resolve(familyId, requestId, status);
  if (!on()) return;
  await supabaseAdmin()
    .from("watch_requests")
    .update({ status, resolved_at: new Date().toISOString() })
    .match({ id: requestId, family_id: familyId, status: "pending" });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Unique-index conflict: the same session row was already written (a retry). Safe to ignore. */
const duplicate = (e: { code?: string } | null) => e?.code === "23505";

/**
 * A viewing session began (see lib/sessions.ts). One row per session: a retried call is ignored by the
 * 0020 unique index. Viewing is only recorded for a known child; without one nothing is written.
 */
export async function logWatchStart(familyId: string, videoId: string, deviceId: string | undefined, profileId: string | undefined, sessionId: string) {
  if (!profileId || !UUID.test(sessionId)) return;
  if (local()) return localWatchEvents.add({ familyId, videoId, profileId, startedAt: new Date().toISOString(), completed: false, sessionId });
  if (!on()) return;
  const { error } = await supabaseAdmin().from("watch_events").insert({
    family_id: familyId, video_id: videoId, device_id: deviceId && deviceId !== "local" ? deviceId : null,
    profile_id: profileId, completed: false, session_id: sessionId,
  });
  if (error && !duplicate(error)) console.error("logWatchStart", error.message);
}

/** How that session ended: finished, skipped (left for another video) or left (home / closed). Once per session. */
export async function logWatchEnd(familyId: string, videoId: string, profileId: string | undefined, outcome: "skipped" | "finished" | "left", atSec: number, sessionId: string, watchedSec?: number) {
  if (!profileId || !UUID.test(sessionId)) return;
  if (local()) {
    return localWatchEvents.add({
      familyId, videoId, profileId, startedAt: new Date().toISOString(), completed: outcome === "finished", outcome, sessionId,
      endedAtSec: Math.max(0, Math.round(Number.isFinite(atSec) ? atSec : 0)),
      watchedSec: watchedSec != null && Number.isFinite(watchedSec) ? Math.max(0, Math.min(6 * 3600, Math.round(watchedSec))) : undefined,
    });
  }
  if (!on()) return;
  const { error } = await supabaseAdmin().from("watch_events").insert({
    family_id: familyId, video_id: videoId, profile_id: profileId, completed: outcome === "finished", outcome,
    ended_at_sec: Math.max(0, Math.round(Number.isFinite(atSec) ? atSec : 0)), session_id: sessionId,
    // Playback time (not playhead position). Omitted when the player didn't report it.
    ...(watchedSec != null && Number.isFinite(watchedSec) ? { watched_sec: Math.max(0, Math.min(6 * 3600, Math.round(watchedSec))) } : {}),
  });
  if (error && !duplicate(error)) console.error("logWatchEnd", error.message);
}

// ---- kid-triggered AI checks ------------------------------------------------

export type CheckOutcome = "pending" | "passed" | "blocked" | "needs_parent" | "failed";

export async function checksToday(familyId: string, profileId?: string): Promise<number> {
  if (!on()) return 0;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  let q = supabaseAdmin()
    .from("kid_checks")
    .select("id", { count: "exact", head: true })
    .eq("family_id", familyId)
    .gte("created_at", since.toISOString());
  if (profileId) q = q.eq("profile_id", profileId);
  const { count } = await q;
  return count ?? 0;
}

export async function logCheck(familyId: string, videoId: string, deviceId: string | undefined, outcome: CheckOutcome, profileId?: string): Promise<string | null> {
  if (!on()) return null;
  const { data } = await supabaseAdmin()
    .from("kid_checks")
    .insert({ family_id: familyId, video_id: videoId, device_id: deviceId && deviceId !== "local" ? deviceId : null, outcome, profile_id: profileId ?? null })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function finishCheck(checkId: string | null, outcome: Exclude<CheckOutcome, "pending">) {
  if (!on() || !checkId) return;
  await supabaseAdmin().from("kid_checks").update({ outcome, resolved_at: new Date().toISOString() }).eq("id", checkId);
}

/** Video ids with a check still running (started in the last 10 minutes). */
export async function pendingCheckIds(familyId: string, profileId?: string): Promise<Set<string>> {
  if (!on()) return new Set();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let q = supabaseAdmin()
    .from("kid_checks")
    .select("video_id")
    .eq("family_id", familyId)
    .eq("outcome", "pending")
    .gte("created_at", since);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data } = await q;
  return new Set((data ?? []).map((r: { video_id: string }) => r.video_id));
}

/** Requests a parent approved in the last 24h — so the kid screen can celebrate them. */
export async function recentlyApprovedIds(familyId: string, profileId?: string): Promise<Set<string>> {
  return recentlyResolvedIds(familyId, "approved", profileId);
}

/** Requests a parent turned down in the last 24h: the kid screen says "not now" instead of offering to ask again. */
export async function recentlyDeclinedIds(familyId: string, profileId?: string): Promise<Set<string>> {
  return recentlyResolvedIds(familyId, "denied", profileId);
}

async function recentlyResolvedIds(familyId: string, status: "approved" | "denied", profileId?: string): Promise<Set<string>> {
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  if (local()) return new Set((await localRequests.list(familyId)).filter((r) => r.status === status && r.resolvedAt && Date.parse(r.resolvedAt) >= sinceMs && (!profileId || r.profileId === profileId)).map((r) => r.videoId));
  if (!on()) return new Set();
  const since = new Date(sinceMs).toISOString();
  let q = supabaseAdmin()
    .from("watch_requests")
    .select("video_id")
    .eq("family_id", familyId)
    .eq("status", status)
    .gte("resolved_at", since);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data } = await q;
  return new Set((data ?? []).map((r: { video_id: string }) => r.video_id));
}

/** The last few distinct videos this family's kid played, newest first — the "Keep watching" shelf. */
export async function recentWatchIds(familyId: string, limit = 8, profileId?: string): Promise<string[]> {
  if (!on()) return [];
  let q = supabaseAdmin()
    .from("watch_events")
    .select("video_id,started_at")
    .eq("family_id", familyId)
    .order("started_at", { ascending: false })
    .limit(limit * 4);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data } = await q;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of (data ?? []) as { video_id: string }[]) {
    if (seen.has(r.video_id)) continue;
    seen.add(r.video_id);
    out.push(r.video_id);
    if (out.length >= limit) break;
  }
  return out;
}
