"use client";

import { useActionState } from "react";
import { askMoreTime } from "@/app/actions";
import type { TimeAskState } from "@/lib/time-requests";

/**
 * The time-up screen's one ask: more minutes (daily limit) or "stay up a little longer" (bedtime). Until the
 * child asks it's a button; after that it's a status line, not a button — on a TV nothing focusable that
 * looks pressable but does nothing. The state is the STORED one for this child (from any screen); "Sent!"
 * appears only once the request is stored.
 */
export function AskMoreTime({ tv, initial, kind }: { tv: boolean; initial: Exclude<TimeAskState, "not-offered" | "fulfilled">; kind: "limit" | "bedtime" }) {
  const [result, action, pending] = useActionState(askMoreTime, null);
  const state = result?.state ?? initial;
  const shape = tv ? "rounded-full px-[3vw] py-[1.1vw] text-[1.8vw]" : "flex h-14 w-full items-center justify-center rounded-full px-6 text-lg";
  if (pending || state !== "can-ask") {
    const words = pending ? "One moment…"
      : result?.justSent ? "Sent! Waiting for a grown-up"
      : state === "pending" ? "Waiting for a grown-up"
      : state === "declined" ? (kind === "bedtime" ? "A grown-up said not tonight" : "A grown-up said not today")
      : state === "unavailable" ? "Ask a grown-up in person"
      : null;
    if (!words) return null;
    return <p role="status" aria-live="polite" className={`font-extrabold text-[var(--kink)] ring-1 ring-[rgb(255_249_241/0.18)] ${shape}`}>{words}</p>;
  }
  return (
    <form action={action}>
      <button type="submit" data-tv-start="" className={`bigbtn kbtn-primary bg-[var(--kfocus)] font-extrabold text-[#2a1206] ${shape}`}>
        {kind === "bedtime" ? "Ask to stay up a little longer" : "Ask a grown-up for more time"}
      </button>
    </form>
  );
}
