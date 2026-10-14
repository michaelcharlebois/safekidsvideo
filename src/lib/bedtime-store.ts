import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { localBedtimeExtensions, localTimeGrants } from "@/lib/db/local";
import { isExtensionMinutes, type BedtimeExtension } from "@/lib/bedtime";

/* One-night bedtime extensions and time grants, stored (migration 0023, or the local store in local mode). Every grant goes through one transaction. */

const on = () => supabaseEnabled && !!(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const local = () => !supabaseEnabled;

type Row = { id: string; family_id: string; profile_id: string; night: string; base_bedtime: string; extra_minutes: number; cutoff_at: string; request_id: string | null; granted_by: string | null; created_at: string; updated_at: string | null; cancelled_at: string | null };
const toExt = (r: Row): BedtimeExtension => ({
  id: r.id, familyId: r.family_id, profileId: r.profile_id, night: r.night, baseBedtime: r.base_bedtime,
  extraMinutes: isExtensionMinutes(r.extra_minutes) ? r.extra_minutes : 15, cutoffAt: new Date(r.cutoff_at).toISOString(),
  requestId: r.request_id ?? undefined, grantedBy: r.granted_by ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at ?? undefined, cancelledAt: r.cancelled_at ?? undefined,
});

/** A family's extensions from `sinceNight` on (live and cancelled). */
export async function listExtensions(familyId: string, sinceNight: string): Promise<BedtimeExtension[]> {
  if (local()) return localBedtimeExtensions.list(familyId, sinceNight);
  if (!on()) return [];
  const { data } = await supabaseAdmin().from("bedtime_extensions").select("*").eq("family_id", familyId).gte("night", sinceNight);
  return ((data ?? []) as Row[]).map(toExt);
}

/**
 * Grant or change tonight's extension directly, and answer tonight's pending ask with it — one transaction
 * (0023's grant_bedtime_extension; one store write in local mode).
 */
export async function grantExtension(e: { familyId: string; profileId: string; night: string; baseBedtime: string; extraMinutes: 15 | 30 | 45 | 60; cutoffAt: string; grantedBy?: string }): Promise<string> {
  if (local()) return (await localTimeGrants.grantBedtime(e.familyId, e.profileId, e.night, e.baseBedtime, e.extraMinutes, e.cutoffAt)).id;
  if (!on()) throw new Error("Bedtime extensions need the family database.");
  const { data, error } = await supabaseAdmin().rpc("grant_bedtime_extension", { p_family: e.familyId, p_profile: e.profileId, p_night: e.night, p_base: e.baseBedtime, p_minutes: e.extraMinutes, p_cutoff: e.cutoffAt, p_granted_by: e.grantedBy ?? null });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Approve a bedtime ask and set the extension it asks for, atomically. */
export async function approveBedtimeAsk(familyId: string, requestId: string, minutes: 15 | 30 | 45 | 60, cutoffAt: string, baseBedtime: string, night: string): Promise<"done" | "gone" | "expired"> {
  if (local()) return localTimeGrants.approveBedtime(familyId, requestId, minutes, cutoffAt, baseBedtime, night);
  if (!on()) return "gone";
  const { data, error } = await supabaseAdmin().rpc("approve_bedtime_request", { p_family: familyId, p_request: requestId, p_minutes: minutes, p_cutoff: cutoffAt, p_base: baseBedtime, p_night: night });
  if (error) throw new Error(error.message);
  return data as "done" | "gone" | "expired";
}

/** Add daily minutes for today directly, and answer today's pending minutes ask with them, atomically. */
export async function grantMinutesToday(familyId: string, profileId: string, minutes: 15 | 30 | 60, today: string): Promise<void> {
  if (local()) return localTimeGrants.grantMinutes(familyId, profileId, minutes, today);
  if (!on()) throw new Error("Extra minutes need the family database.");
  const { error } = await supabaseAdmin().rpc("grant_minutes", { p_family: familyId, p_profile: profileId, p_minutes: minutes, p_today: today });
  if (error) throw new Error(error.message);
}

/** Approve a daily-minutes ask and add the minutes for today, atomically. */
export async function approveMinutesAsk(familyId: string, requestId: string, minutes: 15 | 30 | 60, today: string): Promise<"done" | "gone" | "expired"> {
  if (local()) return localTimeGrants.approveMinutes(familyId, requestId, minutes, today);
  if (!on()) return "gone";
  const { data, error } = await supabaseAdmin().rpc("approve_minutes_request", { p_family: familyId, p_request: requestId, p_minutes: minutes, p_today: today });
  if (error) throw new Error(error.message);
  return data as "done" | "gone" | "expired";
}

/** Cancel tonight's extension for a child. True if there was one. */
export async function cancelExtension(familyId: string, profileId: string, night: string): Promise<boolean> {
  if (local()) return localBedtimeExtensions.cancel(familyId, profileId, night);
  if (!on()) return false;
  const { data } = await supabaseAdmin().from("bedtime_extensions").update({ cancelled_at: new Date().toISOString() })
    .match({ family_id: familyId, profile_id: profileId, night }).is("cancelled_at", null).select("id");
  return (data ?? []).length > 0;
}
