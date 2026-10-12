import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import type { WatchRequest } from "@/lib/types";

/* "Ask a grown-up" requests and watch history. Supabase-only; local mode is a quiet no-op. */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);

type Row = { id: string; family_id: string; device_id: string | null; video_id: string; status: WatchRequest["status"]; created_at: string };
const toReq = (r: Row): WatchRequest => ({
  id: r.id, familyId: r.family_id, deviceId: r.device_id ?? undefined, videoId: r.video_id, status: r.status, createdAt: r.created_at,
});

export async function createRequest(familyId: string, videoId: string, deviceId?: string): Promise<"created" | "exists" | "off"> {
  if (!on()) return "off";
  const { error } = await supabaseAdmin()
    .from("watch_requests")
    .insert({ family_id: familyId, video_id: videoId, device_id: deviceId && deviceId !== "local" ? deviceId : null });
  if (error) return /duplicate|unique/i.test(error.message) ? "exists" : (() => { throw new Error(error.message); })();
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

export async function logWatch(familyId: string, videoId: string, deviceId: string | undefined, completed: boolean) {
  if (!on()) return;
  await supabaseAdmin().from("watch_events").insert({
    family_id: familyId,
    video_id: videoId,
    device_id: deviceId && deviceId !== "local" ? deviceId : null,
    completed,
  });
}
