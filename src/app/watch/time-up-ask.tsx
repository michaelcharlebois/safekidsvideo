"use client";

import { useActionState } from "react";
import { askMoreTime } from "@/app/actions";
import type { TimeAskState } from "@/lib/time-requests";

const SAID: Record<Exclude<TimeAskState, "can-ask" | "not-offered">, string> = {
  pending: "Waiting for a grown-up",
  declined: "A grown-up said not today",
};

/**
 * "Ask a grown-up for more time". Shows the STORED state for this child today (from any screen): can ask,
 * waiting, or not today. Asking records the request on the server; "Sent!" appears only once it's stored.
 * The same element throughout, so a remote's focus stays put.
 */
export function AskMoreTime({ tv, initial }: { tv: boolean; initial: Exclude<TimeAskState, "not-offered"> }) {
  const [result, action, pending] = useActionState(askMoreTime, null);
  const state = result?.state ?? initial;
  const words = pending ? "One moment…"
    : result?.justSent ? "Sent! Waiting for a grown-up"
    : state === "pending" || state === "declined" ? SAID[state]
    : state === "unavailable" ? "Ask a grown-up in person"
    : "Ask a grown-up for more time";
  const done = pending || state !== "can-ask";
  return (
    <form action={action}>
      <button
        type={done ? "button" : "submit"} aria-disabled={done || undefined} data-tv-start=""
        onClick={done ? (e) => e.preventDefault() : undefined}
        className={`bigbtn font-extrabold ${done ? "bg-[rgb(255_249_241/0.12)] text-[var(--kink)]" : "kbtn-primary bg-[var(--kfocus)] text-[#2a1206]"} ${tv ? "rounded-full px-[3vw] py-[1.1vw] text-[1.8vw]" : "flex h-14 w-full items-center justify-center rounded-full px-6 text-lg"}`}
      >
        <span role={done ? "status" : undefined}>{words}</span>
      </button>
    </form>
  );
}
