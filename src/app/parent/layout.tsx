import { Suspense } from "react";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { listPendingRequests } from "@/lib/activity";
import { pendingDecisions, requestsFrom } from "@/lib/inbox";
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
    // One count for the whole family: pending requests and unresolved old records (lib/inbox.ts). Videos
    // held back automatically are not tasks, so no child's library — and no catalogue scan — is needed.
    const [requests, profiles, legacy] = await Promise.all([listPendingRequests(v.familyId), db.listProfiles(v.familyId), db.listLegacyGrants(v.familyId)]);
    const items = pendingDecisions({ requests, childIds: profiles.map((p) => p.id), legacy });
    badge = items.length;
    defaultKidId = (v.profileId && profiles.some((p) => p.id === v.profileId) ? v.profileId : undefined) ?? profiles[0]?.id;
    // Per child (sidebar): requests that child actually made. Unattributed and historical items count only
    // in the family total, so a child's number never includes something they didn't ask for.
    kids = profiles.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, pending: requestsFrom(items, p.id).length }));
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
