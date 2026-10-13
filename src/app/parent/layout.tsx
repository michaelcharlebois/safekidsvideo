import { Suspense } from "react";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { listPendingRequests } from "@/lib/activity";
import { getLibraries } from "@/lib/queries";
import { forChild, pendingDecisions } from "@/lib/inbox";
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
    // One count for the whole family: every pending decision across all children (see lib/inbox.ts).
    const [requests, children, legacy] = await Promise.all([listPendingRequests(v.familyId), getLibraries(v.familyId), db.listLegacyGrants(v.familyId)]);
    const items = pendingDecisions({ requests, children, legacy });
    badge = items.length;
    defaultKidId = (v.profileId && children.some((c) => c.profile.id === v.profileId) ? v.profileId : undefined) ?? children[0]?.profile.id;
    // Per child (sidebar): the same count as that child's filter on Review — everything that concerns them,
    // including requests that didn't record a child and old records listing them. Shared items count for
    // each child they concern, so per-child numbers can add up to more than the total.
    kids = children.map(({ profile: p }) => ({ id: p.id, name: p.name, avatar: p.avatar, pending: forChild(items, p.id).length }));
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
