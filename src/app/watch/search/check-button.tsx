"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkVideo } from "@/app/actions";

const WAITING = ["Watching it for you…", "Checking for scary bits…", "Listening for loud parts…", "Almost done…"];

export function CheckButton({ videoId, label }: { videoId: string; label: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(checkVideo, null);

  useEffect(() => {
    if (state?.status === "playing") router.push(`/watch/${state.videoId}`);
  }, [state, router]);

  if (pending) return <Spinner />;
  if (state?.status === "asked") return <span className="block w-full rounded-full bg-sun py-2 text-center font-extrabold text-sm">Asked a grown-up!</span>;
  if (state?.status === "limit") return <span className="block w-full rounded-full bg-line py-2 text-center font-bold text-xs">No more checks today</span>;
  if (state?.status === "error") return <span className="block w-full rounded-full bg-line py-2 text-center font-bold text-xs">Hmm, try again</span>;

  return (
    <form action={action}>
      <input type="hidden" name="videoId" value={videoId} />
      <button type="submit" className="w-full rounded-full bg-sun py-2 font-extrabold text-sm active:scale-95">{label}</button>
    </form>
  );
}

function Spinner() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % WAITING.length), 4000);
    return () => clearInterval(t);
  }, []);
  const msg = WAITING[i];
  return (
    <span className="block w-full rounded-full bg-sky py-2 text-center font-bold text-xs animate-pulse">🔍 {msg}</span>
  );
}
