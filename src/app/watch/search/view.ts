// What a kid Search shows, computed once on the server from this child's gate (lib/kid-search.ts). The three
// layouts only present it.
import type { FamilyMode } from "@/lib/types";
import type { SearchState } from "@/lib/kid-search";
import type { KidChild } from "../chrome";
import type { KidVideo } from "../home/view";

export type SearchResult = KidVideo & { channel: string; state: SearchState; checking: boolean };
export type SearchView = {
  child: KidChild;
  mode: Exclude<FamilyMode, "locked">;
  canSwitch: boolean;
  q: string;
  results: SearchResult[];
  /** Already-cleared videos to offer while a check runs. */
  ready: KidVideo[];
  /** youtube: real search. catalogue: local practice search over videos already in Brightframe. none: not set up. */
  source: "youtube" | "catalogue" | "none";
  minutesLeft?: number;
  exitTarget: string;
};

export const modeLine = (mode: SearchView["mode"]) =>
  mode === "open_ask"
    ? "Find something you like, then ask a grown-up. New videos play after a grown-up says yes."
    : "Videos marked Ready play now. For the others, Brightframe checks first, or a grown-up decides.";
