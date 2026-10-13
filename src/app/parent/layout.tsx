import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { listPendingRequests } from "@/lib/activity";
import { getLibrary } from "@/lib/queries";
import { needsDecision } from "@/lib/gate";
import { ParentNav } from "./parent-nav";

/** Shell for every parent page: nav + bottom-tab padding. Pages still guard their own auth. */
export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const v = await resolveViewer();
  let badge = 0, kidAvatar: string | undefined;
  if (v.role === "parent") {
    const settings = await db.getSettings(v.familyId, v.profileId); // the parent's selected child, else the first
    const [requests, lib] = await Promise.all([listPendingRequests(v.familyId), getLibrary(v.familyId, settings.profileId)]);
    kidAvatar = settings.profileAvatar;
    badge = requests.length + lib.filter((x) => needsDecision(x, settings) && !requests.some((r) => r.videoId === x.id)).length;
  }
  return (
    <div className="flex-1 flex flex-col pb-20 md:pb-0">
      <ParentNav badge={badge} kidAvatar={kidAvatar} />
      {children}
    </div>
  );
}
