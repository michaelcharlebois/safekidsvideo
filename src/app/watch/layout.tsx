import Link from "next/link";
import { ExitButton } from "./exit-button";
import { RemoteNav } from "./remote-nav";
import { FullscreenButton } from "./fullscreen-button";
import { KidHeader } from "./kid-header";
import { supabaseEnabled } from "@/lib/supabase/server";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";

export default async function WatchLayout({ children }: LayoutProps<"/watch">) {
  const viewer = await resolveViewer();
  const settings = viewer.familyId ? await db.getSettings(viewer.familyId) : null;
  const canSearch = settings ? settings.mode !== "locked" : false;
  return (
    <div className="kid-mode flex-1 flex flex-col">
      <RemoteNav />
      <KidHeader>
        <Link href="/watch" className="bigbtn flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xl font-extrabold active:scale-95">
          <span className="text-2xl leading-none">🏠</span><span className="hidden sm:inline">Home</span>
        </Link>
        {canSearch && (
          <Link href="/watch/search" className="bigbtn flex items-center gap-2 rounded-full bg-[var(--kfocus)] px-5 py-2 text-xl font-extrabold text-[#0b1020] active:scale-95">
            🔍 <span>Search</span>
          </Link>
        )}
        <div className="flex items-center gap-2">
          <FullscreenButton />
          <ExitButton target={supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent"} />
        </div>
      </KidHeader>
      {children}
    </div>
  );
}
