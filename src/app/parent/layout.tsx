import { Suspense } from "react";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { listPendingRequests } from "@/lib/activity";
import { getLibrary } from "@/lib/queries";
import { needsDecision } from "@/lib/gate";
import { ParentNav, type NavKid } from "./parent-nav";

/**
 * Shell for every parent page: sidebar on desktop, top bar + bottom tabs on a phone.
 * Pages still guard their own auth; signed-out visitors just get the bare frame.
 */
export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const v = await resolveViewer();
  let badge = 0;
  let kids: NavKid[] = [];
  let defaultKidId: string | undefined;
  if (v.role === "parent") {
    const settings = await db.getSettings(v.familyId, v.profileId); // the parent's selected child, else the first
    const [requests, lib, profiles] = await Promise.all([listPendingRequests(v.familyId), getLibrary(v.familyId, settings.profileId), db.listProfiles(v.familyId)]);
    defaultKidId = settings.profileId;
    badge = requests.length + lib.filter((x) => needsDecision(x, settings) && !requests.some((r) => r.videoId === x.id)).length;
    kids = profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, asks: requests.filter((r) => r.profileId === p.id).length }));
  }
  return (
    <div className="flex flex-1 flex-col pb-20 md:pb-0 lg:flex-row lg:pb-0">
      <Suspense fallback={null}>
        <ParentNav badge={badge} kids={kids} defaultKidId={defaultKidId} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
