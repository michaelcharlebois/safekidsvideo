"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkVideo, type CheckResult } from "@/app/actions";

type Said = Exclude<NonNullable<CheckResult>["status"], "playing">;
const SAID: Record<Said, string> = {
  asked: "Sent to a grown-up!",
  checking: "Brightframe is watching it first…",
  limit: "No more checks today",
  too_many: "You asked for lots. Wait for a grown-up",
  error: "That didn't work. Try later",
};
const SETTLED = { waiting: "Waiting for a grown-up", checking: "Checking…" } as const;

/**
 * The control on a search result that isn't Ready: "Check it" / "Ask a grown-up", and afterwards what
 * happened. Both go through one server action that decides from the child's own gate: it plays only if
 * authorize() allows it for this child; otherwise it becomes a request (one per child per video; asking
 * again is a no-op). It stays the same element throughout, so a remote's focus stays put, and "Sent to a
 * grown-up!" stays up for a few seconds before it settles to "Waiting for a grown-up".
 * `settled` is the server's view (already asked, or a check running): then there's nothing to press.
 */
export function ResultAction({ videoId, label, settled, tv = false }: { videoId: string; label?: string; settled?: keyof typeof SETTLED; tv?: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(checkVideo, null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (state?.status === "playing") router.push(`/watch/${state.videoId}?from=search`);
    if (state?.status === "asked") { queueMicrotask(() => setFresh(true)); const t = setTimeout(() => setFresh(false), 5000); return () => clearTimeout(t); }
    if (state?.status === "checking") { const t = setInterval(() => router.refresh(), 8000); return () => clearInterval(t); }
  }, [state, router]);

  const said = state && state.status !== "playing" ? state.status : null;
  const words = pending ? "One moment…"
    : said === "asked" && fresh ? SAID.asked
    : settled ? SETTLED[settled]
    : said ? SAID[said]
    : label ?? "";
  const done = pending || !!said || !!settled;
  const cls = tv
    ? "block w-full rounded-full py-[0.6vw] text-center text-[1.2vw] font-extrabold"
    : "flex h-12 w-full items-center justify-center rounded-full text-base font-extrabold active:scale-[0.98]";
  const tone = said === "asked" && fresh ? "bg-[#f5d77a] text-[#2a1206]" : done ? "bg-[rgb(255_249_241/0.12)] text-[var(--kink)]" : "bg-[var(--kfocus)] text-[#2a1206]";
  return (
    <form action={action}>
      <input type="hidden" name="videoId" value={videoId} />
      <button
        type={done ? "button" : "submit"}
        aria-disabled={done || undefined}
        onClick={done ? (e) => e.preventDefault() : undefined}
        className={`${cls} ${tone} ${done ? "cursor-default" : ""}`}
      >
        <span role={done ? "status" : undefined}>{words}</span>
      </button>
    </form>
  );
}
