import "server-only";
// Everything the Kids pages show about each child, loaded once: the gate's view of their library (ready
// count), their pending decisions (same rules as the Review badge), today's minutes, and their screens.
import { db } from "@/lib/db";
import { getLibraries } from "@/lib/queries";
import { readyFor } from "@/lib/kid-home";
import { forChild, pendingDecisions } from "@/lib/inbox";
import { listPendingRequests } from "@/lib/activity";
import { minutesUsedToday } from "@/lib/screentime";
import { localDay } from "@/lib/checkin";
import { listDevices } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import type { ChildFacts } from "@/app/parent/kids/child-summary";

export type Device = Awaited<ReturnType<typeof listDevices>>[number];

export async function loadChildFacts(familyId: string): Promise<{ facts: ChildFacts[]; devices: Device[] | null; timezone?: string }> {
  const [family, children, requests, legacy] = await Promise.all([db.getFamily(familyId), getLibraries(familyId), listPendingRequests(familyId), db.listLegacyGrants(familyId)]);
  const devices = supabaseEnabled ? (await listDevices(familyId)).filter((d) => !d.revoked_at) : null;
  const items = pendingDecisions({ requests, children, legacy });
  const today = localDay(family.timezone);
  const multi = children.length > 1;
  const facts = await Promise.all(children.map(async ({ profile, settings, lib }) => {
    const bonus = settings.bonusDay === today ? settings.bonusMinutes ?? 0 : 0;
    return {
      profile, settings,
      ready: readyFor(lib, settings).length,
      pending: forChild(items, profile.id).length,
      usedToday: await minutesUsedToday(familyId, profile.id, family.timezone),
      limitToday: settings.dailyMinutes ? settings.dailyMinutes + bonus : undefined,
      // Screens this child can watch on: their own devices, plus shared ones (every device in a one-child family).
      screens: devices === null ? undefined : devices
        .filter((d) => d.assigned_profile_id === profile.id || !d.assigned_profile_id)
        .map((d) => ({ name: d.name, personal: d.assigned_profile_id === profile.id || !multi })),
    } satisfies ChildFacts;
  }));
  return { facts, devices, timezone: family.timezone };
}
