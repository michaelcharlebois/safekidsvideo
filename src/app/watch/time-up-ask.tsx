"use client";

import { useActionState } from "react";
import { askMoreTime } from "@/app/actions";

/** "Ask a grown-up for more time": sends once, then says so (asking again doesn't buzz the parent again). */
export function AskMoreTime({ tv }: { tv: boolean }) {
  const [state, action, pending] = useActionState(askMoreTime, null);
  const done = pending || !!state?.sent;
  const words = pending ? "One moment…" : state?.sent ? (state.already ? "Already asked. A grown-up will decide." : "Sent! A grown-up will decide.") : "Ask a grown-up for more time";
  return (
    <form action={action}>
      <button
        type={done ? "button" : "submit"} aria-disabled={done || undefined} data-tv-start=""
        onClick={done ? (e) => e.preventDefault() : undefined}
        className={`bigbtn font-extrabold ${done ? "bg-[rgb(255_249_241/0.12)] text-[var(--kink)]" : "bg-[var(--kfocus)] text-[#2a1206]"} ${tv ? "rounded-full px-[3vw] py-[1.1vw] text-[1.8vw]" : "flex h-14 w-full items-center justify-center rounded-full px-6 text-lg"}`}
      >
        <span role={done ? "status" : undefined}>{words}</span>
      </button>
    </form>
  );
}
