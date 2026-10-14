import Link from "next/link";
import { ExitButton } from "./exit-button";
import { RemoteNav } from "./remote-nav";
import { FullscreenButton } from "./fullscreen-button";
import { KidHeader } from "./kid-header";
import { supabaseEnabled } from "@/lib/supabase/server";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { timeState } from "@/lib/screentime";
import { AllDone } from "./all-done";
import { childSettings } from "@/lib/queries";

export default async function WatchLayout({ children }: LayoutProps<"/watch">) {
  const viewer = await resolveViewer();
  const profiles = viewer.familyId ? await db.listProfiles(viewer.familyId) : [];
  // Only ever a specific, resolved child — never "the first profile". No child → pages send you to Who's watching.
  const settings = viewer.familyId ? await childSettings(viewer.familyId, viewer.profileId) : null;
  const canSearch = settings ? settings.mode !== "locked" : false;
  const canSwitch = profiles.length > 1 && !(viewer.role === "device" && viewer.assignedProfileId);
  const family = viewer.familyId ? await db.getFamily(viewer.familyId) : null;
  const time = viewer.familyId && settings ? await timeState(viewer.familyId, settings, family?.timezone) : null;
  return (
    <div className="kid-mode kid-pane flex-1 flex flex-col" data-scroll-pane>
      <RemoteNav />
      <KidHeader homeHasOwn={!(time && !time.allowed)}>
        <Link href="/watch" className="bigbtn flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xl font-extrabold active:scale-95">
          <span className="text-2xl leading-none">🏠</span><span className="hidden sm:inline">Home</span>
        </Link>
        {canSearch && (
          <Link href="/watch/search" className="bigbtn flex items-center gap-2 rounded-full bg-white/10 px-5 py-2 text-xl font-extrabold active:scale-95">
            🔍 <span>Search</span>
          </Link>
        )}
        <div className="flex items-center gap-2">
          {settings?.profileId && canSwitch && (
            <Link href="/watch/who" className="bigbtn flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xl font-extrabold active:scale-95" title="Switch kid">
              <span className="text-2xl leading-none">{settings.profileAvatar}</span><span className="hidden sm:inline">{settings.profileName}</span>
            </Link>
          )}
          <FullscreenButton />
          <ExitButton target={supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent"} />
        </div>
      </KidHeader>
      {time && !time.allowed ? <AllDone time={time} name={settings?.profileName} /> : children}
    </div>
  );
}
