// What happens when a child presses "Check it" or "Ask a grown-up" on a search result. Pure, so the rules
// are testable: asking a grown-up is never limited by the AI-review allowance (that allowance only limits
// automatic reviews), and nothing here can make a video play — only authorize() can ("play" is just its
// answer passed through).

export const MAX_PENDING_REQUESTS_PER_CHILD = 25; // a sanity cap on unanswered asks, not a quota on reviews

export type CheckInput = {
  mode: "open" | "open_ask";
  /** authorize() allows this video for this child right now. */
  playable: boolean;
  /** A real (not sample) AI review exists. */
  reviewed: boolean;
  /** Too long for an automatic review. */
  tooLong: boolean;
  /** An AI reviewer is configured on this deployment. */
  reviewerConfigured: boolean;
  /** Automatic reviews this child started today, and the allowance. */
  aiChecksToday: number;
  aiDailyLimit: number;
  /** This child already has a pending request for this video. */
  alreadyAsked: boolean;
  /** This child's pending requests, all videos. */
  pendingForChild: number;
};

export type CheckPlan =
  | { do: "play" }
  | { do: "already-asked" }
  | { do: "too-many-requests" }
  | { do: "settle" } // reviewed already: decide from the stored review (no AI run, no allowance used)
  | { do: "request"; reason: string; reviewAfter: boolean } // a grown-up decides; optionally review in the background for them
  | { do: "review" }; // Open: run the automatic review (uses one of today's allowance)

export function planCheck(i: CheckInput): CheckPlan {
  if (i.playable) return { do: "play" };
  if (i.alreadyAsked) return { do: "already-asked" };
  if (i.pendingForChild >= MAX_PENDING_REQUESTS_PER_CHILD) return { do: "too-many-requests" };
  const allowanceLeft = i.aiChecksToday < i.aiDailyLimit;
  const canReview = !i.reviewed && i.reviewerConfigured && !i.tooLong && allowanceLeft;
  if (i.mode === "open_ask") return { do: "request", reason: "Asked to watch", reviewAfter: canReview };
  if (i.reviewed) return { do: "settle" };
  if (i.tooLong) return { do: "request", reason: "Too long to check automatically", reviewAfter: false };
  if (!i.reviewerConfigured) return { do: "request", reason: "Couldn't be checked automatically", reviewAfter: false };
  if (!allowanceLeft) return { do: "request", reason: "Today's automatic checks are used up", reviewAfter: false };
  return { do: "review" };
}
