// Parent-facing descriptions of the three viewing modes, matching what the app actually does in each
// (kid search is off in Locked; Ask first sends anything new to the parent; Open plays search finds that
// pass the AI review and the child's settings). One place, so the Kids pages and onboarding agree.
import type { FamilyMode } from "@/lib/types";

export const MODE_ORDER: FamilyMode[] = ["locked", "open_ask", "open"];

export const MODE_UI: Record<FamilyMode, { title: string; tagline: string; watch: (n: string) => string; ask: (n: string) => string }> = {
  locked: {
    title: "Locked",
    tagline: "Only your library",
    watch: (n) => `${n} watches videos from your library that pass ${n}'s settings. No searching.`,
    ask: (n) => `${n} can't search or ask for new videos. You add what ${n} can watch.`,
  },
  open_ask: {
    title: "Ask first",
    tagline: "Search, and you approve",
    watch: (n) => `${n} watches your library and can search YouTube.`,
    ask: (n) => `Anything ${n} finds outside your library comes to you in Review before it plays.`,
  },
  open: {
    title: "Open",
    tagline: "Search, checked by the AI review",
    watch: (n) => `${n} watches your library and can search YouTube. A video from search plays once its AI review passes ${n}'s settings.`,
    ask: (n) => `If a video ${n} finds is held back, ${n} can ask you for it in Review.`,
  },
};

export const fmtClock = (hhmm?: string) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

/** "Up to 45 minutes a day, done by 7:30 pm" / "No daily limit or bedtime". With `tonight` (Home), today's
 *  effective values lead, so the sentence never contradicts the Tonight card: "Up to 60 minutes today (usually
 *  45), done by 8:00 pm tonight (usually 7:30 pm)". */
export function whenSentence(s: { dailyMinutes?: number; bedtime?: string }, tonight?: { limitMinutes?: number; stopsLabel?: string; extended?: boolean }): string {
  const minutes = !s.dailyMinutes ? null
    : tonight?.limitMinutes != null && tonight.limitMinutes !== s.dailyMinutes ? `Up to ${tonight.limitMinutes} minutes today (usually ${s.dailyMinutes})`
    : `Up to ${s.dailyMinutes} minutes a day`;
  const bed = !s.bedtime ? null
    : tonight?.extended && tonight.stopsLabel ? `done by ${tonight.stopsLabel.toLowerCase()} tonight (usually ${fmtClock(s.bedtime)})`
    : `done by ${fmtClock(s.bedtime)}`;
  const parts = [minutes, bed].filter(Boolean) as string[];
  if (!parts.length) return "No daily limit or bedtime";
  const out = parts.join(", ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}
