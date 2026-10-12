import Link from "next/link";
import { ExitButton } from "./exit-button";
import { supabaseEnabled } from "@/lib/supabase/server";

export default function WatchLayout({ children }: LayoutProps<"/watch">) {
  return (
    <div className="kid-mode flex-1 flex flex-col bg-sky/40">
      <header className="flex items-center justify-between px-4 py-3">
        <Link href="/watch" className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 font-extrabold text-xl shadow-sm active:scale-95">
          <span className="text-2xl leading-none">⌂</span> My Videos
        </Link>
        <ExitButton target={supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent"} />
      </header>
      {children}
    </div>
  );
}
