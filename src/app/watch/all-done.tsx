import { askMoreTime } from "@/app/actions";
import type { TimeState } from "@/lib/screentime";

/** The gentle wall: time's up (or it's past the done-for-the-day time). One button: ask a grown-up. */
export function AllDone({ time, name }: { time: Extract<TimeState, { allowed: false }>; name?: string }) {
  const bedtime = time.reason === "bedtime";
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-7xl">{bedtime ? "🌙" : "⏰"}</p>
      <h1 className="mt-4 text-3xl sm:text-4xl font-extrabold">{bedtime ? "All done for today!" : `That's all for today${name ? `, ${name}` : ""}!`}</h1>
      <p className="mt-2 max-w-md text-lg font-bold text-[var(--kmuted)]">
        {bedtime ? "Videos come back tomorrow morning." : `You watched about ${time.usedMinutes} minutes. See you tomorrow!`}
      </p>
      <form action={askMoreTime} className="mt-8">
        <button type="submit" className="bigbtn rounded-full bg-white/10 px-8 py-4 text-xl font-extrabold active:scale-95">🙋 Ask a grown-up for more</button>
      </form>
    </main>
  );
}
