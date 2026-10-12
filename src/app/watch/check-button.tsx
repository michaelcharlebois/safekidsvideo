"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { checkVideo } from "@/app/actions";

export type Suggestion = { id: string; title: string; thumbnailUrl: string };

const WAITING = ["Watching it for you…", "Checking for scary bits…", "Listening for loud parts…", "Still watching…"];

/**
 * "Check it" tile control. A check with no card yet runs in the background: we show
 * "checking" plus a few already-cleared videos, and poll the page every few seconds
 * until the server flips this tile to Play / Asked.
 */
export function CheckButton({
  videoId, label, suggestions, initiallyChecking = false,
}: { videoId: string; label: string; suggestions: Suggestion[]; initiallyChecking?: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(checkVideo, null);
  const checking = pending || initiallyChecking || state?.status === "checking";

  useEffect(() => {
    if (state?.status === "playing") router.push(`/watch/${state.videoId}`);
  }, [state, router]);

  // Poll while a background check is running.
  useEffect(() => {
    if (!checking || pending) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [checking, pending, router]);

  if (checking) return <Checking suggestions={suggestions} />;
  if (state?.status === "asked") return <Pill tone="bg-sun">Asked a grown-up!</Pill>;
  if (state?.status === "limit") return <Pill tone="bg-line">No more checks today</Pill>;
  if (state?.status === "error") return <Pill tone="bg-line">Hmm, try again</Pill>;

  return (
    <form action={action}>
      <input type="hidden" name="videoId" value={videoId} />
      <button type="submit" className="w-full rounded-full bg-sun py-2 font-extrabold text-sm active:scale-95">{label}</button>
    </form>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`block w-full rounded-full ${tone} py-2 text-center font-extrabold text-sm`}>{children}</span>;
}

function Checking({ suggestions }: { suggestions: Suggestion[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % WAITING.length), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-2">
      <span className="block w-full rounded-full bg-sky py-2 text-center font-bold text-xs animate-pulse">🔍 {WAITING[i]}</span>
      {suggestions.length > 0 && (
        <div className="rounded-xl bg-bg p-2">
          <p className="text-[11px] font-extrabold text-muted mb-1">While you wait, these are ready:</p>
          <ul className="flex gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <li key={s.id} className="flex-1 min-w-0">
                <Link href={`/watch/${s.id}`} className="block active:scale-95">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumbnailUrl} alt="" className="w-full aspect-video rounded-lg object-cover bg-line" draggable={false} />
                  <span className="block text-[11px] font-bold leading-tight line-clamp-2 mt-1">{s.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
