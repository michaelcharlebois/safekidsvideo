import { RemoteNav } from "./remote-nav";
import { supabaseEnabled } from "@/lib/supabase/server";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { timeState } from "@/lib/screentime";
import { childSettings } from "@/lib/queries";
import { kidUi } from "@/lib/kid-ui-server";
import { TimeUp } from "./time-up";
import { listTimeRequests } from "@/lib/more-time";
import { timeAskState } from "@/lib/time-requests";
import { localDay } from "@/lib/checkin";
import { serverNow } from "@/lib/clock";

/**
 * Kid mode. Each kid screen (Home, Search, Who's watching, the player) draws its own chrome for TV, tablet
 * and phone. The layout keeps the shared remote navigation and the daily limit: when this child's time is
 * up (checked on the server for the selected child), every kid page is replaced by the time-up screen.
 */
export default async function WatchLayout({ children }: LayoutProps<"/watch">) {
  const viewer = await resolveViewer();
  // Only ever a specific, resolved child — never "the first profile". No child → pages send you to Who's watching.
  const settings = viewer.familyId ? await childSettings(viewer.familyId, viewer.profileId) : null;
  const family = viewer.familyId ? await db.getFamily(viewer.familyId) : null;
  const time = viewer.familyId && settings ? await timeState(viewer.familyId, settings, family?.timezone) : null;
  return (
    <div className="kid-mode kid-pane flex-1 flex flex-col" data-scroll-pane>
      <RemoteNav />
      {time && !time.allowed
        ? <TimeUp time={time} name={settings?.profileName} ui={await kidUi()} ask={timeAskState(time.reason, await listTimeRequests(viewer.familyId!), settings!.profileId!, { today: localDay(family?.timezone, serverNow()), night: time.night, extensionMinutes: time.extensionMinutes })} exitTarget={supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent"} />
        : children}
    </div>
  );
}
