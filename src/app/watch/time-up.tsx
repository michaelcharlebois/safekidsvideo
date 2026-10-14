import { IconClock, IconMoon } from "@/components/icons";
import { BrandMark } from "@/components/logo";
import type { TimeState } from "@/lib/screentime";
import type { KidUiChoice } from "@/lib/form-factor";
import { TvFocus } from "./home/focus-first";
import { ExitButton } from "./exit-button";
import { AskMoreTime } from "./time-up-ask";

/**
 * Time's up (the daily limit) or done for the day (the "done by" time). Calm, short, and clear about what
 * happens next: videos come back tomorrow, or a grown-up can add time. The limit itself is enforced on the
 * server (the layout shows this instead of any kid page, Who's watching included, as before; the player and
 * nextVideo check it too). A grown-up can add time (parent area, reached by the hold-to-exit button).
 */
export function TimeUp({ time, name, ui, exitTarget }: {
  time: Extract<TimeState, { allowed: false }>; name?: string; ui: KidUiChoice; exitTarget: string;
}) {
  const tv = ui === "tv";
  const rest = time.reason === "bedtime";
  const title = rest ? `Time to rest${name ? `, ${name}` : ""}` : `That's all for today${name ? `, ${name}` : ""}!`;
  const line = rest
    ? "Videos are done for today. They'll be back tomorrow."
    : `You watched ${time.usedMinutes >= 1 ? `about ${time.usedMinutes} minutes` : "your videos"} today. Videos come back tomorrow.`;
  const Icon = rest ? IconMoon : IconClock;
  return (
    <div className={`kid-bf ${tv ? "tv" : "touch"} flex flex-1 flex-col ${tv ? "px-[5vw] pb-[6vh] pt-[4vh]" : "px-5 pb-10 pt-4"}`}>
      {tv && <TvFocus />}
      <header className="flex items-center justify-between">
        <BrandMark tone="dark" size={0} className={tv ? "h-[3.2vw] w-auto" : "h-10 w-auto"} />
        <ExitButton target={exitTarget} />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center text-center">
        <span className={`flex items-center justify-center rounded-full bg-[rgb(255_249_241/0.08)] text-[var(--kfocus)] ${tv ? "h-[10vw] w-[10vw]" : "h-28 w-28 sm:h-36 sm:w-36"}`} aria-hidden>
          <Icon size={0} className="h-1/2 w-1/2" strokeWidth={1.5} />
        </span>
        <h1 className={`font-extrabold ${tv ? "mt-[4vh] text-[3.4vw]" : "mt-6 text-3xl sm:text-4xl"}`}>{title}</h1>
        <p className={`max-w-xl font-semibold text-[var(--kmuted)] ${tv ? "mt-[1.5vh] max-w-[50vw] text-[1.7vw]" : "mt-3 text-lg"}`}>{line}</p>
        <div className={tv ? "mt-[5vh] flex flex-col items-center gap-[2vh]" : "mt-8 flex w-full max-w-sm flex-col items-stretch gap-3"} data-nav-row>
          <AskMoreTime tv={tv} />
        </div>
      </main>
    </div>
  );
}
