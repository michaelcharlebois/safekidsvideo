import "server-only";
import { supabaseAdmin, supabaseEnabled } from "@/lib/supabase/server";
import { localBedtimeExtensions } from "@/lib/db/local";
import { isExtensionMinutes, type BedtimeExtension } from "@/lib/bedtime";

/* One-night bedtime extensions, stored (migration 0023, or the local store in local mode). */

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

/** Grant or change tonight's extension for a child (one live row per child per night). */
export async function setExtension(e: Omit<BedtimeExtension, "id" | "createdAt" | "updatedAt" | "cancelledAt">): Promise<BedtimeExtension> {
  if (local()) return localBedtimeExtensions.set(e);
  if (!on()) throw new Error("Bedtime extensions need the family database.");
  const row = { family_id: e.familyId, profile_id: e.profileId, night: e.night, base_bedtime: e.baseBedtime, extra_minutes: e.extraMinutes, cutoff_at: e.cutoffAt, granted_by: e.grantedBy ?? null, updated_at: new Date().toISOString() };
  const live = () => supabaseAdmin().from("bedtime_extensions").select("*").match({ family_id: e.familyId, profile_id: e.profileId, night: e.night }).is("cancelled_at", null).maybeSingle();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: cur } = await live();
    if (cur) {
      const { data, error } = await supabaseAdmin().from("bedtime_extensions").update({ ...row, ...(e.requestId ? { request_id: e.requestId } : {}) }).eq("id", (cur as Row).id).select("*").single();
      if (error) throw new Error(error.message);
      return toExt(data as Row);
    }
    const { data, error } = await supabaseAdmin().from("bedtime_extensions").insert({ ...row, request_id: e.requestId ?? null }).select("*").single();
    if (!error) return toExt(data as Row);
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message); // another grant landed first: update it
  }
  throw new Error("Couldn't save the extension. Try again.");
}

/** Cancel tonight's extension for a child. True if there was one. */
export async function cancelExtension(familyId: string, profileId: string, night: string): Promise<boolean> {
  if (local()) return localBedtimeExtensions.cancel(familyId, profileId, night);
  if (!on()) return false;
  const { data } = await supabaseAdmin().from("bedtime_extensions").update({ cancelled_at: new Date().toISOString() })
    .match({ family_id: familyId, profile_id: profileId, night }).is("cancelled_at", null).select("id");
  return (data ?? []).length > 0;
}
