import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { pushToFamily } from "@/lib/push";
import { db } from "@/lib/db";
import type { WatchRequest } from "@/lib/types";

/* "Ask a grown-up" requests and watch history. Supabase-only; local mode is a quiet no-op. */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);

type Row = { id: string; family_id: string; device_id: string | null; profile_id?: string | null; video_id: string; status: WatchRequest["status"]; created_at: string };
const toReq = (r: Row): WatchRequest => ({
  id: r.id, familyId: r.family_id, deviceId: r.device_id ?? undefined, profileId: r.profile_id ?? undefined, videoId: r.video_id, status: r.status, createdAt: r.created_at,
});

export async function createRequest(
  familyId: string, videoId: string, deviceId?: string, reason?: string, profileId?: string,
): Promise<"created" | "exists" | "off"> {
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
    tag: `request-${videoId}`,
  });
  return "created";
}

export async function listPendingRequests(familyId: string): Promise<WatchRequest[]> {
  if (!on()) return [];
  const { data } = await supabaseAdmin()
    .from("watch_requests")
    .select("*")
    .eq("family_id", familyId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map(toReq);
}

/** Video ids this family's kid has asked for and are still pending. */
export async function pendingVideoIds(familyId: string): Promise<Set<string>> {
  return new Set((await listPendingRequests(familyId)).map((r) => r.videoId));
}

export async function resolveRequest(familyId: string, requestId: string, status: "approved" | "denied") {
  if (!on()) return;
  await supabaseAdmin()
    .from("watch_requests")
    .update({ status, resolved_at: new Date().toISOString() })
    .match({ id: requestId, family_id: familyId, status: "pending" });
}

export async function logWatch(familyId: string, videoId: string, deviceId: string | undefined, completed: boolean, profileId?: string) {
  if (!on()) return;
  await supabaseAdmin().from("watch_events").insert({
    family_id: familyId,
    video_id: videoId,
    device_id: deviceId && deviceId !== "local" ? deviceId : null,
    profile_id: profileId ?? null,
    completed,
  });
}

/** How a play ended: skipped (left early for another video), finished, or just left (home / closed). */
export async function logWatchEnd(familyId: string, videoId: string, profileId: string | undefined, outcome: "skipped" | "finished" | "left", atSec: number) {
  if (!on()) return;
  await supabaseAdmin().from("watch_events").insert({ family_id: familyId, video_id: videoId, profile_id: profileId ?? null, completed: outcome === "finished", outcome, ended_at_sec: Math.max(0, Math.round(atSec)) });
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
export async function pendingCheckIds(familyId: string): Promise<Set<string>> {
  if (!on()) return new Set();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin()
    .from("kid_checks")
    .select("video_id")
    .eq("family_id", familyId)
    .eq("outcome", "pending")
    .gte("created_at", since);
  return new Set((data ?? []).map((r: { video_id: string }) => r.video_id));
}

/** Requests a parent approved in the last 24h — so the kid screen can celebrate them. */
export async function recentlyApprovedIds(familyId: string): Promise<Set<string>> {
  if (!on()) return new Set();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin()
    .from("watch_requests")
    .select("video_id")
    .eq("family_id", familyId)
    .eq("status", "approved")
    .gte("resolved_at", since);
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
