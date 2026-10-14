// What every kid Home shows, computed once on the server from the child-scoped gate (kidHome()). The three
// layouts only present this; none of them fetches or filters content itself.
import type { FamilyMode } from "@/lib/types";

export type KidVideo = { id: string; title: string; thumb?: string; durationSeconds?: number };
export type KidShelf = { id: string; title: string; kind: "approved" | "recent" | "for-you" | "channel"; avatar?: string; videos: KidVideo[]; comingSoon: number };
export type KidHomeView = {
  child: { id: string; name: string; avatar: string };
  mode: FamilyMode;
  canSearch: boolean;
  canSwitch: boolean;
  shelves: KidShelf[];
  /** Videos this child asked for that a grown-up hasn't answered. Shown, never playable from here. */
  waiting: KidVideo[];
  minutesLeft?: number;
  /** Tonight's bedtime extension, as a clock time ("8:00 PM"), when a grown-up has granted one. */
  stayingUpUntil?: string;
  exitTarget: string;
  asking: boolean; // the phone "Ask" sheet is open
};

export const askLine = (mode: FamilyMode) =>
  mode === "locked" ? "A grown-up picks your videos. Tell them what you'd like to watch!"
  : mode === "open_ask" ? "Find a video you like, then ask a grown-up."
  : "Search for a video. Brightframe checks it first, and you can ask a grown-up if it can't.";

export const fmtDuration = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");
