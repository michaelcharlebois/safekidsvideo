import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { listPendingRequests } from "@/lib/activity";
import { blockedReasons, getLibrary } from "@/lib/queries";
import { ParentNav } from "./parent-nav";

/** Shell for every parent page: nav + bottom-tab padding. Pages still guard their own auth. */
export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const v = await resolveViewer();
  let badge = 0, kidAvatar: string | undefined;
  if (v.role === "parent") {
    const [requests, lib, settings] = await Promise.all([listPendingRequests(v.familyId), getLibrary(v.familyId), db.getSettings(v.familyId, v.profileId)]);
    kidAvatar = settings.profileAvatar;
    badge = requests.length + lib.filter((x) => x.whitelisted && x.card && x.card.reviewer.model !== "sample" && !x.dismissed && !x.overridden && blockedReasons(x, settings).length > 0 && !requests.some((r) => r.videoId === x.id)).length;
  }
  return (
    <div className="flex-1 flex flex-col pb-20 md:pb-0">
      <ParentNav badge={badge} kidAvatar={kidAvatar} />
      {children}
    </div>
  );
}
